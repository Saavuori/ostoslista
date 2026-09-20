import { NextResponse } from "next/server";
import { handle } from "@/lib/http";
import { getList } from "@/lib/lists/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** Reads a list by share token. */
export const GET = handle(async (_request: Request, { params }: Params) => {
  const { token } = await params;
  return NextResponse.json(await getList(token));
});
