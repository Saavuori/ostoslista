import { syncProductIndex } from "@/lib/catalogue/index-sync";

/**
 * Builds the local product index.
 *
 * Usage:  npm run catalogue:sync  [-- --limit 5000]
 *
 * Takes a few minutes for the full catalogue (~125k products, ~20MB of
 * sitemaps). Pass a limit for a quick partial index while developing.
 */
async function main(): Promise<void> {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : undefined;

  console.log(limit ? `Indexing up to ${limit} products...` : "Indexing the full catalogue...");
  const count = await syncProductIndex(limit ? { limit } : {});
  console.log(`Indexed ${count} products.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("catalogue sync failed:", error);
  process.exit(1);
});
