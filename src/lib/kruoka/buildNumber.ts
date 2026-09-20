import { request, type TransportResponse } from "./transport";

/**
 * The client build number K-Ruoka's API requires.
 *
 * Requests without it are answered:
 *
 *   409 {"error":{"message":"Client version is too old - reload"}}
 *
 * The storefront serves its assets from `/assets/b-<number>/`, so the current
 * value is read from there — the same way the browser learns it. It changes on
 * every deploy, which is why it is discovered rather than hard-coded, cached
 * for a while, and re-read whenever the API says it is stale.
 */

const STOREFRONT = "https://www.k-ruoka.fi/kauppa/tuotehaku";
const BUILD_PATTERN = /\/assets\/b-(\d+)\//;

/** Long enough to avoid refetching constantly, short enough to follow deploys. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface Cached {
  value: string;
  at: number;
}

let cache: Cached | null = null;
let inFlight: Promise<string> | null = null;

export function extractBuildNumber(html: string): string | null {
  return html.match(BUILD_PATTERN)?.[1] ?? null;
}

type Fetcher = (url: string) => Promise<TransportResponse>;

const defaultFetcher: Fetcher = (url) => request(url, { timeoutMs: 20_000 });

/**
 * Returns the current build number, fetching it at most once at a time.
 *
 * Concurrent callers share one request: on a cold start several searches can
 * arrive together, and they should not each fetch a three-megabyte page.
 */
export async function getBuildNumber(fetcher: Fetcher = defaultFetcher): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetcher(STOREFRONT);
      if (response.status !== 200) {
        throw new Error(`storefront returned ${response.status}`);
      }

      const value = extractBuildNumber(response.body);
      if (!value) throw new Error("no build number in the storefront markup");

      cache = { value, at: Date.now() };
      return value;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Forces a re-read. Called when the API reports the version is stale. */
export function invalidateBuildNumber(): void {
  cache = null;
}

/** Test helper. */
export function primeBuildNumber(value: string): void {
  cache = { value, at: Date.now() };
}
