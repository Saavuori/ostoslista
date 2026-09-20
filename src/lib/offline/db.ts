"use client";

import Dexie, { type EntityTable } from "dexie";
import type { ItemView } from "@/lib/lists/service";

/**
 * On-device storage.
 *
 * The app has to work with no signal — supermarkets are concrete boxes — so
 * the local database is the source of truth the UI reads from, and the server
 * is something it reconciles with. Not a cache bolted on afterwards.
 *
 * Two tables:
 *
 * `items`   the list as this device believes it to be.
 * `outbox`  changes made here that the server has not confirmed.
 *
 * Deliberately not stored: anything derived. Totals are recomputed rather than
 * persisted, because a stale total is worse than a slow one.
 */

/** An item as stored locally. Dates survive IndexedDB structured cloning. */
export interface StoredItem extends Omit<ItemView, "updatedAt" | "checkedAt" | "deletedAt"> {
  /** The share token this row belongs to — the local partition key. */
  token: string;
  updatedAt: Date;
  checkedAt: Date | null;
  deletedAt: Date | null;
}

export type OutboxOp = "create" | "update" | "delete";

export interface OutboxEntry {
  /** Auto-incremented; also the send order. */
  seq?: number;
  token: string;
  itemId: string;
  op: OutboxOp;
  /** The fields this change sets. Merged with later changes to the same row. */
  patch: Partial<StoredItem>;
  queuedAt: Date;
  /** Failed attempts, used to back off and eventually give up loudly. */
  attempts: number;
}

export interface StoredList {
  token: string;
  id: string;
  name: string;
  storeId: string;
  role: string;
  memberId: string | null;
  cachedAt: Date;
}

class OstoslistaDb extends Dexie {
  items!: EntityTable<StoredItem, "id">;
  outbox!: EntityTable<OutboxEntry, "seq">;
  lists!: EntityTable<StoredList, "token">;

  constructor() {
    super("ostoslista");
    this.version(1).stores({
      // Indexed on token so a list loads without scanning every row.
      items: "id, token, [token+checked], sortKey",
      outbox: "++seq, token, itemId, [token+itemId]",
      lists: "token",
    });
  }
}

/**
 * Lazily constructed.
 *
 * Dexie touches `indexedDB` on construction, which does not exist during
 * server rendering and throws in a private window. Callers get null and fall
 * back to network-only behaviour rather than the app failing to load.
 */
let instance: OstoslistaDb | null = null;
let unavailable = false;

export function getDb(): OstoslistaDb | null {
  if (unavailable) return null;
  if (instance) return instance;
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;

  try {
    instance = new OstoslistaDb();
    return instance;
  } catch {
    unavailable = true;
    return null;
  }
}

/** Replaces the cached copy of a list. Used after a successful fetch. */
export async function cacheList(
  token: string,
  list: { id: string; name: string; storeId: string; role: string; memberId: string | null },
  items: ItemView[],
): Promise<void> {
  const db = getDb();
  if (!db) return;

  const rows: StoredItem[] = items.map((item) => ({ ...item, token }));

  await db.transaction("rw", db.items, db.lists, async () => {
    await db.lists.put({ ...list, token, cachedAt: new Date() });
    // Rows the server no longer has must go, or deleted items reappear
    // whenever the device is offline.
    await db.items.where("token").equals(token).delete();
    if (rows.length > 0) await db.items.bulkPut(rows);
  });
}

export async function readCachedItems(token: string): Promise<StoredItem[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.items.where("token").equals(token).toArray();
  return rows
    .filter((row) => !row.deletedAt)
    .sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));
}

export async function readCachedList(token: string): Promise<StoredList | undefined> {
  const db = getDb();
  if (!db) return undefined;
  return db.lists.get(token);
}
