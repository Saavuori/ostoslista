import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ListError } from "@/lib/lists/service";

/**
 * One place that turns a thrown error into a response.
 *
 * Route handlers stay free of try/catch noise, and — more importantly — an
 * unexpected error can never leak a stack trace or a database message to the
 * client, because only errors we raised deliberately get their text through.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ListError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Virheelliset tiedot",
        // Field-level messages so the UI can point at the offending input.
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  console.error("unhandled route error:", error);
  return NextResponse.json({ error: "Jotain meni vikaan" }, { status: 500 });
}

/** Wraps a handler so thrown errors become responses. */
export function handle<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Parses a JSON body, turning malformed input into a 400 rather than a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new (await import("@/lib/lists/service")).ListError("Virheellinen JSON", 400);
  }
}
