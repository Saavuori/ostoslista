import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { listItems, lists, storeLocations } from "@/lib/db/schema";
import { storeAisleOrder } from "@/lib/kruoka/aisles";
import { type KRuokaClient, kruoka } from "@/lib/kruoka/client";
import type { StoreLocation } from "@/lib/kruoka/location";
import { publish } from "@/lib/realtime/bus";
import { type ItemView, toItemView } from "./service";

/**
 * Puts list items in the store's own departments and shelves.
 *
 * Search results only carry K-Ruoka's web categories, which follow the site,
 * not the shop. The store layout — "Juusto, hylly 06, taso 5" — comes from a
 * separate per-product request, so it is fetched here, after the item is on
 * the list, and pushed to everyone viewing it. Adding an item never waits for
 * K-Ruoka, and an item that cannot be located keeps its web category.
 */

/** Layouts change with planogram resets, not daily. */
const LOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Upstream failures are retried on a later list load, not in a tight loop. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

/** At most this many lookups per call; a long list fills in over a few loads. */
const MAX_PER_RUN = 20;

const recentFailures = new Map<string, number>();
const inFlight = new Set<string>();

export interface LocateOptions {
  client?: KRuokaClient;
  /** Restrict to these item ids; otherwise every unlocated item on the list. */
  itemIds?: string[];
}

/**
 * Locates the list's unlocated items and publishes each change.
 *
 * Safe to call fire-and-forget from request handlers: never throws, and
 * concurrent calls for the same list do not duplicate work.
 */
export async function locateListItems(
  listId: string,
  options: LocateOptions = {},
): Promise<number> {
  try {
    return await locate(listId, options);
  } catch (error) {
    console.error("store location lookup failed:", error);
    return 0;
  }
}

async function locate(listId: string, options: LocateOptions): Promise<number> {
  const [list] = await db
    .select({ storeId: lists.storeId })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!list) return 0;

  const conditions = [
    eq(listItems.listId, listId),
    isNull(listItems.deletedAt),
    isNull(listItems.locatedAt),
    isNotNull(listItems.ean),
  ];
  if (options.itemIds) {
    if (options.itemIds.length === 0) return 0;
    conditions.push(inArray(listItems.id, options.itemIds));
  }

  const pending = (
    await db
      .select()
      .from(listItems)
      .where(and(...conditions))
  )
    .filter((row) => !inFlight.has(row.id))
    .slice(0, MAX_PER_RUN);

  let updated = 0;
  for (const row of pending) {
    inFlight.add(row.id);
    try {
      const found = await lookup(row.ean as string, list.storeId, options.client ?? kruoka);
      if (found === undefined) continue; // upstream failed; try again later
      const view = await applyLocation(row.id, found);
      if (view) {
        // No origin: the device that added the item has to receive this too.
        void publish(listId, { type: "item.updated", item: view }, null);
        updated += 1;
      }
    } finally {
      inFlight.delete(row.id);
    }
  }
  return updated;
}

/**
 * Cached location for one product in one store.
 *
 * Returns null for "the store has no location" (also cached) and undefined
 * when K-Ruoka could not be asked, which must not be remembered as an answer.
 */
async function lookup(
  ean: string,
  storeId: string,
  client: KRuokaClient,
): Promise<StoreLocation | null | undefined> {
  const [cached] = await db
    .select()
    .from(storeLocations)
    .where(and(eq(storeLocations.ean, ean), eq(storeLocations.storeId, storeId)))
    .limit(1);

  if (cached && Date.now() - cached.fetchedAt.getTime() < LOCATION_TTL_MS) {
    return cached.departmentName && cached.departmentOrder !== null
      ? {
          departmentName: cached.departmentName,
          departmentOrder: cached.departmentOrder,
          module: cached.module,
          level: cached.level,
        }
      : null;
  }

  const key = `${storeId}:${ean}`;
  const failedAt = recentFailures.get(key);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return undefined;

  let found: StoreLocation | null;
  try {
    found = await client.getStoreLocation(ean, { storeId });
    recentFailures.delete(key);
  } catch (error) {
    recentFailures.set(key, Date.now());
    console.error(`store location for ${ean} failed:`, error);
    return undefined;
  }

  const values = {
    departmentName: found?.departmentName ?? null,
    departmentOrder: found?.departmentOrder ?? null,
    module: found?.module ?? null,
    level: found?.level ?? null,
    fetchedAt: new Date(),
  };
  await db
    .insert(storeLocations)
    .values({ ean, storeId, ...values })
    .onConflictDoUpdate({ target: [storeLocations.ean, storeLocations.storeId], set: values });

  return found;
}

/**
 * Writes the result onto the item. Only the location columns are touched and
 * `updatedAt` is left alone: this is not an edit, and it must not win a
 * last-write-wins comparison against one.
 */
async function applyLocation(
  itemId: string,
  found: StoreLocation | null,
): Promise<ItemView | null> {
  const [row] = await db
    .update(listItems)
    .set(
      found
        ? {
            aisleName: found.departmentName,
            aisleOrder: storeAisleOrder(found.departmentOrder),
            shelfModule: found.module,
            shelfLevel: found.level,
            locatedAt: new Date(),
          }
        : // Nothing better than the web category; stop asking.
          { locatedAt: new Date() },
    )
    .where(and(eq(listItems.id, itemId), isNull(listItems.locatedAt)))
    .returning();

  // A "no location" result changes nothing anyone can see.
  return row && found ? toItemView(row) : null;
}

/** Test helper. */
export function resetLocateState(): void {
  recentFailures.clear();
  inFlight.clear();
}
