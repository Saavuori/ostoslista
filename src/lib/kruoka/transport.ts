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
  /** Final response's headers, lower-cased names, first value of each. */
  headers?: Record<string, string>;
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
    // Body, then the headers as JSON, then the status code.
    "--write-out",
    // curl expands the `\n` escapes itself. `header_json` needs curl 7.83+.
    "\\n__HEADERS__%{header_json}\\n__STATUS__%{http_code}",
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

  const parsed = parseCurlOutput(stdout);
  if (!parsed) {
    throw new TransportError(`malformed response for ${url}`);
  }
  return parsed;
}

const HEADERS_MARKER = "\n__HEADERS__";
const STATUS_MARKER = "\n__STATUS__";

/**
 * Splits curl's stdout into body, headers and status.
 *
 * Searched from the end, so a body that happens to contain a marker cannot
 * confuse it. Headers are optional: an unparseable block is dropped rather
 * than failing a response whose body is fine.
 */
export function parseCurlOutput(stdout: string): TransportResponse | null {
  const statusAt = stdout.lastIndexOf(STATUS_MARKER);
  if (statusAt === -1) return null;

  const status = Number.parseInt(stdout.slice(statusAt + STATUS_MARKER.length), 10);
  const headersAt = stdout.lastIndexOf(HEADERS_MARKER, statusAt);
  if (headersAt === -1) return { body: stdout.slice(0, statusAt), status };

  const headers: Record<string, string> = {};
  try {
    const raw = JSON.parse(stdout.slice(headersAt + HEADERS_MARKER.length, statusAt)) as Record<
      string,
      unknown
    >;
    for (const [name, value] of Object.entries(raw)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") headers[name.toLowerCase()] = first;
    }
  } catch {
    // Headers are a bonus; the body and status are what callers depend on.
  }

  return { body: stdout.slice(0, headersAt), status, headers };
}
