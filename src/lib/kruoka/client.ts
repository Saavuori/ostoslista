import { normalizeSearchResponse } from "./normalize";
import type { Product } from "./types";

/**
 * Client for K-Ruoka's internal storefront API.
 *
 * This runs SERVER-SIDE ONLY. The upstream endpoint sends no CORS headers, so a
 * browser cannot call it directly — see AGENTS.md. Everything the client needs
 * goes through our own /api/products routes.
 *
 * Treat this file as a liability: the endpoint is undocumented, unversioned and
 * sits behind Cloudflare. It is deliberately isolated so that when it breaks,
 * it breaks here.
 */

const BASE_URL = "https://www.k-ruoka.fi/kr-api";

/** Espoo / Iso Omena. Overridable per request and via KRUOKA_DEFAULT_STORE. */
export const DEFAULT_STORE_ID = "N106";

export class KRuokaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "KRuokaError";
  }
}

export interface SearchOptions {
  storeId?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface KRuokaClientOptions {
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  storeId?: string;
  timeoutMs?: number;
  /** Minimum gap between upstream calls. We are a guest on their infrastructure. */
  minIntervalMs?: number;
}

/**
 * Headers that make us look like the storefront SPA rather than a bare script.
 *
 * Observed behaviour: requests without a browser-shaped header set are answered
 * with HTTP 409 even though the identical URL succeeds from the site itself.
 */
function upstreamHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Language": "fi-FI,fi;q=0.9",
    Origin: "https://www.k-ruoka.fi",
    Referer: "https://www.k-ruoka.fi/kauppa/tuotehaku",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  };
}

export class KRuokaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly storeId: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private lastCallAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: KRuokaClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.storeId = options.storeId ?? process.env.KRUOKA_DEFAULT_STORE ?? DEFAULT_STORE_ID;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.minIntervalMs = options.minIntervalMs ?? 250;
  }

  /** Serialises calls and spaces them out, so we never burst the upstream. */
  private throttle<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastCallAt = Date.now();
      return task();
    });
    // Keep the chain alive even when a call rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async post(path: string, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method: "POST",
        headers: upstreamHeaders(),
        body: "{}",
        signal: combined,
        cache: "no-store",
      });
    } catch (cause) {
      throw new KRuokaError(`upstream unreachable: ${String(cause)}`, null, true);
    }

    if (!response.ok) {
      // 429/5xx are worth retrying; 409 usually means they did not like the
      // shape of the request, and retrying identically will not help.
      const retryable = response.status === 429 || response.status >= 500;
      throw new KRuokaError(`upstream returned ${response.status}`, response.status, retryable);
    }

    return response.json();
  }

  /** Full-text product search against one store's assortment. */
  async searchProducts(query: string, options: SearchOptions = {}): Promise<Product[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const storeId = options.storeId ?? this.storeId;
    const params = new URLSearchParams({
      offset: String(options.offset ?? 0),
      language: "fi",
      storeId,
      limit: String(options.limit ?? 40),
      discountFilter: "false",
      isTrOffer: "false",
    });
    const path = `/v2/product-search/${encodeURIComponent(trimmed)}?${params}`;

    const body = await this.throttle(() => this.post(path, options.signal));
    return normalizeSearchResponse(body, storeId);
  }

  /**
   * Looks a product up by barcode.
   *
   * There is no by-EAN endpoint, so this searches for the digits and keeps an
   * exact match. Returns null rather than a near-miss: scanning a barcode and
   * getting a different product is worse than getting nothing.
   */
  async lookupByEan(ean: string, options: SearchOptions = {}): Promise<Product | null> {
    const digits = ean.replace(/\D/g, "");
    if (digits.length < 8) return null;
    const results = await this.searchProducts(digits, { ...options, limit: 10 });
    return results.find((p) => p.ean === digits) ?? null;
  }
}

/** Shared instance for route handlers. */
export const kruoka = new KRuokaClient();
