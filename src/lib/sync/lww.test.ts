import { describe, expect, it } from "vitest";
import { type MergeableItem, mergeItem, sortKeyBetween } from "./lww";

const ALICE = "11111111-1111-7111-8111-111111111111";
const BOB = "22222222-2222-7222-8222-222222222222";

function item(overrides: Partial<MergeableItem> = {}): MergeableItem {
  return {
    id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    qty: 1,
    qtyUnit: "kpl",
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    sortKey: 1,
    deletedAt: null,
    updatedAt: new Date("2026-09-20T10:00:00Z"),
    updatedBy: ALICE,
    ...overrides,
  };
}

describe("mergeItem", () => {
  it("refuses to merge different items", () => {
    expect(() => mergeItem(item({ id: "a" }), item({ id: "b" }))).toThrow(/different items/);
  });

  it("takes the later write", () => {
    const older = item({ qty: 1, updatedAt: new Date("2026-09-20T10:00:00Z") });
    const newer = item({ qty: 3, updatedAt: new Date("2026-09-20T10:05:00Z"), updatedBy: BOB });

    expect(mergeItem(older, newer).value.qty).toBe(3);
    expect(mergeItem(newer, older).value.qty).toBe(3);
  });

  it("reports which side won", () => {
    const older = item({ updatedAt: new Date("2026-09-20T10:00:00Z") });
    const newer = item({ updatedAt: new Date("2026-09-20T10:05:00Z"), updatedBy: BOB });

    expect(mergeItem(older, newer).outcome).toBe("remote");
    expect(mergeItem(newer, older).outcome).toBe("local");
  });

  // Without a deterministic tiebreak two devices can each conclude they won and
  // flip the value back and forth indefinitely.
  it("breaks timestamp ties the same way regardless of argument order", () => {
    const sameTime = new Date("2026-09-20T10:00:00Z");
    const fromAlice = item({ qty: 2, updatedAt: sameTime, updatedBy: ALICE });
    const fromBob = item({ qty: 9, updatedAt: sameTime, updatedBy: BOB });

    const a = mergeItem(fromAlice, fromBob).value.qty;
    const b = mergeItem(fromBob, fromAlice).value.qty;
    expect(a).toBe(b);
  });

  describe("deletion", () => {
    it("lets a tombstone win over a later edit", () => {
      const deleted = item({
        deletedAt: new Date("2026-09-20T10:00:00Z"),
        updatedAt: new Date("2026-09-20T10:00:00Z"),
      });
      const edited = item({ qty: 5, updatedAt: new Date("2026-09-20T11:00:00Z"), updatedBy: BOB });

      expect(mergeItem(edited, deleted).value.deletedAt).not.toBeNull();
      expect(mergeItem(deleted, edited).value.deletedAt).not.toBeNull();
    });

    it("stays deleted when both sides deleted it", () => {
      const a = item({ deletedAt: new Date("2026-09-20T10:00:00Z") });
      const b = item({ deletedAt: new Date("2026-09-20T10:01:00Z"), updatedBy: BOB });
      expect(mergeItem(a, b).outcome).toBe("merged");
      expect(mergeItem(a, b).value.deletedAt).not.toBeNull();
    });
  });

  describe("checking off", () => {
    it("lets a later uncheck undo an earlier check", () => {
      const checked = item({
        checked: true,
        checkedBy: ALICE,
        checkedAt: new Date("2026-09-20T10:00:00Z"),
        updatedAt: new Date("2026-09-20T10:00:00Z"),
      });
      const unchecked = item({
        checked: false,
        updatedAt: new Date("2026-09-20T10:05:00Z"),
        updatedBy: BOB,
      });

      const merged = mergeItem(checked, unchecked).value;
      expect(merged.checked).toBe(false);
      expect(merged.checkedBy).toBeNull();
      expect(merged.checkedAt).toBeNull();
    });

    // Two people ticking the same item in the aisle is the most common race.
    it("credits whoever checked it first when both did", () => {
      const alice = item({
        checked: true,
        checkedBy: ALICE,
        checkedAt: new Date("2026-09-20T10:00:00Z"),
        updatedAt: new Date("2026-09-20T10:00:00Z"),
      });
      const bob = item({
        checked: true,
        checkedBy: BOB,
        checkedAt: new Date("2026-09-20T10:00:30Z"),
        updatedAt: new Date("2026-09-20T10:00:30Z"),
      });

      expect(mergeItem(alice, bob).value.checkedBy).toBe(ALICE);
      expect(mergeItem(bob, alice).value.checkedBy).toBe(ALICE);
    });

    it("is idempotent", () => {
      const checked = item({
        checked: true,
        checkedBy: ALICE,
        checkedAt: new Date("2026-09-20T10:00:00Z"),
      });
      expect(mergeItem(checked, checked).value).toEqual(checked);
    });
  });
});

describe("sortKeyBetween", () => {
  it("starts at 1 for an empty list", () => {
    expect(sortKeyBetween(null, null)).toBe(1);
  });

  it("places an item before the first and after the last", () => {
    expect(sortKeyBetween(null, 5)).toBe(4);
    expect(sortKeyBetween(5, null)).toBe(6);
  });

  // Inserting between two rows must not renumber anything, because a
  // renumbering made offline would conflict with every other pending edit.
  it("lands strictly between two neighbours", () => {
    const mid = sortKeyBetween(1, 2);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
  });

  it("survives repeated insertion at the same spot", () => {
    let low = 1;
    const high = 2;
    for (let i = 0; i < 20; i++) {
      const next = sortKeyBetween(low, high);
      expect(next).toBeGreaterThan(low);
      expect(next).toBeLessThan(high);
      low = next;
    }
  });
});
