import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";

/**
 * Integration tests for the list service, against a real Postgres (PGlite).
 *
 * The service talks to the module-level `db`, so the module is swapped for a
 * test instance here rather than threading a connection through every call —
 * production code stays free of test plumbing.
 */
let testDb: TestDb;
let close: () => Promise<void>;

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { addItem, createList, deleteItem, getHistory, getList, syncItems, updateItem } =
  await import("@/lib/lists/service");
const { listItems } = await import("@/lib/db/schema");
const { uuidv7 } = await import("@/lib/ids");

const ALICE = uuidv7();
const BOB = uuidv7();

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
    "truncate list_items, list_members, share_tokens, lists restart identity cascade",
  );
});

async function seedList(name = "Viikon ostokset") {
  return createList({ name, nickname: "Alice" });
}

describe("createList", () => {
  it("creates a list with an editor share token", async () => {
    const { id, token, memberId } = await seedList();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(token).toHaveLength(22);
    expect(memberId).not.toBeNull();

    const list = await getList(token);
    expect(list.name).toBe("Viikon ostokset");
    expect(list.role).toBe("editor");
    expect(list.items).toEqual([]);
  });

  it("defaults to the configured store", async () => {
    const { token } = await seedList();
    expect((await getList(token)).storeId).toBe("N106");
  });

  it("accepts a client-generated id, so an offline device can create a list", async () => {
    const id = uuidv7();
    const created = await createList({ id, name: "Kaupassa" });
    expect(created.id).toBe(id);
  });
});

describe("authorization", () => {
  it("rejects a token that does not exist", async () => {
    await expect(getList("ZZZZZZZZZZZZZZZZZZZZZZ")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a malformed token without touching the database", async () => {
    await expect(getList("nope")).rejects.toMatchObject({ status: 404 });
    await expect(getList("'; drop table lists;--")).rejects.toMatchObject({ status: 404 });
  });

  // A revoked link must look identical to a wrong one, or the response
  // confirms that a list exists behind a token someone is guessing at.
  it("treats a revoked token as not found", async () => {
    const { token } = await seedList();
    const { shareTokens } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    await testDb
      .update(shareTokens)
      .set({ revokedAt: new Date() })
      .where(eq(shareTokens.token, token));

    await expect(getList(token)).rejects.toMatchObject({ status: 404 });
  });

  it("treats an expired token as not found", async () => {
    const { token } = await seedList();
    const { shareTokens } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    await testDb
      .update(shareTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shareTokens.token, token));

    await expect(getList(token)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses edits through a viewer link", async () => {
    const { id } = await seedList();
    const { shareTokens } = await import("@/lib/db/schema");
    const { generateShareToken } = await import("@/lib/ids");

    const viewerToken = generateShareToken();
    await testDb.insert(shareTokens).values({ token: viewerToken, listId: id, role: "viewer" });

    await expect(getList(viewerToken)).resolves.toMatchObject({ role: "viewer" });
    await expect(
      addItem(viewerToken, { freeText: "Maito", qty: 1, qtyUnit: "kpl" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("addItem", () => {
  it("adds a free-text item", async () => {
    const { token } = await seedList();
    const { item, merged } = await addItem(token, {
      freeText: "Jotain jälkiruoaksi",
      qty: 1,
      qtyUnit: "kpl",
      addedBy: ALICE,
    });

    expect(merged).toBe(false);
    expect(item.freeText).toBe("Jotain jälkiruoaksi");
    expect(item.ean).toBeNull();
    expect(item.qty).toBe(1);
  });

  it("adds a catalogue product with its price snapshot", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, {
      ean: "6410402025602",
      nameSnapshot: "Pirkka kirjolohikiusaus 300 g",
      priceCentsSnapshot: 239,
      qty: 2,
      qtyUnit: "kpl",
    });

    expect(item.ean).toBe("6410402025602");
    expect(item.priceCentsSnapshot).toBe(239);
  });

  /**
   * The row has to show what the search result showed, offline: the picture
   * identifies the product on a shelf and the offer says to grab two.
   */
  it("keeps the picture, comparison price and offer with the item", async () => {
    const { token } = await seedList();
    await addItem(token, {
      ean: "6410402025602",
      nameSnapshot: "Pirkka kirjolohikiusaus 300 g",
      priceCentsSnapshot: 225,
      imageUrl: "https://public.keskofiles.com/f/k-ruoka/product/6410402025602",
      comparisonCents: 750,
      comparisonUnit: "kg",
      discountPercent: 5,
      discountType: "PLUSSA",
      offerAmount: 2,
      offerBundleCents: 450,
      qty: 2,
      qtyUnit: "kpl",
    });

    const [item] = (await getList(token)).items;

    expect(item?.imageUrl).toContain("6410402025602");
    expect(item?.comparisonCents).toBe(750);
    expect(item?.comparisonUnit).toBe("kg");
    expect(item?.discountPercent).toBe(5);
    expect(item?.discountType).toBe("PLUSSA");
    expect(item?.offerAmount).toBe(2);
    expect(item?.offerBundleCents).toBe(450);
  });

  it("leaves the display fields null for a free-text item", async () => {
    const { token } = await seedList();
    await addItem(token, { freeText: "Jotain jälkiruoaksi", qty: 1, qtyUnit: "kpl" });

    const [item] = (await getList(token)).items;

    expect(item?.imageUrl).toBeNull();
    expect(item?.offerAmount).toBeNull();
  });

  it("keeps fractional quantities for goods sold by weight", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, {
      ean: "2000456700002",
      nameSnapshot: "Kirjolohifilee",
      qty: 0.4,
      qtyUnit: "kg",
    });

    expect(item.qty).toBe(0.4);
    expect(item.qtyUnit).toBe("kg");
  });

  // Two "Maito" rows is the bug people notice in the first minute.
  it("merges a repeated product into the existing line", async () => {
    const { token } = await seedList();
    await addItem(token, { ean: "6410402025602", qty: 1, qtyUnit: "kpl" });
    const second = await addItem(token, { ean: "6410402025602", qty: 2, qtyUnit: "kpl" });

    expect(second.merged).toBe(true);
    expect(second.item.qty).toBe(3);
    expect((await getList(token)).items).toHaveLength(1);
  });

  it("merges free text case-insensitively", async () => {
    const { token } = await seedList();
    await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    const second = await addItem(token, { freeText: "  maito ", qty: 1, qtyUnit: "kpl" });

    expect(second.merged).toBe(true);
    expect(second.item.qty).toBe(2);
  });

  it("does not merge a product into a free-text line with the same name", async () => {
    const { token } = await seedList();
    await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    const second = await addItem(token, {
      ean: "6410402025602",
      nameSnapshot: "Maito",
      qty: 1,
      qtyUnit: "kpl",
    });

    expect(second.merged).toBe(false);
    expect((await getList(token)).items).toHaveLength(2);
  });

  // Re-adding something you already crossed off means you want it again.
  it("unchecks a merged item", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { ean: "123456789", qty: 1, qtyUnit: "kpl" });
    await updateItem(token, item.id, { checked: true, updatedBy: ALICE });

    const again = await addItem(token, { ean: "123456789", qty: 1, qtyUnit: "kpl" });
    expect(again.item.checked).toBe(false);
    expect(again.item.checkedBy).toBeNull();
  });

  it("orders items by insertion", async () => {
    const { token } = await seedList();
    for (const name of ["Maito", "Leipä", "Juusto"]) {
      await addItem(token, { freeText: name, qty: 1, qtyUnit: "kpl" });
    }
    expect((await getList(token)).items.map((i) => i.freeText)).toEqual([
      "Maito",
      "Leipä",
      "Juusto",
    ]);
  });
});

describe("updateItem", () => {
  it("checks an item off and records who did it", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    const updated = await updateItem(token, item.id, { checked: true, updatedBy: BOB });
    expect(updated.checked).toBe(true);
    expect(updated.checkedBy).toBe(BOB);
    expect(updated.checkedAt).not.toBeNull();
  });

  it("clears attribution when unchecked", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    await updateItem(token, item.id, { checked: true, updatedBy: BOB });

    const updated = await updateItem(token, item.id, { checked: false, updatedBy: ALICE });
    expect(updated.checked).toBe(false);
    expect(updated.checkedBy).toBeNull();
    expect(updated.checkedAt).toBeNull();
  });

  // A device with a fast clock would otherwise win every future conflict.
  it("clamps a client timestamp from the future to now", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    const future = new Date(Date.now() + 60 * 60 * 1000);
    const updated = await updateItem(token, item.id, { qty: 5, updatedAt: future });

    expect(updated.qty).toBe(5);
    expect(updated.updatedAt.getTime()).toBeLessThan(future.getTime());
  });

  it("ignores a stale offline edit that lost the race", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    await updateItem(token, item.id, { qty: 9, updatedBy: ALICE });
    const stale = await updateItem(token, item.id, {
      qty: 2,
      updatedAt: new Date(Date.now() - 60_000),
      updatedBy: BOB,
    });

    expect(stale.qty).toBe(9);
  });

  /**
   * The regression that shipped broken: a check-off queued moments after the
   * item was added carried a client timestamp equal to the server's, lost the
   * tie-break, and was silently discarded. Offline edits vanished.
   */
  it("applies an edit made in the same instant as the row it targets", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    const updated = await updateItem(token, item.id, {
      checked: true,
      updatedAt: item.updatedAt,
      updatedBy: null,
    });

    expect(updated.checked).toBe(true);
  });

  it("applies an edit whose clock is slightly behind the server's", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    const updated = await updateItem(token, item.id, {
      checked: true,
      updatedAt: new Date(item.updatedAt.getTime() - 2000),
    });

    expect(updated.checked).toBe(true);
  });

  it("rejects an item belonging to another list", async () => {
    const a = await seedList("A");
    const b = await seedList("B");
    const { item } = await addItem(a.token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    await expect(updateItem(b.token, item.id, { qty: 2 })).rejects.toMatchObject({
      status: 404,
    });
  });

  // The id lands in a uuid column; a malformed one must be a 404, not a 500.
  it("treats a malformed item id as not found", async () => {
    const { token } = await seedList();
    await expect(updateItem(token, "not-a-uuid", { qty: 2 })).rejects.toMatchObject({
      status: 404,
    });
    await expect(deleteItem(token, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
  });
});

describe("deleteItem", () => {
  it("removes the item from the list view", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    await deleteItem(token, item.id, ALICE);
    expect((await getList(token)).items).toHaveLength(0);
  });

  // A hard delete that syncs after an offline edit resurrects the row.
  it("leaves a tombstone rather than removing the row", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    await deleteItem(token, item.id);

    const { eq } = await import("drizzle-orm");
    const rows = await testDb.select().from(listItems).where(eq(listItems.id, item.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).not.toBeNull();
  });

  it("is not repeatable", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    await deleteItem(token, item.id);

    await expect(deleteItem(token, item.id)).rejects.toMatchObject({ status: 404 });
  });

  it("lets the same product be added again afterwards", async () => {
    const { token } = await seedList();
    const first = await addItem(token, { ean: "123456789", qty: 1, qtyUnit: "kpl" });
    await deleteItem(token, first.item.id);

    const second = await addItem(token, { ean: "123456789", qty: 1, qtyUnit: "kpl" });
    expect(second.merged).toBe(false);
    expect((await getList(token)).items).toHaveLength(1);
  });
});

describe("getHistory", () => {
  it("is empty for a new list", async () => {
    const { token } = await seedList();
    expect(await getHistory(token)).toEqual([]);
  });

  it("offers something that was removed", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    await deleteItem(token, item.id);

    const history = await getHistory(token);

    expect(history).toHaveLength(1);
    expect(history[0]?.name).toBe("Maito");
  });

  // Offering to add something already on the list is noise.
  it("excludes what is currently on the list", async () => {
    const { token } = await seedList();
    await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    expect(await getHistory(token)).toEqual([]);
  });

  it("keeps a product's price and aisle so re-adding it is complete", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, {
      ean: "6410402025602",
      nameSnapshot: "Pirkka kirjolohikiusaus 300 g",
      priceCentsSnapshot: 239,
      aisleName: "Valmisruoka",
      aisleOrder: 156,
      qty: 1,
      qtyUnit: "kpl",
    });
    await deleteItem(token, item.id);

    const [entry] = await getHistory(token);

    expect(entry?.ean).toBe("6410402025602");
    expect(entry?.priceCentsSnapshot).toBe(239);
    expect(entry?.aisleName).toBe("Valmisruoka");
  });

  // Re-adding from history should restore the full row, not a bare name.
  it("keeps the picture and offer so a re-add is complete", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, {
      ean: "6410402025602",
      nameSnapshot: "Pirkka kirjolohikiusaus",
      priceCentsSnapshot: 225,
      imageUrl: "https://public.keskofiles.com/f/k-ruoka/product/6410402025602",
      comparisonCents: 750,
      comparisonUnit: "kg",
      offerAmount: 2,
      offerBundleCents: 450,
      qty: 1,
      qtyUnit: "kpl",
    });
    await deleteItem(token, item.id);

    const [entry] = await getHistory(token);

    expect(entry?.imageUrl).toContain("6410402025602");
    expect(entry?.comparisonCents).toBe(750);
    expect(entry?.offerAmount).toBe(2);
    expect(entry?.offerBundleCents).toBe(450);
  });

  it("ranks the things bought most often first", async () => {
    const { token } = await seedList();

    for (const name of ["Maito", "Maito", "Maito", "Kahvi"]) {
      const { item } = await addItem(token, { freeText: name, qty: 1, qtyUnit: "kpl" });
      await deleteItem(token, item.id);
    }

    const history = await getHistory(token);

    expect(history[0]?.name).toBe("Maito");
    expect(history[0]?.timesUsed).toBe(3);
  });

  it("does not leak history between lists", async () => {
    const a = await seedList("A");
    const b = await seedList("B");
    const { item } = await addItem(a.token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    await deleteItem(a.token, item.id);

    expect(await getHistory(b.token)).toEqual([]);
  });
});

describe("syncItems", () => {
  it("applies a batch of offline edits and returns the reconciled list", async () => {
    const { token } = await seedList();
    const a = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    const b = await addItem(token, { freeText: "Leipä", qty: 1, qtyUnit: "kpl" });

    const items = await syncItems(token, {
      memberId: ALICE,
      items: [
        { id: a.item.id, checked: true, updatedAt: new Date(), updatedBy: ALICE },
        { id: b.item.id, qty: 3, updatedAt: new Date(), updatedBy: ALICE },
      ],
    });

    expect(items.find((i) => i.id === a.item.id)?.checked).toBe(true);
    expect(items.find((i) => i.id === b.item.id)?.qty).toBe(3);
  });

  it("honours a tombstone sent from an offline device", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    const items = await syncItems(token, {
      items: [{ id: item.id, deletedAt: new Date(), updatedAt: new Date(), updatedBy: ALICE }],
    });

    expect(items).toHaveLength(0);
  });

  describe("rows created offline", () => {
    it("inserts a row the device made while disconnected", async () => {
      const { token } = await seedList();
      const id = uuidv7();

      const items = await syncItems(token, {
        memberId: ALICE,
        items: [
          {
            id,
            freeText: "Maito",
            qty: 2,
            qtyUnit: "kpl",
            updatedAt: new Date(),
            updatedBy: ALICE,
          },
        ],
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe(id);
      expect(items[0]?.freeText).toBe("Maito");
      expect(items[0]?.qty).toBe(2);
    });

    it("records who checked off a row that was created and ticked offline", async () => {
      const { token } = await seedList();
      const at = new Date(Date.now() - 60_000);

      const [item] = await syncItems(token, {
        memberId: ALICE,
        items: [
          { id: uuidv7(), freeText: "Maito", checked: true, updatedAt: at, updatedBy: ALICE },
        ],
      });

      expect(item?.checked).toBe(true);
      expect(item?.checkedBy).toBe(ALICE);
      expect(item?.checkedAt?.getTime()).toBe(at.getTime());
    });

    it("inserts a catalogue product with its snapshots intact", async () => {
      const { token } = await seedList();
      const id = uuidv7();

      const items = await syncItems(token, {
        items: [
          {
            id,
            ean: "6410402025602",
            nameSnapshot: "Pirkka kirjolohikiusaus 300 g",
            priceCentsSnapshot: 239,
            qty: 1,
            updatedAt: new Date(),
          },
        ],
      });

      expect(items[0]?.ean).toBe("6410402025602");
      expect(items[0]?.priceCentsSnapshot).toBe(239);
    });

    // Two devices can flush the same queued row; the second must not blow up
    // the whole batch.
    it("is idempotent when the same creation arrives twice", async () => {
      const { token } = await seedList();
      const id = uuidv7();
      const batch = {
        items: [{ id, freeText: "Maito", qty: 1, updatedAt: new Date() }],
      };

      await syncItems(token, batch);
      const second = await syncItems(token, batch);

      expect(second).toHaveLength(1);
    });

    /**
     * A row deleted while its offline creation was still in flight: the
     * creation lands, then the tombstone that replaced it in the outbox
     * follows in the next flush and must remove it.
     */
    it("removes a row created in an earlier flush when its tombstone follows", async () => {
      const { token } = await seedList();
      const id = uuidv7();
      const createdAt = new Date(Date.now() - 1000);

      await syncItems(token, {
        items: [{ id, freeText: "Maito", qty: 1, updatedAt: createdAt }],
      });
      const items = await syncItems(token, {
        items: [{ id, deletedAt: new Date(), updatedAt: new Date(), updatedBy: ALICE }],
      });

      expect(items).toHaveLength(0);
    });

    it("ignores a tombstone for a row the server never received", async () => {
      const { token } = await seedList();

      const items = await syncItems(token, {
        items: [{ id: uuidv7(), deletedAt: new Date(), updatedAt: new Date() }],
      });

      expect(items).toHaveLength(0);
    });

    // Otherwise a queued edit that arrives after a delete resurrects the row.
    it("does not insert a row from a creation that was also deleted", async () => {
      const { token } = await seedList();

      const items = await syncItems(token, {
        items: [
          {
            id: uuidv7(),
            freeText: "Maito",
            deletedAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      expect(items).toHaveLength(0);
    });

    it("creates offline rows and edits existing ones in one batch", async () => {
      const { token } = await seedList();
      const existing = await addItem(token, { freeText: "Leipä", qty: 1, qtyUnit: "kpl" });
      const created = uuidv7();

      const items = await syncItems(token, {
        items: [
          { id: existing.item.id, checked: true, updatedAt: new Date(), updatedBy: ALICE },
          { id: created, freeText: "Maito", qty: 3, updatedAt: new Date(), updatedBy: ALICE },
        ],
      });

      expect(items).toHaveLength(2);
      expect(items.find((i) => i.id === existing.item.id)?.checked).toBe(true);
      expect(items.find((i) => i.id === created)?.qty).toBe(3);
    });
  });

  it("drops edits for rows this list never had", async () => {
    const { token } = await seedList();
    const items = await syncItems(token, {
      items: [{ id: uuidv7(), qty: 5, updatedAt: new Date(), updatedBy: ALICE }],
    });
    expect(items).toHaveLength(0);
  });

  it("is idempotent when the same batch is delivered twice", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    const batch = {
      items: [{ id: item.id, qty: 4, updatedAt: new Date(), updatedBy: ALICE }],
    };
    await syncItems(token, batch);
    const second = await syncItems(token, batch);

    expect(second).toHaveLength(1);
    expect(second[0]?.qty).toBe(4);
  });

  it("applies a check-off queued in the same instant the row was created", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });

    const items = await syncItems(token, {
      items: [{ id: item.id, checked: true, updatedAt: item.updatedAt }],
    });

    expect(items[0]?.checked).toBe(true);
  });

  it("keeps a newer server value over a stale offline edit", async () => {
    const { token } = await seedList();
    const { item } = await addItem(token, { freeText: "Maito", qty: 1, qtyUnit: "kpl" });
    await updateItem(token, item.id, { qty: 10, updatedBy: BOB });

    const items = await syncItems(token, {
      items: [
        {
          id: item.id,
          qty: 2,
          updatedAt: new Date(Date.now() - 60_000),
          updatedBy: ALICE,
        },
      ],
    });

    expect(items[0]?.qty).toBe(10);
  });
});
