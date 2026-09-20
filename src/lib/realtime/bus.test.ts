import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemView } from "@/lib/lists/service";
import { type Envelope, publish, replaySince, resetBus, subscribe, subscriberCount } from "./bus";

const item = (id: string): ItemView => ({
  id,
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
  qty: 1,
  qtyUnit: "kpl",
  note: null,
  checked: false,
  checkedBy: null,
  checkedAt: null,
  sortKey: 1,
  addedBy: null,
  updatedAt: new Date(),
  updatedBy: null,
  deletedAt: null,
});

beforeEach(() => {
  resetBus();
});

describe("subscribe and publish", () => {
  it("delivers an event to a subscriber of that list", async () => {
    const received: Envelope[] = [];
    subscribe("list-a", (e) => received.push(e));

    await publish("list-a", { type: "item.added", item: item("i1") });

    expect(received).toHaveLength(1);
    expect(received[0]?.event.type).toBe("item.added");
  });

  it("does not leak events between lists", async () => {
    const a: Envelope[] = [];
    const b: Envelope[] = [];
    subscribe("list-a", (e) => a.push(e));
    subscribe("list-b", (e) => b.push(e));

    await publish("list-a", { type: "item.removed", itemId: "i1" });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("delivers to every subscriber of the same list", async () => {
    const seen: string[] = [];
    subscribe("list-a", () => seen.push("first"));
    subscribe("list-a", () => seen.push("second"));

    await publish("list-a", { type: "item.removed", itemId: "i1" });

    expect(seen).toEqual(["first", "second"]);
  });

  it("carries the origin so a client can ignore its own echo", async () => {
    const received: Envelope[] = [];
    subscribe("list-a", (e) => received.push(e));

    await publish("list-a", { type: "item.removed", itemId: "i1" }, "member-1");

    expect(received[0]?.origin).toBe("member-1");
  });

  it("assigns strictly increasing ids", async () => {
    const received: Envelope[] = [];
    subscribe("list-a", (e) => received.push(e));

    await publish("list-a", { type: "item.removed", itemId: "a" });
    await publish("list-a", { type: "item.removed", itemId: "b" });
    await publish("list-a", { type: "item.removed", itemId: "c" });

    const ids = received.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(new Set(ids).size).toBe(3);
  });

  // One misbehaving connection must not silently stop everyone else's updates.
  it("keeps delivering when a listener throws", async () => {
    const good: Envelope[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});

    subscribe("list-a", () => {
      throw new Error("boom");
    });
    subscribe("list-a", (e) => good.push(e));

    await publish("list-a", { type: "item.removed", itemId: "i1" });

    expect(good).toHaveLength(1);
  });
});

describe("unsubscribe", () => {
  it("stops delivery", async () => {
    const received: Envelope[] = [];
    const off = subscribe("list-a", (e) => received.push(e));

    await publish("list-a", { type: "item.removed", itemId: "a" });
    off();
    await publish("list-a", { type: "item.removed", itemId: "b" });

    expect(received).toHaveLength(1);
  });

  // Otherwise a long-lived server accumulates one bucket per list ever opened.
  it("releases the list's bucket once the last subscriber leaves", async () => {
    const off = subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });
    expect(subscriberCount("list-a")).toBe(1);

    off();

    expect(subscriberCount("list-a")).toBe(0);
    expect(replaySince("list-a", 0)).toEqual([]);
  });

  it("is safe to call twice", () => {
    const off = subscribe("list-a", () => {});
    off();
    expect(() => off()).not.toThrow();
  });
});

describe("replaySince", () => {
  it("returns only events newer than the supplied id", async () => {
    subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });
    await publish("list-a", { type: "item.removed", itemId: "b" });
    await publish("list-a", { type: "item.removed", itemId: "c" });

    const missed = replaySince("list-a", 1);

    expect(missed?.map((e) => e.id)).toEqual([2, 3]);
  });

  it("returns nothing when the client is already current", async () => {
    subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });

    expect(replaySince("list-a", 1)).toEqual([]);
  });

  it("returns an empty list for a list with no history", () => {
    expect(replaySince("unknown", 0)).toEqual([]);
  });

  /**
   * The important case: if a client was away long enough that its next event
   * fell out of the buffer, we must say so rather than hand back a partial
   * history that would leave the list quietly wrong.
   */
  it("signals that a refetch is needed when the gap is too large", async () => {
    subscribe("list-a", () => {});
    for (let i = 0; i < 60; i++) {
      await publish("list-a", { type: "item.removed", itemId: String(i) });
    }

    expect(replaySince("list-a", 1)).toBeNull();
  });

  it("caps the buffer rather than growing without bound", async () => {
    subscribe("list-a", () => {});
    for (let i = 0; i < 200; i++) {
      await publish("list-a", { type: "item.removed", itemId: String(i) });
    }

    expect(replaySince("list-a", 199)?.length).toBe(1);
  });
});
