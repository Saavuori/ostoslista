import { getBuildNumber, invalidateBuildNumber, rememberBuildNumber } from "./buildNumber";
import { normalizeLocation, type StoreLocation } from "./location";
import { normalizeSearchResponse } from "./normalize";
import { request, type TransportRequest, type TransportResponse } from "./transport";
import type { Product } from "./types";

/**
 * Client for K-Ruoka's storefront API.
 *
 * Server-side only. The endpoint sends no CORS headers, so the browser talks
 * to our own `/api/products/*` routes instead.
 *
 * Two things are required to get a useful answer, and both were discovered
 * from the API's own error responses:
 *
 * 1. `X-K-Build-Number`, the storefront's current build. Without the header
 *    Cloudflare answers with a challenge; with a stale value the API may reply
 *    409 "Client version is too old - reload". The current value arrives in
 *    every response's `k-ruoka-build` header — see `buildNumber.ts`.
 * 2. A request made by curl rather than Node's fetch — see `transport.ts`.
 *
 * Even so, treat this as a liability: it is undocumented and unversioned, and
 * it can change without notice. That is why every response goes through
 * `normalize.ts` before the rest of the app sees it.
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

/** Injectable for tests; defaults to the curl transport. */
export type Transport = (url: string, options?: TransportRequest) => Promise<TransportResponse>;

export interface KRuokaClientOptions {
  transport?: Transport;
  storeId?: string;
  timeoutMs?: number;
  /** Minimum gap between calls. We are a guest on someone else's service. */
  minIntervalMs?: number;
  /** Skips build-number discovery in tests. */
  buildNumber?: string;
}

export class KRuokaClient {
  private readonly transport: Transport;
  private readonly storeId: string;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly fixedBuildNumber: string | undefined;
  private lastCallAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: KRuokaClientOptions = {}) {
    this.transport = options.transport ?? request;
    this.storeId = options.storeId ?? process.env.KRUOKA_DEFAULT_STORE ?? DEFAULT_STORE_ID;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.fixedBuildNumber = options.buildNumber;
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

  /**
   * Issues one call, retrying once with the build number the API reports if it
   * says ours is stale. A deploy happens mid-session sooner or later, and one
   * retry turns that from an outage into a hiccup.
   */
  private async call(
    path: string,
    method: "GET" | "POST" = "POST",
    retriedAfterVersionBump = false,
  ): Promise<unknown> {
    const build = this.fixedBuildNumber ?? getBuildNumber();

    const response = await this.transport(`${BASE_URL}${path}`, {
      method,
      timeoutMs: this.timeoutMs,
      ...(method === "POST" ? { body: "{}" } : {}),
      headers: {
        Accept: "application/json",
        "Accept-Language": "fi-FI,fi;q=0.9",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        "X-K-Build-Number": build,
      },
    });

    const learned = !this.fixedBuildNumber && rememberBuildNumber(response.headers);

    if (response.status === 409 && !retriedAfterVersionBump) {
      const message = safeErrorMessage(response.body);
      if (message?.includes("Client version is too old")) {
        // Without a reported value, fall back to the bootstrap rather than
        // resending the one just refused.
        if (!learned) invalidateBuildNumber();
        return this.call(path, method, true);
      }
    }

    if (response.status !== 200) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new KRuokaError(
        `upstream returned ${response.status}: ${safeErrorMessage(response.body) ?? "no detail"}`,
        response.status,
        retryable,
      );
    }

    try {
      return JSON.parse(response.body);
    } catch {
      throw new KRuokaError("upstream returned unparseable JSON", response.status, true);
    }
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
    const body = await this.throttle(() => this.call(path));
    return normalizeSearchResponse(body, storeId);
  }

  /**
   * Where a product sits in one store: department, shelf and level.
   *
   * One request per product, made only for things someone put on a list —
   * never for search results. Null when the store has no location for it.
   */
  async getStoreLocation(
    ean: string,
    options: { storeId?: string } = {},
  ): Promise<StoreLocation | null> {
    const digits = ean.replace(/\D/g, "");
    if (digits.length < 8) return null;

    const params = new URLSearchParams({ storeId: options.storeId ?? this.storeId });
    try {
      const body = await this.throttle(() => this.call(`/v4/products/${digits}?${params}`, "GET"));
      return normalizeLocation(body);
    } catch (error) {
      // An unknown product is an answer ("no location"), not a failure.
      if (error instanceof KRuokaError && error.status === 404) return null;
      throw error;
    }
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
    return results.find((product) => product.ean === digits) ?? null;
  }
}

/** Reads the API's error text without letting a malformed body throw. */
function safeErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? null;
  } catch {
    return null;
  }
}

/** Shared instance for route handlers. */
export const kruoka = new KRuokaClient();
