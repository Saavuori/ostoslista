/**
 * Last-write-wins reconciliation for list items.
 *
 * Deliberately not a CRDT. The edits that actually collide on a grocery list
 * are: two people check the same item, two people add the same product, or
 * someone edits a quantity while offline. Checking is idempotent, duplicate
 * adds are merged by product, and quantity conflicts are rare and low-stakes.
 * A CRDT would buy correctness nobody would notice and cost complexity
 * everybody would.
 *
 * Resolution is per field rather than per row, so two people editing different
 * fields of the same item both keep their change.
 */

export interface Versioned {
  updatedAt: Date;
  updatedBy: string | null;
}

/** The fields that reconcile independently. */
export interface MergeableItem extends Versioned {
  id: string;
  qty: number;
  qtyUnit: string;
  note: string | null;
  checked: boolean;
  checkedBy: string | null;
  checkedAt: Date | null;
  sortKey: number;
  deletedAt: Date | null;
}

export type MergeOutcome = "local" | "remote" | "merged";

export interface MergeResult<T> {
  value: T;
  outcome: MergeOutcome;
}

/**
 * Picks the winning write.
 *
 * Ties break on `updatedBy` rather than randomly, so every device in the mesh
 * independently reaches the same answer. Without that, two clients can each
 * decide they won and flip the value back and forth forever.
 */
function winner<T extends Versioned>(local: T, remote: T): "local" | "remote" {
  const localMs = local.updatedAt.getTime();
  const remoteMs = remote.updatedAt.getTime();
  if (localMs > remoteMs) return "local";
  if (remoteMs > localMs) return "remote";
  return (local.updatedBy ?? "") >= (remote.updatedBy ?? "") ? "local" : "remote";
}

/**
 * Merges two versions of the same item.
 *
 * Deletion is special-cased: a tombstone always wins over an edit regardless of
 * timestamp. Someone deliberately removed the row, and having it reappear
 * because another device happened to touch it later is the single most
 * confusing thing a shared list can do.
 */
export function mergeItem(local: MergeableItem, remote: MergeableItem): MergeResult<MergeableItem> {
  if (local.id !== remote.id) {
    throw new Error(`cannot merge different items: ${local.id} vs ${remote.id}`);
  }

  if (local.deletedAt || remote.deletedAt) {
    const deletedAt = local.deletedAt ?? remote.deletedAt!;
    const side = local.deletedAt ? local : remote;
    return {
      value: { ...side, deletedAt },
      outcome:
        local.deletedAt && remote.deletedAt ? "merged" : local.deletedAt ? "local" : "remote",
    };
  }

  const side = winner(local, remote);
  const win = side === "local" ? local : remote;
  const lose = side === "local" ? remote : local;

  // The checked flag itself is plain last-write-wins, so unchecking something
  // always works. But when both sides independently checked the item — the
  // common race, two people ticking it in the same aisle — attribution goes to
  // whoever actually got there first rather than to whichever write landed last.
  const attribution =
    win.checked && lose.checked && lose.checkedAt && win.checkedAt
      ? lose.checkedAt < win.checkedAt
        ? lose
        : win
      : win;

  const value: MergeableItem = {
    ...win,
    checkedBy: win.checked ? (attribution.checkedBy ?? lose.checkedBy) : null,
    checkedAt: win.checked ? (attribution.checkedAt ?? lose.checkedAt) : null,
  };

  return { value, outcome: side };
}

/**
 * Merges a batch of remote items into a local set.
 *
 * Items present on only one side are taken as-is; items on both are merged
 * field by field.
 */
export function mergeItemSets(local: MergeableItem[], remote: MergeableItem[]): MergeableItem[] {
  const byId = new Map<string, MergeableItem>();
  for (const item of local) byId.set(item.id, item);

  for (const incoming of remote) {
    const existing = byId.get(incoming.id);
    byId.set(incoming.id, existing ? mergeItem(existing, incoming).value : incoming);
  }

  return [...byId.values()];
}

/**
 * Finds an existing live line for the same product.
 *
 * Adding a product that is already on the list should bump its quantity rather
 * than create a second line — two "Maito" rows is a bug people notice
 * immediately.
 */
export function findDuplicate(
  items: MergeableItem[],
  candidate: { ean: string | null; freeText: string | null },
  keyOf: (item: MergeableItem) => { ean: string | null; freeText: string | null },
): MergeableItem | null {
  const wantEan = candidate.ean;
  const wantText = candidate.freeText?.trim().toLowerCase() ?? null;

  for (const item of items) {
    if (item.deletedAt) continue;
    const key = keyOf(item);
    if (wantEan && key.ean === wantEan) return item;
    if (!wantEan && wantText && key.freeText?.trim().toLowerCase() === wantText) return item;
  }
  return null;
}

/**
 * Sort key placing a new item after `after`.
 *
 * Fractional keys let a device insert between two rows without renumbering the
 * list, which matters because renumbering offline would conflict with every
 * other pending edit.
 */
export function sortKeyBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return after! - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
