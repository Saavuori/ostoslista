import type { OutboxEntry, OutboxOp, StoredItem } from "./db";

/**
 * Outbox semantics, kept free of Dexie and fetch so they can be tested
 * directly. `queue.ts` is the thin part that talks to storage and the network.
 *
 * The central idea: the outbox holds *intent*, not a replay log. Ticking an
 * item five times while offline should send one change, not five — and if you
 * tick it and then delete it, only the delete matters. Collapsing here is what
 * keeps a long offline trip from producing a flood on reconnect.
 */

/**
 * Folds a new change into whatever is already queued for that row.
 *
 * Returns the full replacement queue for the row, which is always zero or one
 * entry.
 */
export function collapse(existing: OutboxEntry | undefined, incoming: OutboxEntry): OutboxEntry[] {
  if (!existing) return [incoming];

  // A delete supersedes everything queued before it. If the row was also
  // created offline the server has never seen it, so nothing needs sending.
  if (incoming.op === "delete") {
    if (existing.op === "create") return [];
    return [{ ...incoming, seq: existing.seq, attempts: 0 }];
  }

  // Edits fold into a pending creation: the row goes up once, complete.
  if (existing.op === "create") {
    return [
      {
        ...existing,
        patch: { ...existing.patch, ...incoming.patch },
        queuedAt: incoming.queuedAt,
        attempts: 0,
      },
    ];
  }

  // Edit over edit: last value per field wins, which matches the server's
  // per-field last-write-wins reconciliation.
  return [
    {
      ...existing,
      op: incoming.op,
      patch: { ...existing.patch, ...incoming.patch },
      queuedAt: incoming.queuedAt,
      attempts: 0,
    },
  ];
}

/** Shape the sync endpoint accepts. */
export interface SyncEdit {
  id: string;
  ean?: string | null;
  freeText?: string | null;
  nameSnapshot?: string | null;
  priceCentsSnapshot?: number | null;
  qty?: number;
  qtyUnit?: string;
  note?: string | null;
  checked?: boolean;
  sortKey?: number;
  deletedAt?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
}

/**
 * Turns queued entries into a sync payload.
 *
 * Creations carry their content so the server can insert them; edits carry
 * only what changed. Deletes become tombstones rather than absences, because
 * the server must be able to tell "removed" from "never mentioned".
 */
export function toSyncPayload(
  entries: OutboxEntry[],
  memberId: string | null,
): {
  memberId: string | null;
  items: SyncEdit[];
} {
  const items = entries.map((entry) => {
    const patch = entry.patch;
    const edit: SyncEdit = {
      id: entry.itemId,
      updatedAt: entry.queuedAt.toISOString(),
      updatedBy: memberId,
    };

    if (entry.op === "delete") {
      edit.deletedAt = entry.queuedAt.toISOString();
      return edit;
    }

    if (entry.op === "create") {
      edit.ean = patch.ean ?? null;
      edit.freeText = patch.freeText ?? null;
      edit.nameSnapshot = patch.nameSnapshot ?? null;
      edit.priceCentsSnapshot = patch.priceCentsSnapshot ?? null;
    }

    if (patch.qty !== undefined) edit.qty = patch.qty;
    if (patch.qtyUnit !== undefined) edit.qtyUnit = patch.qtyUnit;
    if (patch.note !== undefined) edit.note = patch.note;
    if (patch.checked !== undefined) edit.checked = patch.checked;
    if (patch.sortKey !== undefined) edit.sortKey = patch.sortKey;

    return edit;
  });

  return { memberId, items };
}

/**
 * Applies a queued change to the local row, so the UI reflects it immediately.
 *
 * This is what makes the app usable with no signal: the screen is driven by
 * local state, and the network is reconciliation that happens later.
 */
export function applyLocally(
  item: StoredItem,
  op: OutboxOp,
  patch: Partial<StoredItem>,
): StoredItem {
  if (op === "delete") {
    return { ...item, deletedAt: patch.deletedAt ?? new Date() };
  }
  return { ...item, ...patch };
}

/** Exponential backoff with a ceiling, so a broken server is not hammered. */
export function retryDelayMs(attempts: number): number {
  const base = 1000 * 2 ** Math.min(attempts, 6);
  return Math.min(base, 60_000);
}

/**
 * Whether an entry should be abandoned.
 *
 * Retrying forever hides a real problem; the UI surfaces the failure instead
 * so the change is not silently lost.
 */
export function shouldGiveUp(entry: OutboxEntry): boolean {
  return entry.attempts >= 8;
}
