import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, storePrices } from "@/lib/db/schema";
import { aisleOrderForSlug, departmentNameForSlug } from "@/lib/kruoka/aisles";
import { imageUrlForEan } from "@/lib/kruoka/categoryPage";
import { foldFinnish } from "@/lib/text";

/**
 * Loads a catalogue snapshot from `.data/seed/`.
 *
 * One file per top-level category, named after its slug, with pipe-separated
 * lines:  ean|name|priceCents|unit
 *
 * This exists because the site cannot be read automatically — Cloudflare
 * answers scripted clients and headless browsers with a challenge — so a
 * snapshot is captured by hand and replayed here. The directory is gitignored:
 * the data is Kesko's and this repository is public.
 */

async function main(): Promise<void> {
  const dir = join(process.cwd(), ".data", "seed");
  const storeArg = process.argv.indexOf("--store");
  const storeId = storeArg > -1 ? (process.argv[storeArg + 1] ?? "N106") : "N106";

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  } catch {
    console.error(`No snapshot found at ${dir}`);
    process.exit(1);
  }

  const now = new Date();
  let total = 0;

  for (const file of files) {
    const slug = file.replace(/\.txt$/, "");
    // The shared table, so seeded and live items land in the same aisle group.
    const categoryName = departmentNameForSlug(slug) ?? slug;
    const categoryOrder = aisleOrderForSlug(slug);

    const rows = readFileSync(join(dir, file), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("|"))
      .filter((parts) => parts.length >= 4);

    if (rows.length === 0) continue;

    await db
      .insert(products)
      .values(
        rows.map(([ean, name]) => ({
          ean: ean!,
          name: name!,
          searchName: foldFinnish(name!),
          slug: null,
          categoryPath: slug,
          categoryName,
          categoryOrder,
          imageUrl: imageUrlForEan(ean!),
          soldBy: "piece",
          fetchedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: products.ean,
        set: {
          name: sql`excluded.name`,
          searchName: sql`excluded.search_name`,
          categoryName: sql`excluded.category_name`,
          categoryOrder: sql`excluded.category_order`,
          imageUrl: sql`excluded.image_url`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });

    await db
      .insert(storePrices)
      .values(
        rows.map(([ean, , cents, unit]) => ({
          ean: ean!,
          storeId,
          normalCents: Number.parseInt(cents!, 10),
          unit: unit!,
          bestUnitCents: Number.parseInt(cents!, 10),
          bestKind: "normal",
          bestAmount: 1,
          bestBundleCents: Number.parseInt(cents!, 10),
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

    console.log(`  ${categoryName}: ${rows.length}`);
    total += rows.length;
  }

  console.log(`\nImported ${total} products for store ${storeId}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("seed import failed:", error);
  process.exit(1);
});
