import type { ItemView } from "@/lib/lists/service";

/**
 * Shopping-mode ordering.
 *
 * The single biggest quality-of-life feature in a grocery list: walking the
 * shop once instead of criss-crossing it because the list is in the order
 * things were thought of.
 *
 * The upstream category order approximates the layout of a K-store, so it is
 * used as the aisle sequence. It is an approximation and will not match every
 * shop exactly — but "roughly right, grouped" beats "exactly the order someone
 * typed them".
 */

export interface AisleGroup {
  /** Display name, e.g. "Kala ja merenelävät". */
  name: string;
  /** Sort position; unknown aisles go last. */
  order: number;
  items: ItemView[];
}

/** Free-text items have no aisle — they go in their own group at the end. */
export const UNGROUPED = "Muut";

/** Ungrouped items sort after every real aisle. */
const UNGROUPED_ORDER = Number.MAX_SAFE_INTEGER;

/**
 * Groups items by aisle, ordered for a single pass through the shop.
 *
 * Items within an aisle keep their manual order, so a deliberate arrangement
 * is not destroyed by switching modes.
 */
export function groupByAisle(items: ItemView[]): AisleGroup[] {
  const groups = new Map<string, AisleGroup>();

  for (const item of items) {
    const name = item.aisleName ?? UNGROUPED;
    const order = item.aisleName ? (item.aisleOrder ?? UNGROUPED_ORDER - 1) : UNGROUPED_ORDER;

    const group = groups.get(name);
    if (group) {
      group.items.push(item);
      // An aisle's position is the earliest any of its items claims, so one
      // row with a missing order does not push the whole aisle to the end.
      group.order = Math.min(group.order, order);
    } else {
      groups.set(name, { name, order, items: [item] });
    }
  }

  const sorted = [...groups.values()].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, "fi"),
  );

  for (const group of sorted) {
    group.items.sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));
  }

  return sorted;
}

/**
 * Whether grouping is worth showing.
 *
 * With one aisle, or with almost everything ungrouped, the headings are just
 * noise on a small screen.
 */
export function isGroupingUseful(items: ItemView[]): boolean {
  const withAisle = items.filter((item) => item.aisleName);
  if (withAisle.length < 2) return false;

  const distinct = new Set(withAisle.map((item) => item.aisleName)).size;
  return distinct >= 2;
}
