import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreLocation } from "@/lib/kruoka/location";
import { createTestDb, type TestDb } from "../helpers/db";

/**
 * Store-location lookups, against a real Postgres (PGlite) and a fake
 * K-Ruoka client. Nothing here reaches the network.
 */
let testDb: TestDb;
let close: () => Promise<void>;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { createList } = await import("@/lib/lists/service");
const { locateListItems, resetLocateState } = await import("@/lib/lists/locate");
const { listItems, lists, storeLocations } = await import("@/lib/db/schema");
const { subscribe, resetBus } = await import("@/lib/realtime/bus");
const { KRuokaClient } = await import("@/lib/kruoka/client");
const { uuidv7 } = await import("@/lib/ids");
const { eq } = await import("drizzle-orm");

const CHEESE: StoreLocation = {
  departmentName: "Juusto",
  departmentOrder: 97,
  module: "06",
  level: "5",
};

/** A client whose store lookups come from a table and are counted. */
function fakeClient(table: Record<string, StoreLocation | null | "fail">) {
  const calls: string[] = [];
  const client = new KRuokaClient({ buildNumber: "0", minIntervalMs: 0 });
  client.getStoreLocation = async (ean: string) => {
    calls.push(ean);
    const answer = table[ean];
    if (answer === "fail") throw new Error("upstream returned 403");
    return answer ?? null;
  };
  return { client, calls };
}

async function seedItem(listId: string, ean: string | null, extra = {}) {
  const id = uuidv7();
  await testDb.insert(listItems).values({
    id,
    listId,
    ean,
    freeText: ean ? null : "Kukkia",
    nameSnapshot: ean ? `Tuote ${ean}` : null,
    aisleName: ean ? "Maito, juusto, munat ja rasvat" : null,
    aisleOrder: ean ? 60 : null,
    ...extra,
  });
  return id;
}

async function readItem(id: string) {
  const [row] = await testDb.select().from(listItems).where(eq(listItems.id, id));
  return row!;
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
  await testDb.execute(
    "truncate list_items, list_members, share_tokens, lists, store_locations restart identity cascade",
  );
  resetLocateState();
  resetBus();
});

describe("locateListItems", () => {
  it("replaces the web category with the store department and shelf", async () => {
    const { id: listId } = await createList({ name: "Testi" });
    const itemId = await seedItem(listId, "6410405132376");
    const { client } = fakeClient({ "6410405132376": CHEESE });

    expect(await locateListItems(listId, { client })).toBe(1);

    const row = await readItem(itemId);
    expect(row.aisleName).toBe("Juusto");
    expect(row.aisleOrder).toBe(-97);
    expect(row.shelfModule).toBe("06");
    expect(row.shelfLevel).toBe("5");
    expect(row.locatedAt).not.toBeNull();
  });

  // The device that added the item must hear about it too, so no origin.
  it("publishes the change to everyone on the list", async () => {
    const { id: listId } = await createList({ name: "Testi" });
    await seedItem(listId, "6410405132376");
    const { client } = fakeClient({ "6410405132376": CHEESE });

    const events: Array<{ origin: string | null; type: string; aisle?: string | null }> = [];
    const unsubscribe = subscribe(listId, (envelope) =>
      events.push({
        origin: envelope.origin,
        type: envelope.event.type,
        aisle: "item" in envelope.event ? envelope.event.item.aisleName : undefined,
      }),
    );
    await locateListItems(listId, { client });
    unsubscribe();

    expect(events).toEqual([{ origin: null, type: "item.updated", aisle: "Juusto" }]);
  });

  it("does not bump updatedAt, so it never wins against a real edit", async () => {
    const { id: listId } = await createList({ name: "Testi" });
    const itemId = await seedItem(listId, "6410405132376");
    const before = (await readItem(itemId)).updatedAt;

    await locateListItems(listId, { client: fakeClient({ "6410405132376": CHEESE }).client });

    expect((await readItem(itemId)).updatedAt).toEqual(before);
  });

  it("caches per store, so a second list does not ask again", async () => {
    const first = await createList({ name: "Yksi" });
    const second = await createList({ name: "Kaksi" });
    await seedItem(first.id, "6410405132376");
    await seedItem(second.id, "6410405132376");
    const { client, calls } = fakeClient({ "6410405132376": CHEESE });

    await locateListItems(first.id, { client });
    await locateListItems(second.id, { client });

    expect(calls).toHaveLength(1);
    const cached = await testDb.select().from(storeLocations);
    expect(cached).toHaveLength(1);
  });

  it("keeps the web category when the store has no location, and stops asking", async () => {
    const { id: listId } = await createList({ name: "Testi" });
    const itemId = await seedItem(listId, "2000456700002");
    const { client, calls } = fakeClient({ "2000456700002": null });

    expect(await locateListItems(listId, { client })).toBe(0);
    await locateListItems(listId, { client });

    const row = await readItem(itemId);
    expect(row.aisleName).toBe("Maito, juusto, munat ja rasvat");
    expect(row.locatedAt).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("leaves an item to be retried when K-Ruoka fails, without caching the failure", async () => {
    const { id: listId } = await createList({ name: "Testi" });
    const itemId = await seedItem(listId, "6410405132376");

    await locateListItems(listId, { client: fakeClient({ "6410405132376": "fail" }).client });
    expect((await readItem(itemId)).locatedAt).toBeNull();
    expect(await testDb.select().from(storeLocations)).toHaveLength(0);

    resetLocateState(); // skip the retry back-off
    await locateListItems(listId, { client: fakeClient({ "6410405132376": CHEESE }).client });
    expect((await readItem(itemId)).aisleName).toBe("Juusto");
  });

  it("uses the list's own store", async () => {
    const { id: listId } = await createList({ name: "Testi" });
    await testDb.update(lists).set({ storeId: "K264" }).where(eq(lists.id, listId));
    await seedItem(listId, "6410405132376");

    const seen: string[] = [];
    const client = new KRuokaClient({ buildNumber: "0", minIntervalMs: 0 });
    client.getStoreLocation = async (_ean, options) => {
      seen.push(options?.storeId ?? "?");
      return CHEESE;
    };
    await locateListItems(listId, { client });

    expect(seen).toEqual(["K264"]);
  });

  it("skips free-text and already located items", async () => {
    const { id: listId } = await createList({ name: "Testi" });
    await seedItem(listId, null);
    await seedItem(listId, "6410405132376", { locatedAt: new Date() });
    const { client, calls } = fakeClient({});

    expect(await locateListItems(listId, { client })).toBe(0);
    expect(calls).toEqual([]);
  });
});
