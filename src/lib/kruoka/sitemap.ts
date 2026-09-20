/**
 * Builds a local product index from K-Ruoka's sitemaps.
 *
 * This is why search does not touch the network at request time. A product URL
 * slug carries both the name and the EAN:
 *
 *   /kauppa/tuote/pirkka-kirjolohikiusaus-300g-6410402025602
 *                 ^--------- name ---------^ ^--- ean ----^
 *
 * So one pass over the sitemaps — which robots.txt advertises specifically for
 * this purpose — yields a searchable catalogue with no per-keystroke upstream
 * calls, and prices are then fetched only for products someone actually adds.
 *
 * `robots.txt` disallows the `?haku=` search URLs. We never touch those.
 */

const BASE = "https://www.k-ruoka.fi";
const SITEMAP_INDEX = `${BASE}/sitemap-https.xml`;

const HEADERS: HeadersInit = {
  Accept: "application/xml,text/xml",
  "Accept-Language": "fi-FI,fi;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

const LOC = /<loc>([^<]+)<\/loc>/g;

export interface IndexEntry {
  ean: string;
  slug: string;
  /** Human-readable name recovered from the slug. */
  name: string;
}

/** Pulls `<loc>` values out of a sitemap document. */
export function extractLocations(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(LOC)) {
    const value = match[1]?.trim();
    if (value) out.push(value);
  }
  return out;
}

/**
 * Recovers an EAN and a readable name from a product URL.
 *
 * The EAN is the trailing digit run. Store-local products carry a `-nNNN`
 * store suffix after it, which is dropped: their prices vary per shop and we
 * only have one store's page.
 */
export function parseProductUrl(url: string): IndexEntry | null {
  const match = url.match(/\/kauppa\/tuote\/([^/?#]+)/);
  const slug = match?.[1];
  if (!slug) return null;

  const withoutStore = slug.replace(/-n\d+$/i, "");
  const ean = withoutStore.match(/(\d{8,14})$/)?.[1];
  if (!ean) return null;

  const name = withoutStore
    .slice(0, withoutStore.length - ean.length)
    .replace(/-+$/, "")
    .replace(/-/g, " ")
    .trim();

  if (!name) return null;

  return { ean, slug, name };
}

async function get(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`sitemap ${url} returned ${response.status}`);
  return response.text();
}

export interface CrawlOptions {
  fetchImpl?: typeof fetch;
  /** Called after each sitemap file, for progress reporting. */
  onProgress?: (done: number, total: number, entries: number) => void;
  /** Stop after this many entries. Useful for a quick partial index. */
  limit?: number;
}

/**
 * Fetches every product sitemap and returns the index entries.
 *
 * Deliberately sequential: this is a handful of large files from someone
 * else's CDN, and there is no reason to open five connections at once.
 */
export async function crawlProductIndex(options: CrawlOptions = {}): Promise<IndexEntry[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const index = await get(SITEMAP_INDEX, fetchImpl);
  const productSitemaps = extractLocations(index).filter((url) =>
    url.includes("sitemap-https-products-"),
  );

  const seen = new Map<string, IndexEntry>();

  for (const [position, url] of productSitemaps.entries()) {
    const xml = await get(url, fetchImpl);

    for (const location of extractLocations(xml)) {
      const entry = parseProductUrl(location);
      // Keyed by EAN: the same product can appear under several slugs.
      if (entry && !seen.has(entry.ean)) seen.set(entry.ean, entry);
      if (options.limit && seen.size >= options.limit) break;
    }

    options.onProgress?.(position + 1, productSitemaps.length, seen.size);
    if (options.limit && seen.size >= options.limit) break;
  }

  return [...seen.values()];
}
