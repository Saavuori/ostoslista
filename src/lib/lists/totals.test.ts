import { describe, expect, it } from "vitest";
import { lineTotalCents, sumCents } from "./totals";

const line = (over: Partial<Parameters<typeof lineTotalCents>[0]>) => ({
  priceCentsSnapshot: 239,
  offerAmount: null,
  offerBundleCents: null,
  qty: 1,
  ...over,
});

describe("lineTotalCents", () => {
  it("is unit price times quantity with no offer", () => {
    expect(lineTotalCents(line({ qty: 3 }))).toBe(717);
  });

  it("is null when there is no price", () => {
    expect(lineTotalCents(line({ priceCentsSnapshot: null }))).toBeNull();
  });

  it("rounds weighed goods to whole cents", () => {
    expect(lineTotalCents(line({ priceCentsSnapshot: 1999, qty: 0.4 }))).toBe(800);
  });

  // The trap in AGENTS.md: one of a "2 for 4,50" is the shelf price.
  it("charges the shelf price for a partial bundle", () => {
    expect(lineTotalCents(line({ offerAmount: 2, offerBundleCents: 450, qty: 1 }))).toBe(239);
  });

  it("charges the bundle price for a complete bundle", () => {
    expect(lineTotalCents(line({ offerAmount: 2, offerBundleCents: 450, qty: 2 }))).toBe(450);
  });

  it("charges bundles plus the remainder at shelf price", () => {
    expect(lineTotalCents(line({ offerAmount: 2, offerBundleCents: 450, qty: 5 }))).toBe(
      2 * 450 + 239,
    );
  });

  it("ignores an offer of a single unit", () => {
    expect(lineTotalCents(line({ offerAmount: 1, offerBundleCents: 199, qty: 2 }))).toBe(478);
  });
});

describe("sumCents", () => {
  it("adds lines and skips unpriced ones", () => {
    expect(
      sumCents([
        line({ offerAmount: 2, offerBundleCents: 450, qty: 3 }),
        line({ priceCentsSnapshot: null }),
        line({ priceCentsSnapshot: 100, qty: 2 }),
      ]),
    ).toBe(450 + 239 + 200);
  });
});
