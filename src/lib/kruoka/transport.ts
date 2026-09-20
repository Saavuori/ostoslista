import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * HTTP transport for K-Ruoka, using curl.
 *
 * Node's built-in fetch is answered with a Cloudflare challenge page on this
 * domain; curl is served normally. Nothing here defeats that protection —
 * there is no challenge to solve, no stealth browser, and no forged TLS
 * fingerprint. curl presents its own, and we identify the app honestly in the
 * User-Agent. This is a compatibility choice, not a disguise.
 *
 * Every invocation uses `execFile` with an argument array. There is no shell,
 * so a product name containing quotes, semicolons or backticks is an argument
 * and nothing else.
 */

export const USER_AGENT =
  "Ostoslista/1.0 (personal shopping list; +https://github.com/Saavuori/ostoslista)";

export interface TransportResponse {
  status: number;
  body: string;
}

export interface TransportRequest {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export class TransportError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/** Only these may be requested; anything else is a bug or an injection attempt. */
const ALLOWED_ORIGIN = "https://www.k-ruoka.fi";

/**
 * Performs one request.
 *
 * The status is written to stdout after the body and split off here, which
 * avoids a second process or a temporary file.
 */
export async function request(
  url: string,
  options: TransportRequest = {},
): Promise<TransportResponse> {
  if (!url.startsWith(`${ALLOWED_ORIGIN}/`)) {
    throw new TransportError(`refusing to request a url outside ${ALLOWED_ORIGIN}: ${url}`);
  }

  const timeoutMs = options.timeoutMs ?? 20_000;
  const seconds = Math.ceil(timeoutMs / 1000);

  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    String(seconds),
    "--compressed",
    "--user-agent",
    USER_AGENT,
    // Body, then a separator, then the status code.
    "--write-out",
    "\\n__STATUS__%{http_code}",
  ];

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    args.push("--header", `${name}: ${value}`);
  }

  if (options.method === "POST") {
    args.push("--request", "POST", "--data-binary", options.body ?? "{}");
  }

  args.push(url);

  let stdout: string;
  try {
    const result = await run("curl", args, {
      // Category listings are a few megabytes.
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs + 5_000,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (cause) {
    throw new TransportError(`request failed: ${url}`, cause);
  }

  const marker = stdout.lastIndexOf("\n__STATUS__");
  if (marker === -1) {
    throw new TransportError(`malformed response for ${url}`);
  }

  return {
    body: stdout.slice(0, marker),
    status: Number.parseInt(stdout.slice(marker + "\n__STATUS__".length), 10),
  };
}

/** True when curl is available, which the whole integration depends on. */
export async function isAvailable(): Promise<boolean> {
  try {
    await run("curl", ["--version"], { timeout: 5_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
