import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, storePrices } from "@/lib/db/schema";
import { type KRuokaClient, kruoka } from "@/lib/kruoka/client";
import { toCents } from "@/lib/kruoka/normalize";
import { fetchProductBySlug } from "@/lib/kruoka/productPage";
import type { Product as UpstreamProduct } from "@/lib/kruoka/types";
import { normalizeQuery } from "@/lib/text";

/**
 * The catalogue cache.
 *
 * This is the piece that keeps us a good citizen of an API we do not own.
 * The rules, in one place:
 *
 * - **Never bulk-crawl.** Prices are per store, so mirroring the assortment
 *   would mean ~1,000 stores x ~20,000 products every day. Instead we fetch
 *   lazily, only for what someone actually put on a list.
 * - **Split the cache by how fast things change.** Product identity (name,
 *   picture, category) is store-independent and nearly static, so it is cached
 *   indefinitely. Price is per store and volatile, so it gets a short TTL.
 * - **Serve stale rather than fail.** If upstream is down or rate-limiting, a
 *   slightly old price beats an error: the person is standing in a shop.
 */

/** How long a cached price stays fresh. */
const PRICE_TTL_MS = Number(process.env.PRICE_TTL_SECONDS ?? 21_600) * 1000;

/**
 * Short-lived memoisation of search queries.
 *
 * Autocomplete fires on nearly every keystroke; without this, typing "maito"
 * would be five upstream requests. Bounded so a long-running server cannot
 * grow it without limit.
 */
const SEARCH_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const searchCache = new Map<string, { at: number; products: UpstreamProduct[] }>();

function readSearchCache(key: string): UpstreamProduct[] | null {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  // Refresh recency so the eviction below is roughly LRU.
  searchCache.delete(key);
  searchCache.set(key, hit);
  return hit.products;
}

function writeSearchCache(key: string, value: UpstreamProduct[]): void {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
  searchCache.set(key, { at: Date.now(), products: value });
}

/** Exposed for tests; there is no other reason to clear it. */
export function clearSearchCache(): void {
  searchCache.clear();
}

/** What the API and the UI consume. Prices are cents; units are explicit. */
export interface CatalogueItem {
  ean: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  section: string | null;
  categoryOrder: number | null;
  soldBy: string;
  averageWeight: number | null;
  contentSize: number | null;
  contentUnit: string | null;
  originCountry: string | null;

  unit: string;
  normalCents: number;
  /** Cheapest price for a single unit — what a list total should use. */
  bestUnitCents: number;
  bestKind: string;
  bestAmount: number;
  bestBundleCents: number;
  comparisonCents: number | null;
  comparisonUnit: string | null;
  discountPercent: number | null;
  discountType: string | null;
  validUntil: string | null;
  /** True when the item is weighed at the till, so the price is an estimate. */
  isApproximate: boolean;
}

function toCatalogueItem(product: UpstreamProduct): CatalogueItem {
  const { normal, best } = product.pricing;
  return {
    ean: product.ean,
    name: product.name,
    brand: product.brand,
    imageUrl: product.imageUrl,
    categoryName: product.categoryName,
    section: product.section,
    categoryOrder: product.categoryOrder,
    soldBy: product.soldBy,
    averageWeight: product.averageWeight,
    contentSize: product.contentSize,
    contentUnit: product.contentUnit,
    originCountry: product.originCountry,

    unit: normal.unit,
    normalCents: toCents(normal.price),
    bestUnitCents: toCents(best.effectiveUnitPrice),
    bestKind: best.kind,
    bestAmount: best.amount,
    bestBundleCents: toCents(best.price),
    comparisonCents: best.comparisonPrice === null ? null : toCents(best.comparisonPrice),
    comparisonUnit: best.comparisonUnit,
    discountPercent: best.discountPercent,
    discountType: best.discountType,
    validUntil: best.validUntil,
    isApproximate: normal.isApproximate,
  };
}

/** Writes upstream results into both halves of the cache. */
async function persist(items: UpstreamProduct[], storeId: string): Promise<void> {
  if (items.length === 0) return;

  const now = new Date();

  // Local, store-specific items share an EAN namespace with national ones but
  // are not the same product, so they are not cached as shared identity.
  const shared = items.filter((item) => !item.isLocal);

  if (shared.length > 0) {
    await db
      .insert(products)
      .values(
        shared.map((item) => ({
          ean: item.ean,
          name: item.name,
          nameSv: item.nameSv,
          brand: item.brand,
          categoryPath: item.categoryPath,
          categoryName: item.categoryName,
          section: item.section,
          categoryOrder: item.categoryOrder,
          imageUrl: item.imageUrl,
          originCountry: item.originCountry,
          contentSize: item.contentSize === null ? null : String(item.contentSize),
          contentUnit: item.contentUnit,
          soldBy: item.soldBy,
          averageWeight: item.averageWeight === null ? null : String(item.averageWeight),
          popularity: String(item.popularity),
          fetchedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: products.ean,
        set: {
          name: sql`excluded.name`,
          brand: sql`excluded.brand`,
          categoryPath: sql`excluded.category_path`,
          categoryName: sql`excluded.category_name`,
          section: sql`excluded.section`,
          imageUrl: sql`excluded.image_url`,
          popularity: sql`excluded.popularity`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  await db
    .insert(storePrices)
    .values(
      items.map((item) => {
        const row = toCatalogueItem(item);
        return {
          ean: item.ean,
          storeId,
          normalCents: row.normalCents,
          unit: row.unit,
          bestUnitCents: row.bestUnitCents,
          bestKind: row.bestKind,
          bestAmount: row.bestAmount,
          bestBundleCents: row.bestBundleCents,
          comparisonCents: row.comparisonCents,
          comparisonUnit: row.comparisonUnit,
          discountPercent: row.discountPercent,
          discountType: row.discountType,
          validUntil: row.validUntil ? new Date(row.validUntil) : null,
          isAvailable: item.isAvailable,
          fetchedAt: now,
        };
      }),
    )
    .onConflictDoUpdate({
      target: [storePrices.ean, storePrices.storeId],
      set: {
        normalCents: sql`excluded.normal_cents`,
        unit: sql`excluded.unit`,
        bestUnitCents: sql`excluded.best_unit_cents`,
        bestKind: sql`excluded.best_kind`,
        bestAmount: sql`excluded.best_amount`,
        bestBundleCents: sql`excluded.best_bundle_cents`,
        comparisonCents: sql`excluded.comparison_cents`,
        comparisonUnit: sql`excluded.comparison_unit`,
        discountPercent: sql`excluded.discount_percent`,
        discountType: sql`excluded.discount_type`,
        validUntil: sql`excluded.valid_until`,
        isAvailable: sql`excluded.is_available`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
}

export interface SearchOptions {
  storeId: string;
  limit?: number;
  client?: KRuokaClient;
  signal?: AbortSignal;
}

/**
 * Searches the local product index.
 *
 * No network call happens here. The index is built from K-Ruoka's sitemaps
 * (see `lib/kruoka/sitemap.ts`), so autocomplete is a database query rather
 * than a request to someone else's API on every keystroke.
 *
 * Prices are attached from the cache when we already have them, and fetched
 * lazily from the product page otherwise — only for the handful of rows
 * actually shown.
 */
export async function searchCatalogue(
  query: string,
  options: SearchOptions,
): Promise<CatalogueItem[]> {
  // Folded so "leipa" finds "leipä"; `searchName` is stored folded to match.
  const trimmed = normalizeQuery(query);
  if (trimmed.length < 2) return [];

  const limit = options.limit ?? 24;
  const key = `${options.storeId}:${trimmed}:${limit}`;
  const cached = readSearchCache(key);
  if (cached) return cached.map(toCatalogueItem);

  const pattern = `%${trimmed.replace(/[%_]/g, "")}%`;
  const prefix = `${trimmed.replace(/[%_]/g, "")}%`;

  const matches = await db
    .select()
    .from(products)
    .where(or(like(products.searchName, pattern), like(products.name, pattern)))
    // A prefix match is almost always what was meant, so rank those first.
    .orderBy(sql`case when ${products.searchName} like ${prefix} then 0 else 1 end`, products.name)
    .limit(limit);

  if (matches.length === 0) return [];

  const eans = matches.map((row) => row.ean);
  const prices = await db
    .select()
    .from(storePrices)
    .where(and(inArray(storePrices.ean, eans), eq(storePrices.storeId, options.storeId)));

  const priceByEan = new Map(prices.map((row) => [row.ean, row]));
  const now = Date.now();

  const items: CatalogueItem[] = [];

  for (const row of matches) {
    const price = priceByEan.get(row.ean);
    const fresh = price && now - price.fetchedAt.getTime() <= PRICE_TTL_MS;

    if (price && fresh) {
      items.push(fromCachedRow(row, price));
      continue;
    }

    // Not cached, or stale: fetch this one product's page.
    if (row.slug) {
      try {
        const product = await fetchProductBySlug(row.slug, {
          storeId: options.storeId,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (product) {
          await persist([product], options.storeId).catch(() => undefined);
          items.push(toCatalogueItem(product));
          continue;
        }
      } catch {
        // Fall through: a stale price is better than dropping the result.
      }
    }

    if (price) items.push(fromCachedRow(row, price));
  }

  return items;
}

/** Builds a result from the two cache tables, with no network access. */
function fromCachedRow(
  product: typeof products.$inferSelect,
  price: typeof storePrices.$inferSelect,
): CatalogueItem {
  return {
    ean: product.ean,
    name: product.name,
    brand: product.brand,
    imageUrl: product.imageUrl ?? `https://public.keskofiles.com/f/k-ruoka/product/${product.ean}`,
    categoryName: product.categoryName,
    section: product.section,
    categoryOrder: product.categoryOrder,
    soldBy: product.soldBy,
    averageWeight: product.averageWeight === null ? null : Number(product.averageWeight),
    contentSize: product.contentSize === null ? null : Number(product.contentSize),
    contentUnit: product.contentUnit,
    originCountry: product.originCountry,

    unit: price.unit,
    normalCents: price.normalCents,
    bestUnitCents: price.bestUnitCents,
    bestKind: price.bestKind,
    bestAmount: price.bestAmount,
    bestBundleCents: price.bestBundleCents,
    comparisonCents: price.comparisonCents,
    comparisonUnit: price.comparisonUnit,
    discountPercent: price.discountPercent,
    discountType: price.discountType,
    validUntil: price.validUntil ? price.validUntil.toISOString() : null,
    isApproximate: false,
  };
}

/**
 * Reads prices for products already on a list.
 *
 * Fresh rows are served from the database. Stale ones are refreshed from
 * upstream, and if that fails the stale row is returned anyway — an old price
 * is far more useful than an error to someone standing in an aisle.
 */
export async function getPrices(
  eans: string[],
  storeId: string,
  client: KRuokaClient = kruoka,
): Promise<Map<string, { bestUnitCents: number; normalCents: number; stale: boolean }>> {
  const out = new Map<string, { bestUnitCents: number; normalCents: number; stale: boolean }>();
  if (eans.length === 0) return out;

  const rows = await db
    .select()
    .from(storePrices)
    .where(and(inArray(storePrices.ean, eans), eq(storePrices.storeId, storeId)));

  const now = Date.now();
  const stale: string[] = [];

  for (const row of rows) {
    const isStale = now - row.fetchedAt.getTime() > PRICE_TTL_MS;
    out.set(row.ean, {
      bestUnitCents: row.bestUnitCents,
      normalCents: row.normalCents,
      stale: isStale,
    });
    if (isStale) stale.push(row.ean);
  }

  const missing = eans.filter((ean) => !out.has(ean));
  const toFetch = [...new Set([...stale, ...missing])];

  const slugs = new Map(
    (
      await db
        .select({ ean: products.ean, slug: products.slug })
        .from(products)
        .where(inArray(products.ean, toFetch))
    ).map((row) => [row.ean, row.slug]),
  );

  for (const ean of toFetch) {
    try {
      const slug = slugs.get(ean);
      const product = slug
        ? await fetchProductBySlug(slug, { storeId })
        : await client.lookupByEan(ean, { storeId });
      if (!product) continue;
      const item = toCatalogueItem(product);
      out.set(ean, {
        bestUnitCents: item.bestUnitCents,
        normalCents: item.normalCents,
        stale: false,
      });
      await persist([product], storeId);
    } catch {
      // Keep whatever stale value we already had; drop nothing.
    }
  }

  return out;
}
