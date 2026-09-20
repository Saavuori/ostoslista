import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/kruoka-search.json";
import { createTestDb, type TestDb } from "../helpers/db";

/**
 * Cache behaviour, against a real Postgres and a fake upstream.
 *
 * The upstream is a counting stub rather than a network call: the point of
 * these tests is exactly how many times we hit an API we do not own.
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
const { storePrices, products } = await import("@/lib/db/schema");

/** A client whose fetch is a stub, so nothing leaves the machine. */
function stubClient(options: { fail?: boolean } = {}) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (options.fail) throw new Error("upstream down");
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const client = new KRuokaClient({ fetchImpl, minIntervalMs: 0, storeId: "N106" });
  return { client, calls: () => calls };
}

beforeAll(async () => {
  const created = await createTestDb();
  testDb = created.db;
  close = created.close;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  clearSearchCache();
  await testDb.execute("truncate store_prices, products restart identity cascade");
});

describe("searchCatalogue", () => {
  it("returns normalised items from upstream", async () => {
    const { client } = stubClient();
    const items = await searchCatalogue("lohi", { storeId: "N106", client });

    expect(items).toHaveLength(5);
    const soup = items.find((i) => i.ean === "6412000031849");
    expect(soup?.name).toBe("Saarioinen kirjolohikeitto 300g");
    expect(soup?.normalCents).toBe(289);
    expect(soup?.imageUrl).toContain("public.keskofiles.com");
  });

  it("does not call upstream for a query shorter than two characters", async () => {
    const { client, calls } = stubClient();
    expect(await searchCatalogue("l", { storeId: "N106", client })).toEqual([]);
    expect(calls()).toBe(0);
  });

  // Autocomplete fires per keystroke; without memoisation, typing a word is
  // one upstream request per letter.
  it("serves a repeated query from memory instead of calling upstream again", async () => {
    const { client, calls } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });
    await searchCatalogue("lohi", { storeId: "N106", client });
    await searchCatalogue("LOHI", { storeId: "N106", client });

    expect(calls()).toBe(1);
  });

  it("treats a different store as a different query, because prices differ", async () => {
    const { client, calls } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });
    await searchCatalogue("lohi", { storeId: "N200", client });

    expect(calls()).toBe(2);
  });

  it("writes product identity and store prices through to the cache", async () => {
    const { client } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });

    const cachedProducts = await testDb.select().from(products);
    const cachedPrices = await testDb.select().from(storePrices);

    // Three of the five fixture products are national; two are store-local.
    expect(cachedProducts).toHaveLength(3);
    expect(cachedPrices).toHaveLength(5);
  });

  // Store-local items (the fish counter) reuse EAN ranges across shops, so
  // caching them as shared identity would mix up different products.
  it("does not cache store-local items as shared product identity", async () => {
    const { client } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });

    const cached = await testDb.select().from(products);
    expect(cached.map((p) => p.ean)).not.toContain("2000456700002");
  });

  it("resolves the batch offer to a per-unit price in the cache", async () => {
    const { client } = stubClient();
    const items = await searchCatalogue("lohi", { storeId: "N106", client });

    const batched = items.find((i) => i.ean === "6410402025602");
    expect(batched?.normalCents).toBe(239);
    expect(batched?.bestKind).toBe("batch");
    expect(batched?.bestUnitCents).toBe(225);
    expect(batched?.bestBundleCents).toBe(450);
    expect(batched?.bestAmount).toBe(2);
  });

  it("records a per-unit discount with its campaign details", async () => {
    const { client } = stubClient();
    const items = await searchCatalogue("lohi", { storeId: "N106", client });

    const discounted = items.find((i) => i.ean === "6405304002073");
    expect(discounted?.bestKind).toBe("discount");
    expect(discounted?.bestUnitCents).toBe(589);
    expect(discounted?.discountPercent).toBe(10);
    expect(discounted?.discountType).toBe("PLUSSA");
  });

  it("marks goods weighed at the till as approximate", async () => {
    const { client } = stubClient();
    const items = await searchCatalogue("lohi", { storeId: "N106", client });

    const wholeFish = items.find((i) => i.ean === "2000409600007");
    expect(wholeFish?.isApproximate).toBe(true);
    expect(wholeFish?.averageWeight).toBe(1.5);
  });

  it("upserts rather than duplicating on a second search", async () => {
    const { client } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });
    clearSearchCache();
    await searchCatalogue("lohi", { storeId: "N106", client });

    expect(await testDb.select().from(storePrices)).toHaveLength(5);
  });

  it("propagates an upstream failure rather than returning silent nonsense", async () => {
    const { client } = stubClient({ fail: true });
    await expect(searchCatalogue("lohi", { storeId: "N106", client })).rejects.toThrow();
  });
});

describe("getPrices", () => {
  it("returns nothing for an empty request without touching upstream", async () => {
    const { client, calls } = stubClient();
    expect((await getPrices([], "N106", client)).size).toBe(0);
    expect(calls()).toBe(0);
  });

  it("serves fresh cached prices without calling upstream", async () => {
    const { client, calls } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });
    const before = calls();

    const prices = await getPrices(["6412000031849"], "N106", client);

    expect(prices.get("6412000031849")?.normalCents).toBe(289);
    expect(prices.get("6412000031849")?.stale).toBe(false);
    expect(calls()).toBe(before);
  });

  it("refreshes a stale price", async () => {
    const { client, calls } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });

    // Age the row well past the TTL.
    await testDb.execute("update store_prices set fetched_at = now() - interval '30 days'");
    const before = calls();

    const prices = await getPrices(["6412000031849"], "N106", client);

    expect(calls()).toBeGreaterThan(before);
    expect(prices.get("6412000031849")?.stale).toBe(false);
  });

  // Someone standing in a shop is better served by yesterday's price than by
  // an error.
  it("keeps serving a stale price when upstream is unavailable", async () => {
    const { client } = stubClient();
    await searchCatalogue("lohi", { storeId: "N106", client });
    await testDb.execute("update store_prices set fetched_at = now() - interval '30 days'");

    const broken = stubClient({ fail: true });
    const prices = await getPrices(["6412000031849"], "N106", broken.client);

    expect(prices.get("6412000031849")?.normalCents).toBe(289);
    expect(prices.get("6412000031849")?.stale).toBe(true);
  });

  it("omits a product that is not cached and cannot be fetched", async () => {
    const broken = stubClient({ fail: true });
    const prices = await getPrices(["9999999999999"], "N106", broken.client);
    expect(prices.has("9999999999999")).toBe(false);
  });
});
