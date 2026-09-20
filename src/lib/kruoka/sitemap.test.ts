import { describe, expect, it } from "vitest";
import { crawlProductIndex, extractLocations, parseProductUrl } from "./sitemap";

describe("extractLocations", () => {
  it("pulls every loc out of a sitemap", () => {
    const xml = `<?xml version="1.0"?>
      <urlset><url><loc>https://a.test/1</loc></url><url><loc>https://a.test/2</loc></url></urlset>`;

    expect(extractLocations(xml)).toEqual(["https://a.test/1", "https://a.test/2"]);
  });

  it("returns nothing for an empty or malformed document", () => {
    expect(extractLocations("")).toEqual([]);
    expect(extractLocations("<urlset></urlset>")).toEqual([]);
  });

  it("trims surrounding whitespace", () => {
    expect(extractLocations("<loc>  https://a.test/1  </loc>")).toEqual(["https://a.test/1"]);
  });
});

describe("parseProductUrl", () => {
  // The slug carries both the name and the EAN, which is what makes a local
  // search index possible without touching the disallowed search URLs.
  it("recovers the ean and a readable name", () => {
    const entry = parseProductUrl(
      "https://www.k-ruoka.fi/kauppa/tuote/pirkka-kirjolohikiusaus-300g-6410402025602",
    );

    expect(entry).toEqual({
      ean: "6410402025602",
      slug: "pirkka-kirjolohikiusaus-300g-6410402025602",
      name: "pirkka kirjolohikiusaus 300g",
    });
  });

  // Store-local products vary in price per shop and we only have one store's
  // page, so the store suffix is dropped rather than treated as part of the id.
  it("strips a store suffix from a store-local product", () => {
    const entry = parseProductUrl(
      "https://www.k-ruoka.fi/kauppa/tuote/kirjolohifilee-c-leikkuu-kg-2000456700002-n106",
    );

    expect(entry?.ean).toBe("2000456700002");
    expect(entry?.name).toBe("kirjolohifilee c leikkuu kg");
  });

  it("handles long numeric eans with leading zeros", () => {
    const entry = parseProductUrl(
      "https://www.k-ruoka.fi/kauppa/tuote/maybelline-colossal-wp-mascara-01-0000030079236",
    );

    expect(entry?.ean).toBe("0000030079236");
    expect(entry?.name).toBe("maybelline colossal wp mascara 01");
  });

  it("returns null for a url that is not a product", () => {
    expect(parseProductUrl("https://www.k-ruoka.fi/reseptit/lohikeitto")).toBeNull();
    expect(parseProductUrl("https://www.k-ruoka.fi/kauppa/tuotehaku/valmisruoka")).toBeNull();
  });

  it("returns null when there is no ean to key on", () => {
    expect(parseProductUrl("https://www.k-ruoka.fi/kauppa/tuote/jotain-ilman-numeroa")).toBeNull();
  });

  it("returns null when the slug is only an ean, with no name", () => {
    expect(parseProductUrl("https://www.k-ruoka.fi/kauppa/tuote/6410402025602")).toBeNull();
  });
});

describe("crawlProductIndex", () => {
  /** Serves a sitemap index and one product sitemap, counting requests. */
  function stubFetch(pages: Record<string, string>) {
    const requested: string[] = [];
    const impl = (async (url: string) => {
      requested.push(String(url));
      const body = pages[String(url)];
      if (body === undefined) return new Response("", { status: 404 });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    return { impl, requested };
  }

  const INDEX = "https://www.k-ruoka.fi/sitemap-https.xml";

  it("follows the index to the product sitemaps and ignores the rest", async () => {
    const { impl, requested } = stubFetch({
      [INDEX]: `<sitemapindex>
        <sitemap><loc>https://www.k-ruoka.fi/sitemap-https-recipes-1.xml</loc></sitemap>
        <sitemap><loc>https://www.k-ruoka.fi/sitemap-https-products-1.xml</loc></sitemap>
      </sitemapindex>`,
      "https://www.k-ruoka.fi/sitemap-https-products-1.xml":
        "<urlset><url><loc>https://www.k-ruoka.fi/kauppa/tuote/maito-1l-1234567890123</loc></url></urlset>",
    });

    const entries = await crawlProductIndex({ fetchImpl: impl });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.ean).toBe("1234567890123");
    // Recipes are not products; fetching them would be pure waste.
    expect(requested).not.toContain("https://www.k-ruoka.fi/sitemap-https-recipes-1.xml");
  });

  it("de-duplicates a product that appears under several slugs", async () => {
    const { impl } = stubFetch({
      [INDEX]:
        "<sitemapindex><sitemap><loc>https://www.k-ruoka.fi/sitemap-https-products-1.xml</loc></sitemap></sitemapindex>",
      "https://www.k-ruoka.fi/sitemap-https-products-1.xml": `<urlset>
        <url><loc>https://www.k-ruoka.fi/kauppa/tuote/maito-1l-1234567890123</loc></url>
        <url><loc>https://www.k-ruoka.fi/kauppa/tuote/maito-taysmaito-1234567890123</loc></url>
      </urlset>`,
    });

    expect(await crawlProductIndex({ fetchImpl: impl })).toHaveLength(1);
  });

  it("honours a limit so a partial index can be built quickly", async () => {
    const urls = Array.from(
      { length: 50 },
      (_, i) =>
        `<url><loc>https://www.k-ruoka.fi/kauppa/tuote/tuote-${i}-100000000000${i % 10}</loc></url>`,
    ).join("");

    const { impl } = stubFetch({
      [INDEX]:
        "<sitemapindex><sitemap><loc>https://www.k-ruoka.fi/sitemap-https-products-1.xml</loc></sitemap></sitemapindex>",
      "https://www.k-ruoka.fi/sitemap-https-products-1.xml": `<urlset>${urls}</urlset>`,
    });

    expect((await crawlProductIndex({ fetchImpl: impl, limit: 3 })).length).toBeLessThanOrEqual(3);
  });

  it("reports progress per sitemap file", async () => {
    const { impl } = stubFetch({
      [INDEX]:
        "<sitemapindex><sitemap><loc>https://www.k-ruoka.fi/sitemap-https-products-1.xml</loc></sitemap></sitemapindex>",
      "https://www.k-ruoka.fi/sitemap-https-products-1.xml":
        "<urlset><url><loc>https://www.k-ruoka.fi/kauppa/tuote/maito-1l-1234567890123</loc></url></urlset>",
    });

    const seen: Array<[number, number, number]> = [];
    await crawlProductIndex({
      fetchImpl: impl,
      onProgress: (done, total, count) => seen.push([done, total, count]),
    });

    expect(seen).toEqual([[1, 1, 1]]);
  });

  it("fails loudly when the sitemap index cannot be read", async () => {
    const { impl } = stubFetch({});
    await expect(crawlProductIndex({ fetchImpl: impl })).rejects.toThrow(/404/);
  });
});
