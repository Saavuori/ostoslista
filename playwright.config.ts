import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end configuration.
 *
 * Scoped to `tests/e2e` so it never picks up the Vitest suite, and run on a
 * phone viewport by default — this app is used one-handed in a shop, so that
 * is the configuration worth guarding against regressions.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // A cold dev server compiles each route on first hit, which alone can exceed
  // the 30s default. CI runs a production build and never needs this.
  timeout: process.env.CI ? 30_000 : 90_000,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],

  webServer: {
    /**
     * Migrations run here rather than in a globalSetup hook, so they are
     * guaranteed to finish before the server opens the database. PGlite allows
     * one writer per directory, so the two must not overlap.
     *
     * `tsx` is invoked directly instead of `npm run db:migrate` because that
     * script loads `.env`, which would point the migration at the development
     * database rather than the one configured below.
     */
    command: process.env.CI
      ? `npx tsx src/lib/db/migrate.ts && npm run build && npx next start --port ${PORT}`
      : `npx tsx src/lib/db/migrate.ts && npx next dev --port ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? `pglite://.data/e2e-${process.env.E2E_RUN_ID ?? "local"}`,
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
