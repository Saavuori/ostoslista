import { describe, expect, it } from "vitest";
import { productImageUrl } from "./images";

const BASE = "https://public.keskofiles.com/f/k-ruoka/product/6411300000494";

describe("productImageUrl", () => {
  // The originals are ~1440x2288; drawing one in a 48px box wastes about a
  // megabyte of someone's mobile data.
  it("asks the CDN for the size actually drawn, doubled for retina", () => {
    expect(productImageUrl(BASE, 48)).toBe(`${BASE}?w=96`);
  });

  it("replaces an existing width rather than appending a second one", () => {
    expect(productImageUrl(`${BASE}?w=1200`, 48)).toBe(`${BASE}?w=96`);
  });

  it("returns null for a missing image", () => {
    expect(productImageUrl(null, 48)).toBeNull();
  });

  // A width parameter might mean something else entirely elsewhere.
  it("leaves unknown hosts untouched", () => {
    expect(productImageUrl("https://example.test/kuva.jpg", 48)).toBe(
      "https://example.test/kuva.jpg",
    );
  });

  it("leaves an unparseable value untouched", () => {
    expect(productImageUrl("not-a-url", 48)).toBe("not-a-url");
  });
});
