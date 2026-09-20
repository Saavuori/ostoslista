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

    const dir = url.slice("pglite://".length) || ".data/dev";
    require("node:fs").mkdirSync(dir, { recursive: true });

    // Constructed inside the try so a catchable open failure gets a useful
    // message. Note that some failures — notably opening a directory another
    // process already holds — abort inside the WASM runtime and cannot be
    // caught at all; those surface as a raw `Aborted()` stack. If you see one,
    // stop `npm run dev` (PGlite allows a single writer per directory), and if
    // it persists the local database is disposable: delete `.data/dev`.
    let client: { close: () => Promise<void> } | undefined;
    try {
      client = new PGlite(dir);
      await migrate(drizzle(client), { migrationsFolder: folder });
      console.log("migrations applied (pglite)");
    } catch (error) {
      // PGlite allows a single writer per directory. A running dev server holds
      // it, and the underlying failure is an opaque WASM abort, so say what is
      // actually wrong.
      throw new Error(
        `Could not open the PGlite database at ${dir}. It allows one process at ` +
          "a time — stop `npm run dev` and run this again. " +
          `Underlying error: ${String(error)}`,
      );
    } finally {
      await client?.close();
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
