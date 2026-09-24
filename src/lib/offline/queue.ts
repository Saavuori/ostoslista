"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ItemView } from "@/lib/lists/service";
import { getDb, type OutboxEntry, type OutboxOp, type StoredItem } from "./db";
import { applyLocally, collapse, retryDelayMs, shouldGiveUp, toSyncPayload } from "./outbox";

/**
 * The offline layer's moving parts: storage, the network, and the retry loop.
 * The decisions live in `outbox.ts`, which is why this file is mostly plumbing.
 *
 * Changes are recorded locally first and sent afterwards. A change made in a
 * shop with no signal is not a failure to handle, it is the normal case.
 */

/** Records a change locally and returns the row as it now appears. */
export async function queueChange(
  token: string,
  itemId: string,
  op: OutboxOp,
  patch: Partial<StoredItem>,
  seed?: StoredItem,
): Promise<StoredItem | null> {
  const db = getDb();
  // No IndexedDB (private window, old browser): the caller stays online-only.
  if (!db) return null;

  const queuedAt = new Date();

  return db.transaction("rw", db.items, db.outbox, async () => {
    const current = seed ?? (await db.items.get(itemId));
    const next = current ? applyLocally(current, op, patch) : null;

    if (next) {
      if (op === "delete") await db.items.update(itemId, { deletedAt: next.deletedAt });
      else await db.items.put(next);
    } else if (op === "create") {
      // Nothing to seed from; the patch is the row.
      await db.items.put({ ...(patch as StoredItem), id: itemId, token });
    }

    const existing = await db.outbox.where({ token, itemId }).first();
    const incoming: OutboxEntry = { token, itemId, op, patch, queuedAt, attempts: 0 };
    const replacement = collapse(existing, incoming);

    if (existing?.seq !== undefined) await db.outbox.delete(existing.seq);
    for (const entry of replacement) {
      const { seq: _drop, ...rest } = entry;
      await db.outbox.add(rest as OutboxEntry);
    }

    return next ?? ({ ...(patch as StoredItem), id: itemId, token } as StoredItem);
  });
}

export interface FlushResult {
  sent: number;
  items: ItemView[] | null;
  abandoned: number;
  /** The request was attempted and did not succeed — the signal to back off. */
  failed: boolean;
}

const NOTHING_SENT: FlushResult = { sent: 0, items: null, abandoned: 0, failed: false };

/**
 * Sends everything queued for a list.
 *
 * The whole batch goes in one request: the server reconciles it and replies
 * with the truth, so the device can replace its local copy outright instead of
 * reasoning about what happened to each row.
 */
export async function flush(token: string, memberId: string | null): Promise<FlushResult> {
  const db = getDb();
  if (!db) return NOTHING_SENT;

  const entries = await db.outbox.where("token").equals(token).sortBy("seq");
  if (entries.length === 0) return NOTHING_SENT;

  const payload = toSyncPayload(entries, memberId);

  try {
    const response = await fetch(`/api/lists/${token}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`sync failed: ${response.status}`);

    const body = (await response.json()) as { items: ItemView[] };

    const items = await db.transaction("rw", db.items, db.outbox, async () => {
      // Only clear what was actually sent — a change made while the request
      // was in flight must survive.
      for (const entry of entries) {
        if (entry.seq !== undefined) await db.outbox.delete(entry.seq);
      }

      // A row deleted while this request was in flight is still in the reply.
      // Its tombstone goes out with the next flush; until then, showing the
      // server's copy would make the deletion visibly undo itself.
      const stillQueued = await db.outbox.where("token").equals(token).toArray();
      const deleting = new Set(
        stillQueued.filter((entry) => entry.op === "delete").map((entry) => entry.itemId),
      );
      const visible = body.items.filter((item) => !deleting.has(item.id));

      await db.items.where("token").equals(token).delete();
      await db.items.bulkPut(visible.map((item) => ({ ...item, token })));
      return visible;
    });

    return { sent: entries.length, items, abandoned: 0, failed: false };
  } catch {
    let abandoned = 0;
    await db.transaction("rw", db.outbox, async () => {
      for (const entry of entries) {
        if (entry.seq === undefined) continue;
        const attempted = { ...entry, attempts: entry.attempts + 1 };
        if (shouldGiveUp(attempted)) {
          // Giving up quietly would lose the change; the count surfaces it.
          await db.outbox.delete(entry.seq);
          abandoned += 1;
        } else {
          await db.outbox.update(entry.seq, { attempts: attempted.attempts });
        }
      }
    });
    return { sent: 0, items: null, abandoned, failed: true };
  }
}

export async function pendingCount(token: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  return db.outbox.where("token").equals(token).count();
}

/**
 * Keeps a list's queue draining.
 *
 * Flushes when the browser regains connectivity, when the tab becomes visible
 * again (coming back to the app in the shop), and otherwise on a backoff timer.
 */
export function useOfflineSync(
  token: string,
  memberId: string | null,
  onSynced: (items: ItemView[]) => void,
): { pending: number; abandoned: number; flushNow: () => void } {
  const [pending, setPending] = useState(0);
  const [abandoned, setAbandoned] = useState(0);
  const [attempts, setAttempts] = useState(0);

  /**
   * Held in a ref so a caller passing an inline callback does not change the
   * identity of `run` on every render. It used to, which tore down and rebuilt
   * the effect continuously and cleared the retry timer before it could fire —
   * queued changes then sat there until something else happened to flush them.
   */
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  /** Guards against two flushes overlapping and sending the same rows twice. */
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await flush(token, memberId);
      if (result.items) {
        onSyncedRef.current(result.items);
        setAttempts(0);
      } else if (result.abandoned > 0) {
        setAbandoned((count) => count + result.abandoned);
      }
      setPending(await pendingCount(token));
      // Only a real failure backs off. An empty queue used to count too, so
      // every focus or reconnect with nothing to send lengthened the wait
      // before the next real change was retried.
      if (result.failed) setAttempts((n) => n + 1);
    } finally {
      inFlight.current = false;
    }
  }, [token, memberId]);

  useEffect(() => {
    void pendingCount(token).then(setPending);
  }, [token]);

  useEffect(() => {
    const trigger = () => void run();

    window.addEventListener("online", trigger);
    document.addEventListener("visibilitychange", trigger);

    // Only poll while something is actually waiting to go out.
    const timer = pending > 0 ? setTimeout(trigger, retryDelayMs(attempts)) : undefined;

    return () => {
      window.removeEventListener("online", trigger);
      document.removeEventListener("visibilitychange", trigger);
      if (timer) clearTimeout(timer);
    };
  }, [run, pending, attempts]);

  const flushNow = useCallback(() => {
    // Reflect the new queue depth immediately; the badge should not wait for
    // a failed request to come back.
    void pendingCount(token).then(setPending);
    void run();
  }, [run, token]);

  return { pending, abandoned, flushNow };
}
