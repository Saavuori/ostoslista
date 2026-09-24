import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { listItems, listMembers, lists, shareTokens } from "@/lib/db/schema";
import { generateShareToken, isUuid, isValidShareToken, uuidv7 } from "@/lib/ids";
import { publish } from "@/lib/realtime/bus";
import { type MergeableItem, mergeItem, sortKeyBetween } from "@/lib/sync/lww";
import type {
  CreateItemInput,
  CreateListInput,
  ItemContent,
  SyncInput,
  UpdateItemInput,
} from "./validation";

/**
 * List and item operations.
 *
 * Everything here takes a share token rather than a user: holding the link is
 * the credential. Authorisation is therefore a single concern — resolve the
 * token, check the role — and it happens in `authorize()` below, never ad hoc
 * in a route handler.
 */

export type Role = "editor" | "viewer";

export class ListError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ListError";
  }
}

export const notFound = () => new ListError("Listaa ei löytynyt", 404);
export const forbidden = () => new ListError("Linkki on vain katselua varten", 403);

/** Drizzle returns `numeric` as a string to avoid precision loss. */
const toNumber = (value: string | null): number => (value === null ? 0 : Number(value));

export interface ItemView {
  id: string;
  ean: string | null;
  freeText: string | null;
  nameSnapshot: string | null;
  priceCentsSnapshot: number | null;
  aisleName: string | null;
  aisleOrder: number | null;
  imageUrl: string | null;
  comparisonCents: number | null;
  comparisonUnit: string | null;
  discountPercent: number | null;
  discountType: string | null;
  offerAmount: number | null;
  offerBundleCents: number | null;
  qty: number;
  qtyUnit: string;
  note: string | null;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: Date | null;
  sortKey: number;
  addedBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
}

export interface ListView {
  id: string;
  name: string;
  storeId: string;
  archivedAt: Date | null;
  updatedAt: Date;
  role: Role;
  token: string;
  /** Set when this viewer is a known member; used to ignore its own echoes. */
  memberId: string | null;
  items: ItemView[];
}

type ItemRow = typeof listItems.$inferSelect;

function toItemView(row: ItemRow): ItemView {
  return {
    id: row.id,
    ean: row.ean,
    freeText: row.freeText,
    nameSnapshot: row.nameSnapshot,
    priceCentsSnapshot: row.priceCentsSnapshot,
    aisleName: row.aisleName,
    aisleOrder: row.aisleOrder,
    imageUrl: row.imageUrl,
    comparisonCents: row.comparisonCents,
    comparisonUnit: row.comparisonUnit,
    discountPercent: row.discountPercent,
    discountType: row.discountType,
    offerAmount: row.offerAmount,
    offerBundleCents: row.offerBundleCents,
    qty: toNumber(row.qty),
    qtyUnit: row.qtyUnit,
    note: row.note,
    checked: row.checked,
    checkedBy: row.checkedBy,
    checkedAt: row.checkedAt,
    sortKey: toNumber(row.sortKey),
    addedBy: row.addedBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt,
  };
}

const toMergeable = (item: ItemView): MergeableItem => ({
  id: item.id,
  qty: item.qty,
  qtyUnit: item.qtyUnit,
  note: item.note,
  checked: item.checked,
  checkedBy: item.checkedBy,
  checkedAt: item.checkedAt,
  sortKey: item.sortKey,
  deletedAt: item.deletedAt,
  updatedAt: item.updatedAt,
  updatedBy: item.updatedBy,
});

/**
 * Resolves a share token to a list and a role.
 *
 * A revoked or expired token is indistinguishable from a wrong one by design:
 * the response must not reveal that a list exists behind a link someone is
 * guessing at.
 */
export async function authorize(token: string, need: Role = "viewer") {
  if (!isValidShareToken(token)) throw notFound();

  const [row] = await db
    .select({
      listId: shareTokens.listId,
      role: shareTokens.role,
      expiresAt: shareTokens.expiresAt,
      revokedAt: shareTokens.revokedAt,
    })
    .from(shareTokens)
    .where(eq(shareTokens.token, token))
    .limit(1);

  if (!row || row.revokedAt) throw notFound();
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw notFound();

  const role = row.role as Role;
  if (need === "editor" && role !== "editor") throw forbidden();

  return { listId: row.listId, role };
}

/**
 * Reconciles a client-supplied timestamp with the server's clock.
 *
 * Client and server clocks are different clocks, so comparing them directly is
 * not a causality check — it is a guess. Two rules make it behave:
 *
 * 1. A timestamp from the future is clamped to now, so a device with a fast
 *    clock cannot win every subsequent conflict on that list.
 * 2. A change that is not *clearly* older than what is stored is treated as
 *    newer. Explicit user intent that the server has not seen should land;
 *    without this, an edit made in the same second as the row it targets gets
 *    silently dropped on the tie-break, which is what happens to a check-off
 *    queued moments after the item was added.
 *
 * Beyond the tolerance the stored value still wins, so a genuinely stale
 * offline edit cannot overwrite someone else's newer change.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5_000;

function reconcileClientTime(clientAt: Date, storedAt: Date, now: Date): Date {
  const clamped = clientAt.getTime() < now.getTime() ? clientAt : now;
  const clearlyStale = clamped.getTime() < storedAt.getTime() - CLOCK_SKEW_TOLERANCE_MS;
  if (clearlyStale) return clamped;

  // Not clearly stale: make sure it actually wins rather than losing a tie.
  const winning = Math.max(clamped.getTime(), storedAt.getTime() + 1);
  return new Date(Math.min(winning, now.getTime() + 1));
}

/**
 * What makes two rows "the same thing" on a list: the product, or the typed
 * text ignoring case and surrounding space. Prefixed so a free-text line that
 * happens to be all digits never matches a product's EAN.
 */
function itemKey(row: { ean?: string | null; freeText?: string | null }): string | null {
  if (row.ean) return `ean:${row.ean}`;
  const text = row.freeText?.trim().toLowerCase();
  return text ? `text:${text}` : null;
}

/** The columns a new row takes from what the client sent about it. */
function contentValues(input: ItemContent) {
  return {
    ean: input.ean ?? null,
    freeText: input.freeText ?? null,
    nameSnapshot: input.nameSnapshot ?? null,
    priceCentsSnapshot: input.priceCentsSnapshot ?? null,
    aisleName: input.aisleName ?? null,
    aisleOrder: input.aisleOrder ?? null,
    imageUrl: input.imageUrl ?? null,
    comparisonCents: input.comparisonCents ?? null,
    comparisonUnit: input.comparisonUnit ?? null,
    discountPercent: input.discountPercent ?? null,
    discountType: input.discountType ?? null,
    offerAmount: input.offerAmount ?? null,
    offerBundleCents: input.offerBundleCents ?? null,
  };
}

/** An edit to an existing row, from the PATCH endpoint or an offline batch. */
interface ItemEdit {
  qty?: number | undefined;
  qtyUnit?: string | undefined;
  note?: string | null | undefined;
  sortKey?: number | undefined;
  checked?: boolean | undefined;
  deletedAt?: Date | null | undefined;
  updatedBy?: string | null | undefined;
}

/**
 * Resolves an edit against the stored row, field by field. `at` is the
 * client's time, already reconciled with the server's clock.
 */
function applyEdit(stored: MergeableItem, edit: ItemEdit, at: Date): MergeableItem {
  const incoming: MergeableItem = {
    ...stored,
    ...(edit.qty !== undefined ? { qty: edit.qty } : {}),
    ...(edit.qtyUnit !== undefined ? { qtyUnit: edit.qtyUnit } : {}),
    ...(edit.note !== undefined ? { note: edit.note ?? null } : {}),
    ...(edit.sortKey !== undefined ? { sortKey: edit.sortKey } : {}),
    ...(edit.checked !== undefined
      ? {
          checked: edit.checked,
          checkedBy: edit.checked ? (edit.updatedBy ?? null) : null,
          checkedAt: edit.checked ? at : null,
        }
      : {}),
    deletedAt: edit.deletedAt ?? stored.deletedAt,
    updatedAt: at,
    updatedBy: edit.updatedBy ?? null,
  };
  return mergeItem(stored, incoming).value;
}

/** The columns written back after a merge. */
function mergedValues(value: MergeableItem) {
  return {
    qty: String(value.qty),
    qtyUnit: value.qtyUnit,
    note: value.note,
    checked: value.checked,
    checkedBy: value.checkedBy,
    checkedAt: value.checkedAt,
    sortKey: String(value.sortKey),
    deletedAt: value.deletedAt,
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy,
  };
}

/** Creates a list plus its first share token, atomically. */
export async function createList(input: CreateListInput) {
  const listId = input.id ?? uuidv7();
  const token = generateShareToken();

  return db.transaction(async (tx) => {
    await tx.insert(lists).values({
      id: listId,
      name: input.name,
      ...(input.storeId ? { storeId: input.storeId } : {}),
    });

    await tx.insert(shareTokens).values({ token, listId, role: "editor" });

    let memberId: string | null = null;
    if (input.nickname) {
      memberId = uuidv7();
      await tx.insert(listMembers).values({ id: memberId, listId, nickname: input.nickname });
    }

    return { id: listId, token, memberId };
  });
}

/** Reads a list and its live items, ordered for display. */
export async function getList(token: string): Promise<ListView> {
  const { listId, role } = await authorize(token);

  const [list] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
  if (!list) throw notFound();

  const rows = await db
    .select()
    .from(listItems)
    .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)))
    .orderBy(asc(listItems.sortKey), asc(listItems.id));

  // Touch lastUsedAt so an unused link can be spotted later, but do not block
  // the response on it.
  void db
    .update(shareTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(shareTokens.token, token))
    .catch(() => undefined);

  return {
    id: list.id,
    name: list.name,
    storeId: list.storeId,
    archivedAt: list.archivedAt,
    updatedAt: list.updatedAt,
    role,
    token,
    memberId: null,
    items: rows.map(toItemView),
  };
}

/**
 * Adds an item, merging into an existing line when the same product is already
 * on the list.
 *
 * Two "Maito" rows is the bug people notice within the first minute, so the
 * duplicate check happens inside the transaction rather than optimistically on
 * the client.
 */
export async function addItem(token: string, input: CreateItemInput) {
  const { listId } = await authorize(token, "editor");
  const now = new Date();
  const author = input.addedBy ?? null;

  const result = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(listItems)
      .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)));

    const key = itemKey(input);
    const needle = existing.find((row) => itemKey(row) === key);

    if (needle) {
      const merged = toNumber(needle.qty) + input.qty;
      const [updated] = await tx
        .update(listItems)
        .set({
          qty: String(merged),
          // Re-adding something already crossed off means you want it again.
          checked: false,
          checkedAt: null,
          checkedBy: null,
          updatedAt: now,
          updatedBy: author,
        })
        .where(eq(listItems.id, needle.id))
        .returning();

      await bumpList(tx, listId, now);
      return { item: toItemView(updated!), merged: true };
    }

    const maxSortKey = existing.reduce(
      (max, row) => Math.max(max, toNumber(row.sortKey)),
      Number.NEGATIVE_INFINITY,
    );
    const sortKey =
      input.sortKey ?? sortKeyBetween(Number.isFinite(maxSortKey) ? maxSortKey : null, null);

    const [created] = await tx
      .insert(listItems)
      .values({
        id: input.id ?? uuidv7(),
        listId,
        ...contentValues(input),
        qty: String(input.qty),
        qtyUnit: input.qtyUnit,
        note: input.note ?? null,
        sortKey: String(sortKey),
        addedBy: author,
        updatedBy: author,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await bumpList(tx, listId, now);
    return { item: toItemView(created!), merged: false };
  });

  // Only once committed: a write that rolled back must never reach other
  // devices, and one that did commit must be readable by the time they refetch.
  void publish(
    listId,
    result.merged
      ? { type: "item.updated", item: result.item }
      : { type: "item.added", item: result.item },
    author,
  );
  return result;
}

/**
 * Applies an edit, resolving against whatever is already stored.
 *
 * The client sends its own `updatedAt`. It is clamped to now, because a device
 * with a fast clock would otherwise win every future conflict on that list.
 */
export async function updateItem(token: string, itemId: string, input: UpdateItemInput) {
  const { listId } = await authorize(token, "editor");
  // Compared against a uuid column: a malformed id is a missing row, not a 500.
  if (!isUuid(itemId)) throw notFound();
  const now = new Date();

  const view = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(listItems)
      .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
      .limit(1);

    if (!row) throw notFound();

    const stored = toMergeable(toItemView(row));
    const clientTime = reconcileClientTime(input.updatedAt ?? now, stored.updatedAt, now);
    const value = applyEdit(stored, input, clientTime);

    const [updated] = await tx
      .update(listItems)
      .set(mergedValues(value))
      .where(eq(listItems.id, itemId))
      .returning();

    await bumpList(tx, listId, now);
    return toItemView(updated!);
  });

  void publish(listId, { type: "item.updated", item: view }, input.updatedBy ?? null);
  return view;
}

/** Soft-deletes an item. Never a hard delete — see AGENTS.md. */
export async function deleteItem(token: string, itemId: string, by?: string | null) {
  const { listId } = await authorize(token, "editor");
  if (!isUuid(itemId)) throw notFound();
  const now = new Date();

  const [row] = await db
    .update(listItems)
    .set({ deletedAt: now, updatedAt: now, updatedBy: by ?? null })
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId), isNull(listItems.deletedAt)))
    .returning();

  if (!row) throw notFound();
  await bumpList(db, listId, now);
  void publish(listId, { type: "item.removed", itemId }, by ?? null);
  return toItemView(row);
}

/**
 * Applies a batch of edits accumulated offline and returns the reconciled list.
 *
 * The client sends everything it changed while disconnected; the server merges
 * each row and replies with the truth, so the device can replace its local copy
 * outright instead of trying to work out what happened.
 */
export async function syncItems(token: string, input: SyncInput): Promise<ItemView[]> {
  const { listId } = await authorize(token, "editor");
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const edit of input.items) {
      const [row] = await tx
        .select()
        .from(listItems)
        .where(and(eq(listItems.id, edit.id), eq(listItems.listId, listId)))
        .limit(1);

      if (!row) {
        // A row created while offline carries its content, so it can be
        // inserted. A bare edit for an unknown row is dropped instead: it
        // belongs to a different list, or to one already removed, and
        // inventing a row from an edit would resurrect deleted items.
        const isCreation = Boolean(edit.ean || edit.freeText);
        if (!isCreation || edit.deletedAt) continue;

        const madeAt = edit.updatedAt < now ? edit.updatedAt : now;
        const checked = edit.checked ?? false;
        await tx
          .insert(listItems)
          .values({
            id: edit.id,
            listId,
            ...contentValues(edit),
            qty: String(edit.qty ?? 1),
            qtyUnit: edit.qtyUnit ?? "kpl",
            note: edit.note ?? null,
            checked,
            // Ticked before it ever reached the server: credited like any
            // other check-off, rather than left anonymous.
            checkedBy: checked ? (edit.updatedBy ?? null) : null,
            checkedAt: checked ? madeAt : null,
            sortKey: String(edit.sortKey ?? 0),
            addedBy: edit.updatedBy ?? null,
            updatedBy: edit.updatedBy ?? null,
            createdAt: madeAt,
            updatedAt: madeAt,
          })
          // Two devices can flush the same offline row; the second must not
          // fail the whole batch.
          .onConflictDoNothing();
        continue;
      }

      const stored = toMergeable(toItemView(row));
      const clientTime = reconcileClientTime(edit.updatedAt, stored.updatedAt, now);
      const value = applyEdit(stored, edit, clientTime);

      await tx.update(listItems).set(mergedValues(value)).where(eq(listItems.id, edit.id));
    }

    await bumpList(tx, listId, now);
  });

  const rows = await db
    .select()
    .from(listItems)
    .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)))
    .orderBy(asc(listItems.sortKey), asc(listItems.id));

  const views = rows.map(toItemView);

  // A flushed offline batch can touch many rows at once; other viewers are
  // told about each one so their lists converge without a refetch.
  for (const edit of input.items) {
    const view = views.find((v) => v.id === edit.id);
    if (view) {
      void publish(listId, { type: "item.updated", item: view }, input.memberId ?? null);
    } else {
      void publish(listId, { type: "item.removed", itemId: edit.id }, input.memberId ?? null);
    }
  }

  return views;
}

/** Keeps the denormalised counter and the list's own updatedAt honest. */
async function bumpList(
  executor: Pick<typeof db, "update">,
  listId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(lists)
    .set({
      updatedAt: now,
      itemCount: sql`(
        select count(*) from ${listItems}
        where ${listItems.listId} = ${listId} and ${listItems.deletedAt} is null
      )`,
    })
    .where(eq(lists.id, listId));
}

export interface HistoryEntry {
  ean: string | null;
  freeText: string | null;
  name: string;
  priceCentsSnapshot: number | null;
  aisleName: string | null;
  aisleOrder: number | null;
  imageUrl: string | null;
  comparisonCents: number | null;
  comparisonUnit: string | null;
  discountPercent: number | null;
  discountType: string | null;
  offerAmount: number | null;
  offerBundleCents: number | null;
  qtyUnit: string;
  /** How many times this has been on the list before. */
  timesUsed: number;
}

/**
 * Things this list has bought before and is not holding right now.
 *
 * Households buy the same forty things over and over, so the fastest way to
 * build next week's list is to re-tap last week's. Scoped to the list rather
 * than the device, so it works for whoever opens the link.
 *
 * Rows currently on the list are excluded — offering to add something already
 * there is noise.
 */
export async function getHistory(token: string, limit = 12): Promise<HistoryEntry[]> {
  const { listId } = await authorize(token);

  const rows = await db
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(desc(listItems.updatedAt));

  // Keyed the same way `addItem` merges, so "on the list" means the same thing.
  const live = new Set(rows.filter((row) => !row.deletedAt).map(itemKey));

  const seen = new Map<string, HistoryEntry>();

  for (const row of rows) {
    const key = itemKey(row);
    if (!key || live.has(key)) continue;

    const name = row.nameSnapshot ?? row.freeText;
    if (!name) continue;

    const existing = seen.get(key);
    if (existing) {
      existing.timesUsed += 1;
      continue;
    }

    seen.set(key, {
      ean: row.ean,
      freeText: row.freeText,
      name,
      priceCentsSnapshot: row.priceCentsSnapshot,
      aisleName: row.aisleName,
      aisleOrder: row.aisleOrder,
      imageUrl: row.imageUrl,
      comparisonCents: row.comparisonCents,
      comparisonUnit: row.comparisonUnit,
      discountPercent: row.discountPercent,
      discountType: row.discountType,
      offerAmount: row.offerAmount,
      offerBundleCents: row.offerBundleCents,
      qtyUnit: row.qtyUnit,
      timesUsed: 1,
    });
  }

  return [...seen.values()]
    .sort((a, b) => b.timesUsed - a.timesUsed || a.name.localeCompare(b.name, "fi"))
    .slice(0, limit);
}
