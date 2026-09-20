import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { listItems, listMembers, lists, shareTokens } from "@/lib/db/schema";
import { generateShareToken, isValidShareToken, uuidv7 } from "@/lib/ids";
import { type MergeableItem, mergeItem, sortKeyBetween } from "@/lib/sync/lww";
import type { CreateItemInput, CreateListInput, SyncInput, UpdateItemInput } from "./validation";

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

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(listItems)
      .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)));

    const needle = input.ean
      ? existing.find((row) => row.ean === input.ean)
      : existing.find(
          (row) => row.freeText?.trim().toLowerCase() === input.freeText?.trim().toLowerCase(),
        );

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
          updatedBy: input.addedBy ?? null,
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
        ean: input.ean ?? null,
        freeText: input.freeText ?? null,
        nameSnapshot: input.nameSnapshot ?? null,
        priceCentsSnapshot: input.priceCentsSnapshot ?? null,
        qty: String(input.qty),
        qtyUnit: input.qtyUnit,
        note: input.note ?? null,
        sortKey: String(sortKey),
        addedBy: input.addedBy ?? null,
        updatedBy: input.addedBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await bumpList(tx, listId, now);
    return { item: toItemView(created!), merged: false };
  });
}

/**
 * Applies an edit, resolving against whatever is already stored.
 *
 * The client sends its own `updatedAt`. It is clamped to now, because a device
 * with a fast clock would otherwise win every future conflict on that list.
 */
export async function updateItem(token: string, itemId: string, input: UpdateItemInput) {
  const { listId } = await authorize(token, "editor");
  const now = new Date();
  const clientTime = input.updatedAt && input.updatedAt < now ? input.updatedAt : now;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(listItems)
      .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
      .limit(1);

    if (!row) throw notFound();

    const stored = toItemView(row);
    const incoming: MergeableItem = {
      ...toMergeable(stored),
      ...(input.qty !== undefined ? { qty: input.qty } : {}),
      ...(input.qtyUnit !== undefined ? { qtyUnit: input.qtyUnit } : {}),
      ...(input.note !== undefined ? { note: input.note ?? null } : {}),
      ...(input.sortKey !== undefined ? { sortKey: input.sortKey } : {}),
      ...(input.checked !== undefined
        ? {
            checked: input.checked,
            checkedBy: input.checked ? (input.updatedBy ?? null) : null,
            checkedAt: input.checked ? clientTime : null,
          }
        : {}),
      updatedAt: clientTime,
      updatedBy: input.updatedBy ?? null,
    };

    const { value } = mergeItem(toMergeable(stored), incoming);

    const [updated] = await tx
      .update(listItems)
      .set({
        qty: String(value.qty),
        qtyUnit: value.qtyUnit,
        note: value.note,
        checked: value.checked,
        checkedBy: value.checkedBy,
        checkedAt: value.checkedAt,
        sortKey: String(value.sortKey),
        updatedAt: value.updatedAt,
        updatedBy: value.updatedBy,
      })
      .where(eq(listItems.id, itemId))
      .returning();

    await bumpList(tx, listId, now);
    return toItemView(updated!);
  });
}

/** Soft-deletes an item. Never a hard delete — see AGENTS.md. */
export async function deleteItem(token: string, itemId: string, by?: string | null) {
  const { listId } = await authorize(token, "editor");
  const now = new Date();

  const [row] = await db
    .update(listItems)
    .set({ deletedAt: now, updatedAt: now, updatedBy: by ?? null })
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId), isNull(listItems.deletedAt)))
    .returning();

  if (!row) throw notFound();
  await bumpList(db, listId, now);
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

      // An edit for a row this list never had is dropped rather than inserted:
      // it belongs to a different list, or to one that was already removed.
      if (!row) continue;

      const stored = toMergeable(toItemView(row));
      const clientTime = edit.updatedAt < now ? edit.updatedAt : now;

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
              checkedAt: edit.checked ? clientTime : null,
            }
          : {}),
        deletedAt: edit.deletedAt ?? stored.deletedAt,
        updatedAt: clientTime,
        updatedBy: edit.updatedBy ?? null,
      };

      const { value } = mergeItem(stored, incoming);

      await tx
        .update(listItems)
        .set({
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
        })
        .where(eq(listItems.id, edit.id));
    }

    await bumpList(tx, listId, now);
  });

  const rows = await db
    .select()
    .from(listItems)
    .where(and(eq(listItems.listId, listId), isNull(listItems.deletedAt)))
    .orderBy(asc(listItems.sortKey), asc(listItems.id));

  return rows.map(toItemView);
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
