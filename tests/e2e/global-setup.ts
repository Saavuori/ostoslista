/**
 * Warms the dev server before the suite starts.
 *
 * Next compiles each route on first request in development, which can take
 * longer than a whole test's timeout and makes whichever spec happens to run
 * first look flaky. Production builds in CI do not need this, but paying a few
 * seconds there is cheaper than a confusing red run.
 */
async function globalSetup(): Promise<void> {
  const base = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;

  // A 404 still compiles the route, which is the point.
  const routes = ["/", "/l/ZZZZZZZZZZZZZZZZZZZZZZ", "/api/health"];

  await Promise.all(
    routes.map((route) =>
      fetch(`${base}${route}`).catch(() => {
        // The suite will fail loudly on its own if the server is truly down.
      }),
    ),
  );
}

export default globalSetup;
