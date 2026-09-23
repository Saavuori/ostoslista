import { describe, expect, it } from "vitest";
import type { ItemView } from "@/lib/lists/service";
import { groupByAisle, isGroupingUseful, UNGROUPED } from "./grouping";

let counter = 0;
function item(overrides: Partial<ItemView> = {}): ItemView {
  counter += 1;
  return {
    id: `item-${String(counter).padStart(3, "0")}`,
    ean: null,
    freeText: "Jotain",
    nameSnapshot: null,
    priceCentsSnapshot: null,
    aisleName: null,
    aisleOrder: null,
    imageUrl: null,
    comparisonCents: null,
    comparisonUnit: null,
    discountPercent: null,
    discountType: null,
    offerAmount: null,
    offerBundleCents: null,
    shelfModule: null,
    shelfLevel: null,
    qty: 1,
    qtyUnit: "kpl",
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    sortKey: counter,
    addedBy: null,
    updatedAt: new Date(),
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

const fish = { aisleName: "Kala ja merenelävät", aisleOrder: 115 };
const dairy = { aisleName: "Maito ja munat", aisleOrder: 40 };
const ready = { aisleName: "Valmisruoka", aisleOrder: 157 };

describe("groupByAisle", () => {
  it("returns nothing for an empty list", () => {
    expect(groupByAisle([])).toEqual([]);
  });

  it("puts items of the same aisle together", () => {
    const groups = groupByAisle([item(fish), item(dairy), item(fish)]);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.name === "Kala ja merenelävät")?.items).toHaveLength(2);
  });

  // The point of the feature: walk the shop once.
  it("orders aisles by their position in the shop, not by when items were added", () => {
    const groups = groupByAisle([item(ready), item(fish), item(dairy)]);

    expect(groups.map((g) => g.name)).toEqual([
      "Maito ja munat",
      "Kala ja merenelävät",
      "Valmisruoka",
    ]);
  });

  it("puts free-text items last, where they can be dealt with on the way out", () => {
    const groups = groupByAisle([item(), item(fish)]);

    expect(groups.map((g) => g.name)).toEqual(["Kala ja merenelävät", UNGROUPED]);
  });

  it("groups every unaisled item together rather than one group each", () => {
    const groups = groupByAisle([item(), item(), item()]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(3);
  });

  it("keeps the manual order within an aisle", () => {
    const first = item({ ...fish, sortKey: 5 });
    const second = item({ ...fish, sortKey: 1 });

    const items = groupByAisle([first, second])[0]?.items;

    expect(items?.map((i) => i.sortKey)).toEqual([1, 5]);
  });

  // One row with a missing order should not drag its whole aisle to the end.
  it("places an aisle by the earliest position any of its items claims", () => {
    const groups = groupByAisle([
      item({ aisleName: "Kala ja merenelävät", aisleOrder: null }),
      item(fish),
      item(dairy),
    ]);

    expect(groups[0]?.name).toBe("Maito ja munat");
    expect(groups[1]?.name).toBe("Kala ja merenelävät");
  });

  it("orders equally placed aisles alphabetically, in Finnish", () => {
    const groups = groupByAisle([
      item({ aisleName: "Öljyt", aisleOrder: 10 }),
      item({ aisleName: "Auki", aisleOrder: 10 }),
    ]);

    expect(groups.map((g) => g.name)).toEqual(["Auki", "Öljyt"]);
  });

  it("does not lose or duplicate any item", () => {
    const items = [item(fish), item(dairy), item(), item(ready), item(fish)];
    const grouped = groupByAisle(items).flatMap((g) => g.items);

    expect(grouped).toHaveLength(items.length);
    expect(new Set(grouped.map((i) => i.id)).size).toBe(items.length);
  });
});

describe("isGroupingUseful", () => {
  it("is false for a list with no aisle information", () => {
    expect(isGroupingUseful([item(), item(), item()])).toBe(false);
  });

  // Headings for a single aisle are just noise on a phone.
  it("is false when everything is in one aisle", () => {
    expect(isGroupingUseful([item(fish), item(fish)])).toBe(false);
  });

  it("is false with only a single aisled item", () => {
    expect(isGroupingUseful([item(fish), item(), item()])).toBe(false);
  });

  it("is true once two aisles are represented", () => {
    expect(isGroupingUseful([item(fish), item(dairy), item()])).toBe(true);
  });
});
