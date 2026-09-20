import { rm } from "node:fs/promises";

/**
 * Removes the throwaway database this run created.
 *
 * Only deletes a directory this suite generated — never a real `DATABASE_URL`
 * a developer or CI pointed at a live database.
 */
async function globalTeardown(): Promise<void> {
  const url = process.env.E2E_RUN_DB ?? "";
  if (!url.startsWith("pglite://.data/e2e-")) return;

  const dir = url.slice("pglite://".length);
  await rm(dir, { recursive: true, force: true }).catch(() => {
    // A lingering file handle on Windows is not worth failing the run over.
  });
}

export default globalTeardown;
