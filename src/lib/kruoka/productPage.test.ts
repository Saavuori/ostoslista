import { describe, expect, it } from "vitest";
import { extractLdNodes, fetchProductBySlug, parseProductPage } from "./productPage";

/**
 * Fixtures below are the JSON-LD K-Ruoka actually publishes, captured from
 * live product pages on 2026-09-20 and trimmed. Structure is verbatim.
 */

function page(graph: unknown): string {
  return `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": graph,
    })}</script>
  </head><body></body></html>`;
}

const CASSEROLE = {
  "@type": "Product",
  name: "Pirkka kirjolohikiusaus 300 g",
  image: ["https://public.keskofiles.com/f/k-ruoka/product/6410402025602"],
  gtin13: "6410402025602",
  productID: "6410402025602",
  brand: { "@type": "Brand", name: "Pirkka" },
  weight: { "@type": "QuantitativeValue", value: 0.3, unitText: "kg" },
  offers: {
    "@type": "Offer",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: 2.39,
      priceCurrency: "EUR",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "ct" },
    },
    availability: "https://schema.org/InStock",
    seller: { "@type": "Organization", name: "K-Citymarket Espoo Iso Omena" },
  },
};

const SALMON = {
  "@type": "Product",
  name: "Kirjolohifilee C-leikkuu kg",
  gtin13: "2000456700002",
  offers: {
    "@type": "Offer",
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: 29.99,
      priceCurrency: "EUR",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "kg" },
    },
    availability: "https://schema.org/InStock",
  },
};

const BREADCRUMB = {
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      item: {
        "@id": "https://www.k-ruoka.fi/kauppa/tuotehaku/kala-ja-merenelavat",
        name: "Kala ja merenelävät",
      },
    },
    {
      "@type": "ListItem",
      position: 2,
      item: {
        "@id": "https://www.k-ruoka.fi/kauppa/tuotehaku/kala-ja-merenelavat/tuorekala",
        name: "Tuorekala",
      },
    },
  ],
};

describe("extractLdNodes", () => {
  it("flattens an @graph container", () => {
    const nodes = extractLdNodes(page([CASSEROLE, BREADCRUMB]));
    expect(nodes.map((n) => n["@type"])).toEqual(["Product", "BreadcrumbList"]);
  });

  it("returns nothing for a page with no structured data", () => {
    expect(extractLdNodes("<html><body>ei mitään</body></html>")).toEqual([]);
  });

  // One bad block must not take out the whole page.
  it("skips a malformed block and keeps the rest", () => {
    const html = `<script type="application/ld+json">{ not json }</script>${page([CASSEROLE])}`;
    expect(extractLdNodes(html)).toHaveLength(1);
  });
});

describe("parseProductPage", () => {
  it("reads name, ean, brand, image and price", () => {
    const product = parseProductPage(page([CASSEROLE, BREADCRUMB]), "N106");

    expect(product?.name).toBe("Pirkka kirjolohikiusaus 300 g");
    expect(product?.ean).toBe("6410402025602");
    expect(product?.brand).toBe("Pirkka");
    expect(product?.imageUrl).toContain("public.keskofiles.com");
    expect(product?.pricing.normal.price).toBe(2.39);
    expect(product?.storeId).toBe("N106");
  });

  it("reads the content size and unit", () => {
    const product = parseProductPage(page([CASSEROLE]), "N106");
    expect(product?.contentSize).toBe(0.3);
    expect(product?.contentUnit).toBe("kg");
  });

  // unitCode "ct" means counted, "kg" means weighed — which decides whether
  // quantity is "2 kpl" or "0,4 kg".
  it("distinguishes counted goods from weighed goods", () => {
    expect(parseProductPage(page([CASSEROLE]), "N106")?.soldBy).toBe("piece");
    expect(parseProductPage(page([CASSEROLE]), "N106")?.pricing.normal.unit).toBe("kpl");

    expect(parseProductPage(page([SALMON]), "N106")?.soldBy).toBe("mass");
    expect(parseProductPage(page([SALMON]), "N106")?.pricing.normal.unit).toBe("kg");
  });

  it("takes the aisle from the first breadcrumb", () => {
    const product = parseProductPage(page([SALMON, BREADCRUMB]), "N106");
    expect(product?.categoryName).toBe("Kala ja merenelävät");
    expect(product?.categoryPath).toBe("kala-ja-merenelavat");
  });

  // Aisle order is what shopping mode sorts by; fish comes before ready meals.
  it("assigns an aisle order from the category", () => {
    const fish = parseProductPage(page([SALMON, BREADCRUMB]), "N106");
    const unknown = parseProductPage(page([CASSEROLE]), "N106");

    expect(fish?.categoryOrder).toBeGreaterThan(0);
    expect(fish?.categoryOrder ?? 0).toBeLessThan(unknown?.categoryOrder ?? 0);
  });

  it("exposes a single shelf price as the best offer", () => {
    const { pricing } = parseProductPage(page([CASSEROLE]), "N106")!;

    expect(pricing.offers).toHaveLength(1);
    expect(pricing.best).toBe(pricing.normal);
    expect(pricing.best.effectiveUnitPrice).toBe(2.39);
    expect(pricing.best.amount).toBe(1);
  });

  describe("unusable pages", () => {
    it("returns null when there is no product node", () => {
      expect(parseProductPage(page([BREADCRUMB]), "N106")).toBeNull();
    });

    it("returns null when there is no structured data at all", () => {
      expect(parseProductPage("<html></html>", "N106")).toBeNull();
    });

    // A list that shows totals cannot use a product with no price.
    it("returns null when the product has no price", () => {
      const priceless = { ...CASSEROLE, offers: { "@type": "Offer" } };
      expect(parseProductPage(page([priceless]), "N106")).toBeNull();
    });

    it("returns null when the product has no identifier", () => {
      const { gtin13: _g, productID: _p, ...anonymous } = CASSEROLE;
      expect(parseProductPage(page([anonymous]), "N106")).toBeNull();
    });
  });
});

describe("fetchProductBySlug", () => {
  const ok = (body: string) =>
    (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it("fetches and parses a product", async () => {
    const product = await fetchProductBySlug("pirkka-kirjolohikiusaus-300g-6410402025602", {
      fetchImpl: ok(page([CASSEROLE, BREADCRUMB])),
      storeId: "N106",
    });

    expect(product?.ean).toBe("6410402025602");
  });

  // A delisted product is information, not an error to retry.
  it("returns null for a product that no longer exists", async () => {
    const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;

    await expect(fetchProductBySlug("poistunut-123", { fetchImpl: notFound })).resolves.toBeNull();
  });

  it("throws with the status when the page cannot be read", async () => {
    const blocked = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    await expect(fetchProductBySlug("x-123", { fetchImpl: blocked })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("throws when the network is unreachable", async () => {
    const down = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    await expect(fetchProductBySlug("x-123", { fetchImpl: down })).rejects.toMatchObject({
      status: null,
    });
  });
});
