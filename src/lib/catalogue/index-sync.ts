import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { crawlProductIndex, type IndexEntry } from "@/lib/kruoka/sitemap";

/**
 * Populates the local product index from K-Ruoka's sitemaps.
 *
 * Run from `npm run catalogue:sync`. This is the only bulk fetch in the
 * system, it touches only sitemap files that robots.txt advertises, and it
 * downloads no prices — those are fetched per product, on demand.
 */
export async function syncProductIndex(options: { limit?: number } = {}): Promise<number> {
  const entries = await crawlProductIndex({
    ...(options.limit ? { limit: options.limit } : {}),
    onProgress: (done, total, count) => {
      console.log(`  sitemap ${done}/${total} — ${count} products`);
    },
  });

  await upsertEntries(entries);
  return entries.length;
}

/** Writes entries in batches; a single 125k-row statement is not a good idea. */
export async function upsertEntries(entries: IndexEntry[], batchSize = 500): Promise<void> {
  for (let start = 0; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize);

    await db
      .insert(products)
      .values(
        batch.map((entry) => ({
          ean: entry.ean,
          name: entry.name,
          slug: entry.slug,
          searchName: entry.name.toLowerCase(),
        })),
      )
      .onConflictDoUpdate({
        target: products.ean,
        set: {
          // A real name fetched from a product page beats the slug-derived one,
          // so only the routing fields are refreshed here.
          slug: sql`excluded.slug`,
          searchName: sql`coalesce(${products.searchName}, excluded.search_name)`,
        },
      });
  }
}
