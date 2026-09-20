import { createRequire } from "node:module";

/**
 * Applies pending migrations, then exits.
 *
 * Runs at container start, in CI, and locally. Supports both drivers so a
 * developer running on PGlite migrates exactly the same SQL the server does.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const require = createRequire(import.meta.url);
  const folder = "./drizzle";

  if (url.startsWith("pglite://")) {
    const { PGlite } = require("@electric-sql/pglite");
    const { drizzle } = require("drizzle-orm/pglite");
    const { migrate } = require("drizzle-orm/pglite/migrator");

    const client = new PGlite(url.slice("pglite://".length) || ".data/dev");
    try {
      await migrate(drizzle(client), { migrationsFolder: folder });
      console.log("migrations applied (pglite)");
    } finally {
      await client.close();
    }
    return;
  }

  const postgres = require("postgres");
  const { drizzle } = require("drizzle-orm/postgres-js");
  const { migrate } = require("drizzle-orm/postgres-js/migrator");

  // A single connection rather than the app pool, so it can close cleanly.
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
    console.log("migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("migration failed:", error);
  process.exit(1);
});
