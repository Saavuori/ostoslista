import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/http";
import { addItem } from "@/lib/lists/service";
import { createItemSchema } from "@/lib/lists/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Adds an item.
 *
 * Responds 200 when the item merged into an existing line and 201 when a new
 * row was created, so the client can tell the difference without re-reading.
 */
export const POST = handle(async (request: Request, { params }: Params) => {
  const { token } = await params;
  const input = createItemSchema.parse(await readJson(request));
  const { item, merged } = await addItem(token, input);
  return NextResponse.json({ item, merged }, { status: merged ? 200 : 201 });
});
