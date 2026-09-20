import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe for the container healthcheck and the reverse proxy. */
export function GET() {
  return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
}
