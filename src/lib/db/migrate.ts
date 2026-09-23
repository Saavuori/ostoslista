import { createRequire } from "node:module";

/**
 * Applies pending migrations, then exits.
 *
 * Runs as a deploy step, in CI, and locally — never on container start (see
 * AGENTS.md). Supports both drivers so a developer running on PGlite migrates
 * exactly the same SQL the server does.
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

    // Some open failures — notably a directory another process already holds —
    // abort inside the WASM runtime and cannot be caught at all; those surface
    // as a raw `Aborted()` stack. If you see one, stop `npm run dev` (PGlite
    // allows a single writer per directory), and if it persists the local
    // database is disposable: delete `.data/dev`.
    let client: { waitReady: Promise<void>; close: () => Promise<void> };
    try {
      client = new PGlite(dir);
      await client.waitReady;
    } catch (error) {
      // The catchable open failures, which are almost always the dev server
      // holding the directory, so say what is actually wrong.
      throw new Error(
        `Could not open the PGlite database at ${dir}. It allows one process at ` +
          "a time — stop `npm run dev` and run this again. " +
          `Underlying error: ${String(error)}`,
      );
    }

    // A failing migration is reported as itself, not as a locked directory.
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
