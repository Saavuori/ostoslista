import { describe, expect, it } from "vitest";
import { shelfLabel } from "@/components/ItemRow";
import { storeAisleOrder } from "./aisles";
import { normalizeLocation } from "./location";

// Trimmed from a real GET /kr-api/v4/products/6410405132376?storeId=N106.
const mozzarella = {
  product: {
    ean: "6410405132376",
    location: {
      ean: "6410405132376",
      name: "Pirkka mozzarella 200g/125g",
      segment: "2445",
      module: "05",
      level: "1",
      department: { id: "219", name: "Juusto", orderNumber: 97, zone: null, isPublic: true },
    },
  },
};

describe("normalizeLocation", () => {
  it("reads department, order, shelf and level", () => {
    expect(normalizeLocation(mozzarella)).toEqual({
      departmentName: "Juusto",
      departmentOrder: 97,
      module: "05",
      level: "1",
    });
  });

  it("returns null when the store has no location for the product", () => {
    expect(normalizeLocation({ product: { ean: "1" } })).toBeNull();
    expect(normalizeLocation({ product: { location: { department: null } } })).toBeNull();
    expect(normalizeLocation(null)).toBeNull();
    expect(normalizeLocation("<html>")).toBeNull();
  });

  it("ignores departments the store marks as not public", () => {
    const hidden = structuredClone(mozzarella);
    hidden.product.location.department.isPublic = false;
    expect(normalizeLocation(hidden)).toBeNull();
  });
});

describe("storeAisleOrder", () => {
  // Iso Omena numbers produce ~117 and beer 6; the walk starts at produce.
  it("puts higher store departments earlier", () => {
    expect(storeAisleOrder(117)).toBeLessThan(storeAisleOrder(97));
    expect(storeAisleOrder(97)).toBeLessThan(storeAisleOrder(6));
  });

  it("sorts every store department before web-category fallbacks", () => {
    expect(storeAisleOrder(1)).toBeLessThan(10);
  });
});

describe("shelfLabel", () => {
  it("formats shelf and level", () => {
    expect(shelfLabel("06", "5")).toEqual({ module: "06", level: "5", full: "hylly 06, taso 5" });
    expect(shelfLabel("06", null)?.full).toBe("hylly 06");
  });

  it("hides the all-zero placeholder location", () => {
    expect(shelfLabel("00", "0")).toBeNull();
    expect(shelfLabel("14", "0")).toEqual({ module: "14", level: null, full: "hylly 14" });
    expect(shelfLabel(null, "1")).toBeNull();
  });
});
