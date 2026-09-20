import { NextResponse } from "next/server";
import { z } from "zod";
import { searchCatalogue } from "@/lib/catalogue/cache";
import { handle } from "@/lib/http";
import { DEFAULT_STORE_ID } from "@/lib/kruoka/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
  storeId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2,16}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

/**
 * Product search.
 *
 * This exists because the browser cannot call K-Ruoka directly — the upstream
 * sends no CORS headers. Routing through here also lets us cache, throttle and
 * normalise in one place. See AGENTS.md.
 */
export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const { q, storeId, limit } = querySchema.parse({
    q: url.searchParams.get("q") ?? "",
    storeId: url.searchParams.get("storeId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  try {
    const items = await searchCatalogue(q, {
      storeId: storeId ?? DEFAULT_STORE_ID,
      ...(limit ? { limit } : {}),
      signal: request.signal,
    });
    return NextResponse.json({ items });
  } catch (error) {
    // Search failing must not block the list: the UI falls back to adding the
    // typed text as a free-text item.
    console.error("product search failed:", error);
    return NextResponse.json({ items: [], degraded: true }, { status: 200 });
  }
});
