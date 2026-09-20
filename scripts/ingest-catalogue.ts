import { chromium } from "@playwright/test";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, storePrices } from "@/lib/db/schema";
import {
  INGEST_CATEGORIES,
  imageUrlForEan,
  parseCategoryCards,
  type RawCard,
  type ScrapedProduct,
} from "@/lib/kruoka/categoryPage";
import { foldFinnish } from "@/lib/text";

/**
 * Fills the catalogue with real K-Ruoka products and prices.
 *
 *   npm run catalogue:ingest            all categories
 *   npm run catalogue:ingest -- --store N106
 *
 * This drives a real browser because nothing else can read the site: both the
 * internal API and plain server-side fetches are refused at the TLS
 * fingerprint level. It reads only public category listings — the pages a
 * shopper browses — and never the `?haku=` search URLs that robots.txt
 * disallows.
 *
 * It is deliberately slow and sequential. This runs on a schedule, not on a
 * request, and there is no reason to hammer someone else's site.
 */

const BASE = "https://www.k-ruoka.fi/kauppa/tuotehaku";
const PAUSE_MS = 1500;

/** Runs in the page: collects each product card's link, name and text. */
function collectCards(): RawCard[] {
  const cards: RawCard[] = [];
  for (const anchor of document.querySelectorAll('a[href*="/kauppa/tuote/"]')) {
    const href = anchor.getAttribute("href") ?? "";
    const container = anchor.parentElement?.parentElement;
    cards.push({
      href,
      name: (anchor as HTMLElement).innerText ?? "",
      cardText: (container as HTMLElement | null)?.innerText ?? "",
    });
  }
  return cards;
}

async function persist(items: ScrapedProduct[], storeId: string): Promise<void> {
  if (items.length === 0) return;
  const now = new Date();

  await db
    .insert(products)
    .values(
      items.map((item) => ({
        ean: item.ean,
        name: item.name,
        slug: item.slug,
        searchName: foldFinnish(item.name),
        categoryPath: item.categorySlug,
        categoryName: item.categoryName,
        categoryOrder: item.categoryOrder,
        imageUrl: imageUrlForEan(item.ean),
        soldBy: item.unit === "kpl" ? "piece" : "mass",
        fetchedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: products.ean,
      set: {
        name: sql`excluded.name`,
        slug: sql`excluded.slug`,
        searchName: sql`excluded.search_name`,
        categoryPath: sql`excluded.category_path`,
        categoryName: sql`excluded.category_name`,
        categoryOrder: sql`excluded.category_order`,
        imageUrl: sql`excluded.image_url`,
        soldBy: sql`excluded.sold_by`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });

  await db
    .insert(storePrices)
    .values(
      items.map((item) => ({
        ean: item.ean,
        storeId,
        normalCents: item.priceCents,
        unit: item.unit,
        bestUnitCents: item.priceCents,
        bestKind: "normal",
        bestAmount: 1,
        bestBundleCents: item.priceCents,
        isAvailable: true,
        fetchedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [storePrices.ean, storePrices.storeId],
      set: {
        normalCents: sql`excluded.normal_cents`,
        unit: sql`excluded.unit`,
        bestUnitCents: sql`excluded.best_unit_cents`,
        bestBundleCents: sql`excluded.best_bundle_cents`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
}

async function main(): Promise<void> {
  const storeArg = process.argv.indexOf("--store");
  const storeId = storeArg > -1 ? (process.argv[storeArg + 1] ?? "N106") : "N106";

  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: "fi-FI" });
  const page = await context.newPage();

  let total = 0;

  try {
    for (const category of INGEST_CATEGORIES) {
      process.stdout.write(`  ${category} ... `);

      try {
        await page.goto(`${BASE}/${category}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
        // The listing renders client-side; wait for the first card rather than
        // a fixed delay.
        await page.waitForSelector('a[href*="/kauppa/tuote/"]', { timeout: 20_000 });

        const cards = await page.evaluate(collectCards);
        const heading = await page.title();
        const categoryName = heading.split("|")[0]?.trim() || category;

        const items = parseCategoryCards(cards, category, categoryName);
        await persist(items, storeId);

        total += items.length;
        console.log(`${items.length} products`);
      } catch (error) {
        // One unavailable category should not abandon the whole run.
        console.log(`skipped (${error instanceof Error ? error.message.split("\n")[0] : error})`);
      }

      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
  } finally {
    await browser.close();
  }

  console.log(`\nIngested ${total} products for store ${storeId}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("ingest failed:", error);
  process.exit(1);
});
