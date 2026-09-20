import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

/**
 * A real Postgres for tests, running in-process.
 *
 * PGlite is Postgres compiled to WASM, so these are not mocks: constraints,
 * transactions, `numeric` precision and partial indexes all behave exactly as
 * they will in production. It needs no Docker, which keeps the suite hermetic
 * and fast in CI.
 *
 * Migrations are applied from the same SQL that ships in the image, so a broken
 * migration fails here rather than on the server.
 */
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    // drizzle-kit separates statements with this marker; PGlite's exec handles
    // multiple statements but not the marker itself.
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  return { db, close: () => client.close() };
}
