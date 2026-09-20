import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";

/**
 * Catalogue behaviour, against a real Postgres.
 *
 * Search runs entirely against the local index — no network — which is the
 * point of the design, so these tests assert that the network is *not*
 * touched except when a price is genuinely missing or stale.
 */
let testDb: TestDb;
let close: () => Promise<void>;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { clearSearchCache, getPrices, searchCatalogue } = await import("@/lib/catalogue/cache");
const { KRuokaClient } = await import("@/lib/kruoka/client");
const fixture = (await import("../fixtures/kruoka-search.json")).default;
const { products, storePrices } = await import("@/lib/db/schema");
const { foldFinnish } = await import("@/lib/text");

const realFetch = globalThis.fetch;

/**
 * A client whose transport is a stub, so no test ever reaches the network.
 * `live: false` simulates upstream being unavailable, which is how the
 * local-index fallback gets exercised.
 */
function stubClient(options: { live?: boolean } = {}) {
  let calls = 0;
  const transport = async () => {
    calls += 1;
    if (options.live === false) throw new Error("upstream unavailable");
    return { status: 200, body: JSON.stringify(fixture) };
  };
  const client = new KRuokaClient({
    transport,
    minIntervalMs: 0,
    buildNumber: "00000",
    storeId: "N106",
  });
  return { client, calls: () => calls };
}

/** Upstream down, so behaviour falls through to the local index. */
const offline = () => stubClient({ live: false }).client;

/** A product page, as the site publishes it: schema.org JSON-LD. */
function productPage(ean: string, name: string, price: number, unitCode = "ct"): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name,
        gtin13: ean,
        offers: {
          "@type": "Offer",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price,
            priceCurrency: "EUR",
            referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode },
          },
          availability: "https://schema.org/InStock",
        },
      },
    ],
  })}</script></head><body></body></html>`;
}

/** Counts network calls so the tests can assert they do not happen. */
function stubNetwork(handler?: (url: string) => Response) {
  let calls = 0;
  globalThis.fetch = (async (input: unknown) => {
    calls += 1;
    const url = String(input);
    if (!handler) throw new Error("network unavailable");
    return handler(url);
  }) as unknown as typeof fetch;
  return () => calls;
}

async function seedProduct(
  ean: string,
  name: string,
  options: { slug?: string | null; priceCents?: number; ageDays?: number } = {},
) {
  await testDb.insert(products).values({
    ean,
    name,
    searchName: foldFinnish(name),
    slug:
      options.slug === undefined
        ? `${foldFinnish(name).replace(/\s+/g, "-")}-${ean}`
        : options.slug,
    categoryName: "Testiosasto",
    categoryOrder: 10,
  });

  if (options.priceCents !== undefined) {
    const fetchedAt = new Date(Date.now() - (options.ageDays ?? 0) * 86_400_000);
    await testDb.insert(storePrices).values({
      ean,
      storeId: "N106",
      normalCents: options.priceCents,
      unit: "kpl",
      bestUnitCents: options.priceCents,
      bestKind: "normal",
      bestAmount: 1,
      bestBundleCents: options.priceCents,
      fetchedAt,
    });
  }
}

beforeAll(async () => {
  const created = await createTestDb();
  testDb = created.db;
  close = created.close;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await close();
});

beforeEach(async () => {
  clearSearchCache();
  await testDb.execute("truncate store_prices, products restart identity cascade");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("searchCatalogue", () => {
  it("finds a product in the local index without any network call", async () => {
    await seedProduct("6410405082657", "Pirkka suomalainen kevytmaito 1l", { priceCents: 99 });
    const calls = stubNetwork();

    const items = await searchCatalogue("kevytmaito", { storeId: "N106", client: offline() });

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("Pirkka suomalainen kevytmaito 1l");
    expect(items[0]?.bestUnitCents).toBe(99);
    expect(calls()).toBe(0);
  });

  // Finnish keyboards have the umlauts, but people often type without them.
  it("matches a query typed without umlauts", async () => {
    await seedProduct("1", "Fazer Ruisleipä 500g", { priceCents: 199 });
    stubNetwork();

    expect(await searchCatalogue("leipa", { storeId: "N106", client: offline() })).toHaveLength(1);
    expect(await searchCatalogue("LEIPÄ", { storeId: "N106", client: offline() })).toHaveLength(1);
  });

  it("ignores a query shorter than two characters", async () => {
    await seedProduct("1", "Maito", { priceCents: 99 });
    const calls = stubNetwork();

    expect(await searchCatalogue("m", { storeId: "N106", client: offline() })).toEqual([]);
    expect(calls()).toBe(0);
  });

  it("ranks a prefix match above a mid-word match", async () => {
    await seedProduct("1", "Kevytmaito", { priceCents: 99 });
    await seedProduct("2", "Maito 1l", { priceCents: 95 });
    stubNetwork();

    const items = await searchCatalogue("maito", { storeId: "N106", client: offline() });

    expect(items[0]?.name).toBe("Maito 1l");
  });

  it("honours the result limit", async () => {
    for (let i = 0; i < 10; i++) {
      await seedProduct(String(i), `Maito ${i}`, { priceCents: 100 + i });
    }
    stubNetwork();

    expect(
      await searchCatalogue("maito", { storeId: "N106", limit: 3, client: offline() }),
    ).toHaveLength(3);
  });

  it("returns nothing when the index has no match", async () => {
    await seedProduct("1", "Maito", { priceCents: 99 });
    stubNetwork();

    expect(await searchCatalogue("banaani", { storeId: "N106", client: offline() })).toEqual([]);
  });

  it("fetches a price from the product page when none is cached", async () => {
    await seedProduct("6410405082657", "Pirkka kevytmaito 1l");
    const calls = stubNetwork(
      () =>
        new Response(productPage("6410405082657", "Pirkka kevytmaito 1l", 0.99), { status: 200 }),
    );

    const items = await searchCatalogue("kevytmaito", { storeId: "N106", client: offline() });

    expect(calls()).toBe(1);
    expect(items[0]?.bestUnitCents).toBe(99);

    // And it is written through, so the next search needs no network.
    const cached = await testDb.select().from(storePrices);
    expect(cached).toHaveLength(1);
  });

  // Someone standing in a shop is better served by yesterday's price.
  it("falls back to a stale cached price when the page cannot be fetched", async () => {
    await seedProduct("1", "Maito", { priceCents: 99, ageDays: 30 });
    stubNetwork();

    const items = await searchCatalogue("maito", { storeId: "N106", client: offline() });

    expect(items).toHaveLength(1);
    expect(items[0]?.bestUnitCents).toBe(99);
  });

  it("omits a product that has neither a cached price nor a reachable page", async () => {
    await seedProduct("1", "Maito");
    stubNetwork();

    expect(await searchCatalogue("maito", { storeId: "N106", client: offline() })).toEqual([]);
  });

  it("serves a repeated query from memory", async () => {
    await seedProduct("1", "Maito", { priceCents: 99 });
    stubNetwork();

    await searchCatalogue("maito", { storeId: "N106", client: offline() });
    await searchCatalogue("MAITO", { storeId: "N106", client: offline() });

    // Nothing to assert on the network here; the point is it does not throw
    // and returns the same answer for an equivalent query.
    expect(await searchCatalogue("maito", { storeId: "N106", client: offline() })).toHaveLength(1);
  });
});

describe("searchCatalogue, live", () => {
  it("prefers upstream, which is the only source of campaign prices", async () => {
    const { client } = stubClient();

    const items = await searchCatalogue("lohi", { storeId: "N106", client });

    const batched = items.find((i) => i.ean === "6410402025602");
    expect(batched?.bestKind).toBe("batch");
    expect(batched?.bestUnitCents).toBe(225);
    expect(batched?.discountType).toBe("PLUSSA");
  });

  it("writes live results through to the cache", async () => {
    const { client } = stubClient();

    await searchCatalogue("lohi", { storeId: "N106", client });

    expect((await testDb.select().from(storePrices)).length).toBeGreaterThan(0);
  });

  // Someone in a shop needs an answer, not an error page.
  it("falls back to the local index when upstream is unavailable", async () => {
    await seedProduct("1", "Maito", { priceCents: 99 });
    const { client } = stubClient({ live: false });

    const items = await searchCatalogue("maito", { storeId: "N106", client });

    expect(items).toHaveLength(1);
    expect(items[0]?.bestUnitCents).toBe(99);
  });

  it("does not call upstream for a query that is too short", async () => {
    const { client, calls } = stubClient();

    expect(await searchCatalogue("m", { storeId: "N106", client })).toEqual([]);
    expect(calls()).toBe(0);
  });
});

describe("getPrices", () => {
  it("returns nothing for an empty request", async () => {
    const calls = stubNetwork();
    expect((await getPrices([], "N106")).size).toBe(0);
    expect(calls()).toBe(0);
  });

  it("serves a fresh cached price without a network call", async () => {
    await seedProduct("1", "Maito", { priceCents: 99 });
    const calls = stubNetwork();

    const prices = await getPrices(["1"], "N106");

    expect(prices.get("1")?.normalCents).toBe(99);
    expect(prices.get("1")?.stale).toBe(false);
    expect(calls()).toBe(0);
  });

  it("refreshes a stale price from the product page", async () => {
    await seedProduct("6410405082657", "Maito", { priceCents: 99, ageDays: 30 });
    stubNetwork(() => new Response(productPage("6410405082657", "Maito", 1.29), { status: 200 }));

    const prices = await getPrices(["6410405082657"], "N106");

    expect(prices.get("6410405082657")?.normalCents).toBe(129);
    expect(prices.get("6410405082657")?.stale).toBe(false);
  });

  it("keeps serving a stale price when the page is unreachable", async () => {
    await seedProduct("1", "Maito", { priceCents: 99, ageDays: 30 });
    stubNetwork();

    const prices = await getPrices(["1"], "N106");

    expect(prices.get("1")?.normalCents).toBe(99);
    expect(prices.get("1")?.stale).toBe(true);
  });

  it("omits a product it knows nothing about", async () => {
    stubNetwork();
    expect((await getPrices(["9999999999999"], "N106")).has("9999999999999")).toBe(false);
  });
});
