import type { ItemView } from "@/lib/lists/service";

/**
 * In-process publish/subscribe for list changes.
 *
 * **Deliberately single-instance.** This app deploys as one container on one
 * VM, so an in-process bus is the honest amount of machinery: no broker, no
 * extra dependency, no operational surface. If it is ever run with more than
 * one replica, this must be swapped for Postgres `LISTEN`/`NOTIFY` — the
 * interface below is the seam for exactly that, which is why publishing is
 * async even though nothing awaits anything today.
 *
 * Events describe what changed rather than carrying the whole list, so a
 * client that has been connected for an hour does not re-download everything
 * each time someone ticks a box.
 */

export type ListEvent =
  | { type: "item.added"; item: ItemView }
  | { type: "item.updated"; item: ItemView }
  | { type: "item.removed"; itemId: string }
  | { type: "list.renamed"; name: string }
  | { type: "presence"; count: number };

/** An event plus the delivery metadata the transport needs. */
export interface Envelope {
  id: number;
  listId: string;
  /** The member who caused it, so a client can skip echoing its own change. */
  origin: string | null;
  event: ListEvent;
}

type Listener = (envelope: Envelope) => void;

const listeners = new Map<string, Set<Listener>>();

/**
 * Monotonic event id.
 *
 * Used as the SSE `id:` field so a reconnecting browser can send
 * `Last-Event-ID` and we can tell whether it missed anything.
 */
let sequence = 0;

/** Recent events per list, so a short reconnection does not need a refetch. */
const REPLAY_LIMIT = 50;
const recent = new Map<string, Envelope[]>();

export function subscribe(listId: string, listener: Listener): () => void {
  let set = listeners.get(listId);
  if (!set) {
    set = new Set();
    listeners.set(listId, set);
  }
  set.add(listener);

  return () => {
    set.delete(listener);
    // Drop the bucket entirely when the last subscriber leaves, so an
    // long-running server does not accumulate one Set per list ever opened.
    if (set.size === 0) {
      listeners.delete(listId);
      recent.delete(listId);
    }
  };
}

export async function publish(
  listId: string,
  event: ListEvent,
  origin: string | null = null,
): Promise<void> {
  sequence += 1;
  const envelope: Envelope = { id: sequence, listId, origin, event };

  const buffer = recent.get(listId) ?? [];
  buffer.push(envelope);
  if (buffer.length > REPLAY_LIMIT) buffer.splice(0, buffer.length - REPLAY_LIMIT);
  recent.set(listId, buffer);

  for (const listener of listeners.get(listId) ?? []) {
    try {
      listener(envelope);
    } catch (error) {
      // One broken subscriber must not stop delivery to the others.
      console.error("realtime listener failed:", error);
    }
  }
}

/**
 * Events a reconnecting client missed.
 *
 * Returns null when the gap is too large to bridge, which tells the caller to
 * do a full refetch instead of silently showing an incomplete list.
 */
export function replaySince(listId: string, lastEventId: number): Envelope[] | null {
  const buffer = recent.get(listId);
  if (!buffer || buffer.length === 0) return [];

  const oldest = buffer[0]!.id;
  if (lastEventId < oldest - 1) return null;

  return buffer.filter((envelope) => envelope.id > lastEventId);
}

/** Number of open connections for a list — used for the presence indicator. */
export function subscriberCount(listId: string): number {
  return listeners.get(listId)?.size ?? 0;
}

/** Test helper. Never called in production code. */
export function resetBus(): void {
  listeners.clear();
  recent.clear();
  sequence = 0;
}
