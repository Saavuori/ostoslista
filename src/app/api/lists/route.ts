import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/http";
import { createList } from "@/lib/lists/service";
import { createListSchema } from "@/lib/lists/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates a list and returns the share link for it. */
export const POST = handle(async (request: Request) => {
  const input = createListSchema.parse(await readJson(request));
  const { id, token, memberId } = await createList(input);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  return NextResponse.json({ id, token, memberId, url: `${base}/l/${token}` }, { status: 201 });
});
