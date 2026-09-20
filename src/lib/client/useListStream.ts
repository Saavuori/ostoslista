"use client";

import { useEffect, useRef, useState } from "react";
import type { ItemView } from "@/lib/lists/service";
import type { Envelope } from "@/lib/realtime/bus";

export type ConnectionState = "connecting" | "live" | "offline";

interface Options {
  token: string;
  /** This device's member id, used to ignore the echo of its own writes. */
  memberId: string | null;
  onItemUpserted: (item: ItemView) => void;
  onItemRemoved: (itemId: string) => void;
  /** Called when the stream cannot be patched up and a refetch is needed. */
  onResync: () => void;
}

/**
 * Subscribes to a list's change stream.
 *
 * EventSource is used rather than a hand-rolled fetch loop because it already
 * does the tedious parts correctly: automatic reconnection with backoff, and
 * `Last-Event-ID` on reconnect so the server can replay what was missed.
 *
 * Events caused by this device are dropped. The local optimistic update is
 * already correct and newer, so applying the echo would make the UI flicker.
 */
export function useListStream({
  token,
  memberId,
  onItemUpserted,
  onItemRemoved,
  onResync,
}: Options): { state: ConnectionState; viewers: number } {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [viewers, setViewers] = useState(1);

  // Held in refs so changing a handler does not tear down the connection.
  const handlers = useRef({ onItemUpserted, onItemRemoved, onResync });
  handlers.current = { onItemUpserted, onItemRemoved, onResync };

  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;

    const source = new EventSource(`/api/lists/${token}/events`);

    source.onopen = () => setState("live");

    source.onerror = () => {
      // EventSource reconnects on its own; this only reflects the state.
      setState(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    };

    source.addEventListener("resync", () => {
      handlers.current.onResync();
    });

    source.onmessage = (message) => {
      setState("live");

      let envelope: Envelope;
      try {
        envelope = JSON.parse(message.data) as Envelope;
      } catch {
        return;
      }

      if (envelope.event.type === "presence") {
        setViewers(Math.max(1, envelope.event.count));
        return;
      }

      // Our own change, already applied locally and more up to date.
      if (memberId && envelope.origin === memberId) return;

      switch (envelope.event.type) {
        case "item.added":
        case "item.updated": {
          const item = envelope.event.item;
          handlers.current.onItemUpserted({
            ...item,
            // JSON has no Date type; rehydrate what the merge logic compares.
            updatedAt: new Date(item.updatedAt),
            checkedAt: item.checkedAt ? new Date(item.checkedAt) : null,
            deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
          });
          break;
        }
        case "item.removed":
          handlers.current.onItemRemoved(envelope.event.itemId);
          break;
        default:
          break;
      }
    };

    return () => {
      source.close();
    };
  }, [token, memberId]);

  // The browser knows about connectivity before the stream notices.
  useEffect(() => {
    const goOffline = () => setState("offline");
    window.addEventListener("offline", goOffline);
    return () => window.removeEventListener("offline", goOffline);
  }, []);

  return { state, viewers };
}
