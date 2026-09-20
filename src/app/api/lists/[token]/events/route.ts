import { authorize } from "@/lib/lists/service";
import {
  type Envelope,
  publish,
  replaySince,
  subscribe,
  subscriberCount,
} from "@/lib/realtime/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** Proxies commonly buffer for 30-60s; stay comfortably under that. */
const HEARTBEAT_MS = 20_000;

/**
 * Server-Sent Events stream for one list.
 *
 * SSE rather than WebSockets: a list only needs server-to-client fanout, and
 * SSE survives reverse proxies, corporate networks and mobile radios far more
 * reliably. It also reconnects on its own, with `Last-Event-ID`, which is most
 * of what an offline-capable client needs for free.
 */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;

  // Throws 404/403, which Next turns into the right status.
  const { listId } = await authorize(token);

  const encoder = new TextEncoder();
  const lastEventId = Number(request.headers.get("Last-Event-ID") ?? "0");

  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // The client vanished between the check and the write.
        }
      };

      const sendEvent = (envelope: Envelope) => {
        send(`id: ${envelope.id}\ndata: ${JSON.stringify(envelope)}\n\n`);
      };

      // Tell the browser how long to wait before reconnecting.
      send("retry: 3000\n\n");

      // Bridge whatever the client missed while it was away. A null reply
      // means the gap is too wide to patch, so ask for a full refetch rather
      // than leaving the list quietly incomplete.
      if (lastEventId > 0) {
        const missed = replaySince(listId, lastEventId);
        if (missed === null) {
          send(`event: resync\ndata: ${JSON.stringify({ reason: "gap" })}\n\n`);
        } else {
          for (const envelope of missed) sendEvent(envelope);
        }
      }

      unsubscribe = subscribe(listId, sendEvent);

      // Announce the new viewer, then tell this viewer who is already here.
      void publish(listId, { type: "presence", count: subscriberCount(listId) });

      heartbeat = setInterval(() => {
        // A comment frame: keeps proxies and mobile radios from dropping an
        // idle connection, and costs nothing to parse.
        send(`: keep-alive ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      void publish(listId, { type: "presence", count: subscriberCount(listId) });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx and friends not to buffer the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
