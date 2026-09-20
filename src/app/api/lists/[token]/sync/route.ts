import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/http";
import { syncItems } from "@/lib/lists/service";
import { syncSchema } from "@/lib/lists/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Flushes edits made offline and returns the reconciled list.
 *
 * The response is the full live item set, so the client can replace its local
 * copy wholesale rather than reasoning about what the server did to each row.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const { token } = await params;
  const input = syncSchema.parse(await readJson(request));
  return NextResponse.json({ items: await syncItems(token, input) });
});
