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

/** Recent events per list, so a short reconnection does not need a refetch. */
const REPLAY_LIMIT = 50;

interface Channel {
  listeners: Set<Listener>;
  /** The last REPLAY_LIMIT events for this list, oldest first. */
  buffer: Envelope[];
  /**
   * Events with ids up to here may have happened and are no longer held.
   * A client whose last-seen id is below this cannot be patched up. Ids are
   * global across lists, so a gap in this list's ids proves nothing — this
   * watermark is what actually says whether history is complete.
   */
  forgottenUpTo: number;
}

const channels = new Map<string, Channel>();

/**
 * Monotonic event id, used as the SSE `id:` field so a reconnecting browser
 * can send `Last-Event-ID` and we can tell whether it missed anything.
 *
 * Seeded from the clock rather than zero. A browser that reconnects after a
 * restart still sends the previous process's last id; starting from zero, that
 * id would look like the future and the replay would come back empty — the
 * edits made while it was away would never arrive. Seeded this way, ids keep
 * rising across restarts (at under a thousand events per millisecond).
 */
function seed(): number {
  return Date.now() * 1000;
}

let sequence = seed();

/**
 * Nothing before this is held by any channel: everything the previous process
 * published, and every list whose channel has since been released.
 */
let forgottenUpTo = sequence;

function openChannel(listId: string): Channel {
  // A fresh channel holds nothing from before now for this list.
  const channel: Channel = { listeners: new Set(), buffer: [], forgottenUpTo: sequence };
  channels.set(listId, channel);
  return channel;
}

export function subscribe(listId: string, listener: Listener): () => void {
  const channel = channels.get(listId) ?? openChannel(listId);
  channel.listeners.add(listener);

  return () => {
    channel.listeners.delete(listener);
    // Drop the channel entirely when the last subscriber leaves, so a
    // long-running server does not accumulate one per list ever opened. What
    // it held is gone, which is recorded so a reconnect is told to refetch
    // instead of being handed an empty — and wrong — replay.
    if (channel.listeners.size === 0 && channels.get(listId) === channel) {
      channels.delete(listId);
      forgottenUpTo = Math.max(forgottenUpTo, sequence);
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

  const channel = channels.get(listId);
  if (!channel) {
    // Nobody is listening, so nothing is held: a client that reconnects later
    // must refetch. Creating a channel here would leak one per list written
    // to — including the presence update sent as the last viewer leaves.
    forgottenUpTo = Math.max(forgottenUpTo, sequence);
    return;
  }

  channel.buffer.push(envelope);
  if (channel.buffer.length > REPLAY_LIMIT) {
    const dropped = channel.buffer.splice(0, channel.buffer.length - REPLAY_LIMIT);
    channel.forgottenUpTo = dropped.at(-1)!.id;
  }

  for (const listener of channel.listeners) {
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
 * Returns null when the history needed to bridge the gap is not held — the
 * client was away too long, the server restarted, or the id is not one this
 * process issued — which tells the caller to do a full refetch instead of
 * silently showing an incomplete list. A spurious null costs one refetch; a
 * wrong empty answer costs a list that is quietly out of date.
 */
export function replaySince(listId: string, lastEventId: number): Envelope[] | null {
  if (lastEventId > sequence) return null;

  const channel = channels.get(listId);
  const floor = channel ? channel.forgottenUpTo : forgottenUpTo;
  if (lastEventId < floor) return null;

  return channel ? channel.buffer.filter((envelope) => envelope.id > lastEventId) : [];
}

/** Number of open connections for a list — used for the presence indicator. */
export function subscriberCount(listId: string): number {
  return channels.get(listId)?.listeners.size ?? 0;
}

/** Test helper. Never called in production code. */
export function resetBus(): void {
  channels.clear();
  sequence = seed();
  forgottenUpTo = sequence;
}

/** Test helper: the id most recently issued. */
export function currentSequence(): number {
  return sequence;
}
