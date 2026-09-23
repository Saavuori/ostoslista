import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemView } from "@/lib/lists/service";
import {
  currentSequence,
  type Envelope,
  publish,
  replaySince,
  resetBus,
  subscribe,
  subscriberCount,
} from "./bus";

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
  updatedAt: new Date(),
  updatedBy: null,
  deletedAt: null,
});

beforeEach(() => {
  vi.restoreAllMocks();
  resetBus();
});

/** A restart, which in reality is never within the same millisecond. */
function restartLater() {
  const later = Date.now() + 5_000;
  vi.spyOn(Date, "now").mockReturnValue(later);
  resetBus();
}

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
  });

  // The presence update sent as the last viewer leaves used to re-create it.
  it("does not re-create a bucket by publishing to a list nobody watches", async () => {
    await publish("list-a", { type: "presence", count: 0 });
    const seen = currentSequence();

    expect(replaySince("list-a", seen)).toEqual([]);
    expect(subscriberCount("list-a")).toBe(0);
  });

  it("is safe to call twice", () => {
    const off = subscribe("list-a", () => {});
    off();
    expect(() => off()).not.toThrow();
  });
});

describe("replaySince", () => {
  it("returns only events newer than the supplied id", async () => {
    const received: Envelope[] = [];
    subscribe("list-a", (e) => received.push(e));
    await publish("list-a", { type: "item.removed", itemId: "a" });
    await publish("list-a", { type: "item.removed", itemId: "b" });
    await publish("list-a", { type: "item.removed", itemId: "c" });

    const missed = replaySince("list-a", received[0]!.id);

    expect(missed?.map((e) => e.id)).toEqual([received[1]!.id, received[2]!.id]);
  });

  it("returns nothing when the client is already current", async () => {
    subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });

    expect(replaySince("list-a", currentSequence())).toEqual([]);
  });

  it("returns an empty list when nothing has happened since", () => {
    expect(replaySince("unknown", currentSequence())).toEqual([]);
  });

  // Ids are global, so events on other lists are not a gap in this one.
  it("does not ask for a refetch because other lists were busy", async () => {
    subscribe("list-a", () => {});
    subscribe("list-b", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });
    const seen = currentSequence();
    for (let i = 0; i < 5; i++) {
      await publish("list-b", { type: "item.removed", itemId: String(i) });
    }
    await publish("list-a", { type: "item.removed", itemId: "b" });

    expect(replaySince("list-a", seen)?.map((e) => e.event)).toEqual([
      { type: "item.removed", itemId: "b" },
    ]);
  });

  /**
   * The important case: if a client was away long enough that its next event
   * fell out of the buffer, we must say so rather than hand back a partial
   * history that would leave the list quietly wrong.
   */
  it("signals that a refetch is needed when the gap is too large", async () => {
    const received: Envelope[] = [];
    subscribe("list-a", (e) => received.push(e));
    for (let i = 0; i < 60; i++) {
      await publish("list-a", { type: "item.removed", itemId: String(i) });
    }

    expect(replaySince("list-a", received[0]!.id)).toBeNull();
  });

  it("caps the buffer rather than growing without bound", async () => {
    subscribe("list-a", () => {});
    for (let i = 0; i < 200; i++) {
      await publish("list-a", { type: "item.removed", itemId: String(i) });
    }

    expect(replaySince("list-a", currentSequence() - 1)?.length).toBe(1);
  });

  /**
   * The phone that slept through a deploy: it reconnects with an id from the
   * previous process. Answering "nothing missed" would lose every edit made
   * while it was away.
   */
  it("asks for a refetch after a restart", async () => {
    subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });
    const beforeRestart = currentSequence();

    restartLater();
    subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "b" });

    expect(currentSequence()).toBeGreaterThan(beforeRestart);
    expect(replaySince("list-a", beforeRestart)).toBeNull();
  });

  it("asks for a refetch after a restart even when nothing has been published", () => {
    const beforeRestart = currentSequence();
    restartLater();

    expect(replaySince("list-a", beforeRestart)).toBeNull();
  });

  it("asks for a refetch for an id this process never issued", () => {
    expect(replaySince("list-a", currentSequence() + 10)).toBeNull();
  });

  /**
   * The last viewer's connection drops, an edit lands while nobody is
   * listening, and that viewer reconnects. The edit was never buffered.
   */
  it("asks for a refetch when edits happened while nobody was listening", async () => {
    const off = subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });
    const seen = currentSequence();
    off();

    await publish("list-a", { type: "item.removed", itemId: "b" });

    expect(replaySince("list-a", seen)).toBeNull();
  });

  it("asks for a refetch when the bucket holding missed events was released", async () => {
    const off = subscribe("list-a", () => {});
    await publish("list-a", { type: "item.removed", itemId: "a" });
    const seen = currentSequence();
    await publish("list-a", { type: "item.removed", itemId: "b" });
    off();

    subscribe("list-a", () => {});

    expect(replaySince("list-a", seen)).toBeNull();
  });
});
