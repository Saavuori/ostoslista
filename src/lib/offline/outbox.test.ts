import { describe, expect, it } from "vitest";
import type { OutboxEntry, StoredItem } from "./db";
import { applyLocally, collapse, retryDelayMs, shouldGiveUp, toSyncPayload } from "./outbox";

const MEMBER = "11111111-1111-7111-8111-111111111111";
const ITEM = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    seq: 1,
    token: "TOKEN",
    itemId: ITEM,
    op: "update",
    patch: {},
    queuedAt: new Date("2026-09-20T10:00:00Z"),
    attempts: 0,
    ...overrides,
  };
}

function item(overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    id: ITEM,
    token: "TOKEN",
    ean: null,
    freeText: "Maito",
    nameSnapshot: null,
    priceCentsSnapshot: null,
    aisleName: null,
    aisleOrder: null,
    imageUrl: null,
    comparisonCents: null,
    comparisonUnit: null,
    discountPercent: null,
    discountType: null,
    offerAmount: null,
    offerBundleCents: null,
    shelfModule: null,
    shelfLevel: null,
    qty: 1,
    qtyUnit: "kpl",
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    sortKey: 1,
    addedBy: null,
    updatedAt: new Date("2026-09-20T10:00:00Z"),
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("collapse", () => {
  it("queues a change when nothing is pending", () => {
    const incoming = entry({ patch: { checked: true } });
    expect(collapse(undefined, incoming)).toEqual([incoming]);
  });

  // Ticking an item five times offline must send one change, not five.
  it("folds repeated edits into a single entry", () => {
    const first = entry({ patch: { checked: true } });
    const second = entry({ patch: { checked: false } });
    const third = entry({ patch: { checked: true } });

    const afterTwo = collapse(first, second);
    const afterThree = collapse(afterTwo[0], third);

    expect(afterThree).toHaveLength(1);
    expect(afterThree[0]?.patch.checked).toBe(true);
  });

  it("merges different fields rather than dropping them", () => {
    const qtyChange = entry({ patch: { qty: 3 } });
    const checkChange = entry({ patch: { checked: true } });

    const merged = collapse(qtyChange, checkChange);

    expect(merged[0]?.patch).toEqual({ qty: 3, checked: true });
  });

  it("keeps the original queue position when folding", () => {
    const first = entry({ seq: 7, patch: { qty: 2 } });
    const second = entry({ seq: 9, patch: { qty: 5 } });

    expect(collapse(first, second)[0]?.seq).toBe(7);
  });

  describe("deletion", () => {
    it("supersedes a pending edit", () => {
      const edit = entry({ patch: { qty: 9 } });
      const remove = entry({ op: "delete" });

      const result = collapse(edit, remove);

      expect(result).toHaveLength(1);
      expect(result[0]?.op).toBe("delete");
    });

    /**
     * The creation may already be in flight. Cancelling both would let it
     * land on the server with nothing left to remove it, and the next sync
     * would bring the deleted row back.
     */
    it("replaces a pending creation with a tombstone", () => {
      const create = entry({ op: "create", patch: { freeText: "Maito" } });
      const remove = entry({ op: "delete" });

      const result = collapse(create, remove);

      expect(result).toHaveLength(1);
      expect(result[0]?.op).toBe("delete");
      expect(toSyncPayload(result, MEMBER).items[0]?.deletedAt).toBeTruthy();
    });
  });

  describe("creation", () => {
    it("absorbs later edits so the row is sent once, complete", () => {
      const create = entry({ op: "create", patch: { freeText: "Maito", qty: 1 } });
      const edit = entry({ patch: { qty: 4, checked: true } });

      const result = collapse(create, edit);

      expect(result).toHaveLength(1);
      expect(result[0]?.op).toBe("create");
      expect(result[0]?.patch).toEqual({ freeText: "Maito", qty: 4, checked: true });
    });

    it("resets the failure count when a row changes again", () => {
      const create = entry({ op: "create", attempts: 5, patch: { freeText: "Maito" } });
      const edit = entry({ patch: { qty: 2 } });

      expect(collapse(create, edit)[0]?.attempts).toBe(0);
    });
  });
});

describe("toSyncPayload", () => {
  it("sends a creation with its content so the server can insert it", () => {
    const payload = toSyncPayload(
      [
        entry({
          op: "create",
          patch: { ean: "6410402025602", nameSnapshot: "Pirkka", priceCentsSnapshot: 239, qty: 2 },
        }),
      ],
      MEMBER,
    );

    expect(payload.items[0]).toMatchObject({
      id: ITEM,
      ean: "6410402025602",
      nameSnapshot: "Pirkka",
      priceCentsSnapshot: 239,
      qty: 2,
      updatedBy: MEMBER,
    });
  });

  it("sends an edit with only the changed fields", () => {
    const payload = toSyncPayload([entry({ patch: { checked: true } })], MEMBER);

    expect(payload.items[0]).toMatchObject({ id: ITEM, checked: true });
    expect(payload.items[0]).not.toHaveProperty("ean");
    expect(payload.items[0]?.qty).toBeUndefined();
  });

  // A tombstone, not an absence: the server must distinguish "removed" from
  // "not mentioned".
  it("sends a deletion as a tombstone", () => {
    const payload = toSyncPayload([entry({ op: "delete" })], MEMBER);

    expect(payload.items[0]?.deletedAt).toBe("2026-09-20T10:00:00.000Z");
  });

  it("stamps every change with when it was made, not when it was sent", () => {
    const queuedAt = new Date("2026-09-20T08:30:00Z");
    const payload = toSyncPayload([entry({ queuedAt, patch: { qty: 2 } })], MEMBER);

    expect(payload.items[0]?.updatedAt).toBe(queuedAt.toISOString());
  });

  it("handles an empty queue", () => {
    expect(toSyncPayload([], MEMBER)).toEqual({ memberId: MEMBER, items: [] });
  });

  it("preserves a false value rather than treating it as absent", () => {
    const payload = toSyncPayload([entry({ patch: { checked: false } })], MEMBER);
    expect(payload.items[0]?.checked).toBe(false);
  });
});

describe("applyLocally", () => {
  it("applies an edit to the local row", () => {
    const updated = applyLocally(item(), "update", { qty: 5, checked: true });

    expect(updated.qty).toBe(5);
    expect(updated.checked).toBe(true);
  });

  it("tombstones rather than discarding on delete", () => {
    const updated = applyLocally(item(), "delete", {});
    expect(updated.deletedAt).not.toBeNull();
  });

  it("leaves untouched fields alone", () => {
    const updated = applyLocally(item({ freeText: "Maito" }), "update", { qty: 2 });
    expect(updated.freeText).toBe("Maito");
  });
});

describe("retry policy", () => {
  it("backs off exponentially", () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(3)).toBe(8000);
  });

  it("caps the delay so it never becomes effectively never", () => {
    expect(retryDelayMs(20)).toBe(60_000);
  });

  // Retrying forever hides the failure; the UI should be able to report it.
  it("gives up eventually", () => {
    expect(shouldGiveUp(entry({ attempts: 3 }))).toBe(false);
    expect(shouldGiveUp(entry({ attempts: 8 }))).toBe(true);
  });
});
