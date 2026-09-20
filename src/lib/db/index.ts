import { createRequire } from "node:module";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Database connection.
 *
 * Two drivers, chosen by the URL scheme:
 *
 *   postgres://...   a real server. What production uses.
 *   pglite://<dir>   Postgres compiled to WASM, running in-process.
 *
 * The PGlite option exists so `npm run dev` works with no Docker and no
 * installed Postgres — the barrier to a contributor's first run should be
 * `npm install`, not a container runtime. It is the same engine, so behaviour
 * does not drift between a local run and the server.
 *
 * Next.js reloads modules in development, so the client is cached on
 * globalThis; without that, every hot reload opens another pool and the
 * database runs out of connections within minutes of editing.
 */

type AnyDb = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  ostoslistaDb?: AnyDb;
  ostoslistaClose?: () => Promise<void>;
};

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

function createDb(): AnyDb {
  const url = connectionString();

  if (url.startsWith("pglite://")) {
    // Required rather than imported so the production bundle never pulls in
    // the WASM build, which is a devDependency and unused on the server.
    const require = createRequire(import.meta.url);
    const { PGlite } = require("@electric-sql/pglite");
    const { drizzle } = require("drizzle-orm/pglite");

    const dir = url.slice("pglite://".length) || ".data/dev";
    // PGlite will not create intermediate directories, so a fresh clone would
    // otherwise fail on first run with an opaque ENOENT.
    require("node:fs").mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    globalForDb.ostoslistaClose = () => client.close();
    return drizzle(client, { schema });
  }

  const require = createRequire(import.meta.url);
  const postgres = require("postgres");
  const { drizzle } = require("drizzle-orm/postgres-js");

  const client = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  globalForDb.ostoslistaClose = () => client.end();
  return drizzle(client, { schema });
}

export const db: AnyDb = globalForDb.ostoslistaDb ?? createDb();

if (process.env.NODE_ENV !== "production") globalForDb.ostoslistaDb = db;

export type Db = typeof db;
export { schema };
