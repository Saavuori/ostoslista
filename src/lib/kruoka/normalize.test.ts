import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/kruoka-search.json";
import { lineTotal, normalizeProduct, normalizeSearchResponse } from "./normalize";
import type { Product } from "./types";

const products = normalizeSearchResponse(fixture, "N106");
const byEan = (ean: string): Product => {
  const found = products.find((p) => p.ean === ean);
  if (!found) throw new Error(`fixture missing ${ean}`);
  return found;
};

describe("normalizeSearchResponse", () => {
  it("maps every product in the fixture", () => {
    expect(products).toHaveLength(5);
  });

  it("returns an empty array for junk input instead of throwing", () => {
    expect(normalizeSearchResponse(null, "N106")).toEqual([]);
    expect(normalizeSearchResponse({}, "N106")).toEqual([]);
    expect(normalizeSearchResponse({ result: "nope" }, "N106")).toEqual([]);
  });
});

describe("product fields", () => {
  it("reads name, brand, category and image", () => {
    const soup = byEan("6412000031849");
    expect(soup.name).toBe("Saarioinen kirjolohikeitto 300g");
    expect(soup.nameSv).toBe("Saarioinen regnbågslaxsoppa 300g");
    expect(soup.brand).toBe("Saarioinen");
    expect(soup.categoryPath).toBe("valmisruoka/valmisruoat-ja--keitot/mikrokeitot");
    expect(soup.categoryName).toBe("Mikrokeitot");
    expect(soup.section).toBe("1304");
    expect(soup.imageUrl).toBe("https://public.keskofiles.com/f/k-ruoka/product/6412000031849");
    expect(soup.originCountry).toBe("fi");
  });

  it("distinguishes store-local products from national ones", () => {
    expect(byEan("2000456700002").isLocal).toBe(true);
    expect(byEan("6412000031849").isLocal).toBe(false);
  });

  it("keeps the store-suffixed id for local products so it stays unique", () => {
    expect(byEan("2000456700002").id).toBe("2000456700002-N106");
  });

  it("brand is null when upstream omits it", () => {
    expect(byEan("2000456700002").brand).toBeNull();
  });
});

describe("soldBy", () => {
  it("detects pieces", () => {
    expect(byEan("6412000031849").soldBy).toBe("piece");
  });

  it("detects loose goods sold by weight", () => {
    const fillet = byEan("2000456700002");
    expect(fillet.soldBy).toBe("mass");
    expect(fillet.pricing.normal.unit).toBe("kg");
  });

  it("detects approximate-piece goods and keeps the average weight", () => {
    const wholeFish = byEan("2000409600007");
    expect(wholeFish.soldBy).toBe("approximatePiece");
    expect(wholeFish.averageWeight).toBe(1.5);
    expect(wholeFish.pricing.normal.isApproximate).toBe(true);
  });
});

describe("pricing", () => {
  it("parses a plain shelf price", () => {
    const { normal, best, offers } = byEan("6412000031849").pricing;
    expect(normal.price).toBe(2.89);
    expect(normal.effectiveUnitPrice).toBe(2.89);
    expect(normal.comparisonPrice).toBe(9.63);
    expect(normal.comparisonUnit).toBe("kg");
    expect(offers).toHaveLength(1);
    expect(best).toBe(normal);
  });

  it("parses a per-unit discount and prefers it", () => {
    const { normal, best, offers } = byEan("6405304002073").pricing;
    expect(normal.price).toBe(6.59);
    expect(offers).toHaveLength(2);
    expect(best.kind).toBe("discount");
    expect(best.price).toBe(5.89);
    expect(best.amount).toBe(1);
    expect(best.discountPercent).toBe(10);
    expect(best.discountType).toBe("PLUSSA");
    expect(best.validUntil).toBe("2026-09-27T20:59:59.000Z");
  });

  // The regression this whole layer exists to prevent: upstream reports the
  // bundle price, so a naive read prices "2 for 4,50" at 4,50 each.
  it("converts a batch offer's bundle price to a per-unit price", () => {
    const { normal, best } = byEan("6410402025602").pricing;
    expect(normal.price).toBe(2.39);
    expect(best.kind).toBe("batch");
    expect(best.price).toBe(4.5);
    expect(best.amount).toBe(2);
    expect(best.effectiveUnitPrice).toBe(2.25);
  });

  it("never picks an offer more expensive than the shelf price", () => {
    for (const product of products) {
      expect(product.pricing.best.effectiveUnitPrice).toBeLessThanOrEqual(
        product.pricing.normal.effectiveUnitPrice,
      );
    }
  });
});

describe("normalizeProduct", () => {
  it("drops entries with no usable price rather than guessing", () => {
    const priceless = {
      product: {
        id: "1",
        ean: "1",
        localizedName: { finnish: "Mystery item" },
        mobilescan: { pricing: {} },
      },
    };
    expect(normalizeProduct(priceless, "N106")).toBeNull();
  });

  it("drops entries with no name", () => {
    const nameless = {
      product: {
        id: "1",
        ean: "1",
        mobilescan: { pricing: { normal: { price: 1, unit: "kpl" } } },
      },
    };
    expect(normalizeProduct(nameless, "N106")).toBeNull();
  });

  it("falls back to the requested store id when the payload omits one", () => {
    const storeless = {
      product: {
        id: "1",
        ean: "1",
        localizedName: { finnish: "Thing" },
        mobilescan: { pricing: { normal: { price: 1, unit: "kpl" } } },
      },
    };
    expect(normalizeProduct(storeless, "N999")?.storeId).toBe("N999");
  });
});

describe("lineTotal", () => {
  const plain = byEan("6412000031849").pricing;
  const discounted = byEan("6405304002073").pricing;
  const batched = byEan("6410402025602").pricing;

  it("is zero for a zero or negative quantity", () => {
    expect(lineTotal(plain, 0)).toBe(0);
    expect(lineTotal(plain, -1)).toBe(0);
  });

  it("multiplies a plain price without floating point drift", () => {
    expect(lineTotal(plain, 3)).toBe(8.67);
  });

  it("uses the discounted price", () => {
    expect(lineTotal(discounted, 2)).toBe(11.78);
  });

  it("charges the bundle price for a complete batch", () => {
    expect(lineTotal(batched, 2)).toBe(4.5);
    expect(lineTotal(batched, 4)).toBe(9);
  });

  // Buying 1 of a "2 for 4,50" deal costs the normal 2,39 — not 2,25.
  it("charges the normal price for units outside a complete bundle", () => {
    expect(lineTotal(batched, 1)).toBe(2.39);
    expect(lineTotal(batched, 3)).toBe(6.89);
  });

  it("handles fractional quantities for goods sold by weight", () => {
    const fillet = byEan("2000456700002").pricing;
    expect(lineTotal(fillet, 0.4)).toBeCloseTo(12.0, 2);
  });
});
