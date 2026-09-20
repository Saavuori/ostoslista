import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { getHistory } from "@/lib/lists/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** Things this list has bought before and is not holding right now. */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const { token } = await params;
  return NextResponse.json({ entries: await getHistory(token) });
});
