/**
 * Service worker.
 *
 * Its only job is making the app open at all with no signal. The list data
 * itself lives in IndexedDB and is handled by the offline queue — this is the
 * shell, not the state.
 *
 * Strategies, chosen per resource:
 *
 *   build assets   cache-first; they are content-hashed and immutable
 *   pages          network-first, falling back to cache, so a reachable
 *                  server always wins and a dead one still renders
 *   API calls      never cached; a stale list is worse than a visibly
 *                  missing one, and writes must reach the outbox instead
 */

const VERSION = "v1";
const SHELL_CACHE = `ostoslista-shell-${VERSION}`;
const PAGE_CACHE = `ostoslista-pages-${VERSION}`;

const SHELL = ["/", "/manifest.webmanifest"];

/**
 * Stores a copy of a successful response.
 *
 * Only successes: a 404 for a chunk mid-deploy or a 500 page would otherwise
 * be kept — static assets are served cache-first, so forever — and replayed
 * in place of the real thing.
 */
function remember(cacheName, request, response) {
  if (!response.ok) return;
  const copy = response.clone();
  void caches.open(cacheName).then((cache) => cache.put(request, copy));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      // A missing shell file must not wedge the install forever.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ostoslista-") && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve a cached list or a cached search result.
  if (url.pathname.startsWith("/api/")) return;

  // Content-hashed build output: safe to serve from cache indefinitely.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            remember(SHELL_CACHE, request, response);
            return response;
          }),
      ),
    );
    return;
  }

  // Pages: prefer the network so a shared list is never shown stale, but fall
  // back to whatever was last seen rather than a browser error page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          remember(PAGE_CACHE, request, response);
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match("/");
          if (shell) return shell;
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        }),
    );
  }
});
