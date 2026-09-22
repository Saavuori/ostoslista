import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { deleteItem, updateItem } from "@/lib/lists/service";
import { updateItemSchema } from "@/lib/lists/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string; itemId: string }> };

export const PATCH = handle(async (request: Request, { params }: Params) => {
  const { token, itemId } = await params;
  const input = updateItemSchema.parse(await readJson(request));
  return NextResponse.json(await updateItem(token, itemId, input));
});

export const DELETE = handle(async (request: Request, { params }: Params) => {
  const { token, itemId } = await params;
  // Stored in a uuid column: a malformed value must be a 400, not a database error.
  const by = z.string().uuid().nullable().parse(new URL(request.url).searchParams.get("by"));
  return NextResponse.json(await deleteItem(token, itemId, by));
});
