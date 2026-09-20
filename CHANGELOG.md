# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Work is organised in phases. Each phase ships with its own tests and the suite
must be green before the next phase begins.

## [Unreleased]

### Phase 5 — Aisle grouping, history, polish
- Not started.

## [0.5.0] — 2026-09-20

### Phase 4 — Offline-first

The phase the whole app is shaped around: supermarkets are concrete boxes, so
a change made with no signal is the normal case rather than an error to report.

#### Added
- On-device storage (Dexie/IndexedDB) holding the list and an **outbox** of
  changes the server has not confirmed.
- The outbox stores *intent*, not a replay log. Ticking an item five times
  offline sends one change; ticking it and then deleting it sends only the
  delete; deleting something that was also created offline sends nothing at
  all, because the server never heard of it.
- The sync endpoint now accepts rows **created** offline, not just edits. An
  entry carrying content is inserted; a bare edit for an unknown row is still
  dropped, so a queued edit cannot resurrect a deleted item.
- Automatic draining on reconnect, on tab focus, and otherwise on exponential
  backoff. Changes that repeatedly fail are abandoned loudly rather than
  retried forever in silence.
- The header reports unsent changes ("2 odottaa") rather than an error — the
  work is safe, and saying "failed" would be untrue.
- Service worker for the app shell: cache-first for content-hashed build
  assets, network-first for pages, and **never** for API calls, since a stale
  list is worse than a visibly missing one.
- Two end-to-end tests that genuinely go offline mid-session, edit, come back,
  and assert the result survives a full reload from the server.

#### Fixed
- Offline-created rows carried `sortKey: Number.MAX_SAFE_INTEGER`, which
  overflows the `numeric(20, 6)` column. The insert failed, the whole batch
  failed, and it retried forever. Sort keys are now bounded in the schema so
  an out-of-range value is a clean 400, and optimistic rows use a real value.
- `useOfflineSync` rebuilt its effect on every render, which cleared the retry
  timer before it could fire, so a queued change could sit unsent indefinitely.
- Overlapping flushes could send the same rows twice.

## [0.4.0] — 2026-09-20

### Phase 3 — Realtime sync

#### Added
- Server-Sent Events stream per list (`/api/lists/[token]/events`). SSE rather
  than WebSockets: a list only needs server-to-client fanout, and SSE survives
  reverse proxies and mobile radios far better — it also reconnects on its own
  with `Last-Event-ID`, which is most of what an offline-capable client needs.
- In-process event bus, deliberately single-instance for a single-container
  deploy. The interface is the seam for Postgres `LISTEN`/`NOTIFY` if this ever
  runs with more than one replica.
- Missed events are replayed on reconnect from a bounded buffer. When the gap
  is too large to bridge, the server says so and the client refetches rather
  than silently showing an incomplete list.
- Events carry their origin, so a device ignores the echo of its own writes and
  the UI does not flicker.
- Presence: the header shows how many people are looking at the list, and says
  so when the connection has dropped. Both appear only when they tell you
  something you would not otherwise know.
- Heartbeat frames every 20s to stop proxies closing idle streams.
- 14 bus tests and an end-to-end test that asserts two browser contexts stay in
  sync **with no reload anywhere in it** — a reload would hide a broken stream.

#### Fixed
- Optimistic and confirmed rows share an id, which rendered duplicate React
  keys during the transition.
- Each end-to-end run now gets its own throwaway database. PGlite allows one
  writer per directory, so a server lingering from a previous run made the next
  one fail to start.

## [0.3.0] — 2026-09-20

### Phase 2 — Product search, prices and totals

#### Added
- Two-tier catalogue cache: product identity (`products`) is shared across
  stores and long-lived; price (`store_prices`) is per store with a short TTL.
  Nothing is bulk-crawled — rows are fetched lazily for products people
  actually put on a list.
- Search results are memoised for 10 minutes in a bounded LRU, so autocomplete
  does not make one upstream request per keystroke.
- `/api/products/search` proxy, required because the browser cannot call the
  upstream directly (no CORS headers).
- `AddItemBar`: debounced autocomplete with product images, per-unit prices,
  comparison prices and savings badges. Free text remains first-class —
  pressing enter always adds what you typed.
- Adding a product already on the list now says so instead of appearing to do
  nothing.
- 16 cache tests against a real Postgres and a counting upstream stub, which
  assert how many times an API we do not own gets called.

#### Known limitation
- **Live product data is currently unavailable.** Cloudflare returns a
  consistent `403` to server-side requests, while a real browser session
  succeeds. No attempt is made to circumvent this.

  The app runs degraded and this is tested, not accidental: search returns
  empty with a `degraded` flag, the UI explains it, cached prices are served
  stale rather than failing, and item name/price snapshots mean existing lists
  still display and total correctly. Everything except autocomplete works.

#### Fixed
- Migrating while the dev server is running produced an opaque WASM abort.
  PGlite allows one writer per directory, and the error now says that.

## [0.2.0] — 2026-09-20

### Phase 1 — Lists, items and share links

#### Added
- Postgres schema (Drizzle) for lists, items, share tokens and members, with
  the initial migration. Quantities are `numeric` with a unit, ids are
  client-generated UUIDv7, and items are soft-deleted.
- **Share links as the only credential.** Holding the link is the permission;
  no account, no sign-up. Tokens are 22 characters of a Crockford-style
  alphabet (~110 bits), revocable and optionally expiring. A revoked or expired
  token is indistinguishable from a wrong one, so the response never confirms
  that a list exists behind a guessed link.
- Last-write-wins reconciliation (`src/lib/sync/lww.ts`), resolved per field:
  - tombstones beat later edits, so a deleted item cannot be resurrected;
  - timestamp ties break deterministically, so two devices cannot flip a value
    back and forth forever;
  - when both people check the same item, the first one gets the credit;
  - client clocks are clamped to server time, so a fast clock cannot win every
    future conflict.
- REST API: create list, read list, add / update / delete item, and a batch
  `sync` endpoint that returns the reconciled list.
- Adding a product already on the list bumps its quantity instead of creating
  a second line, and un-checks it.
- List UI: sticky header with progress, item rows with the strike-through
  animation, a "Korissa" section for checked items, a running total showing
  what is left versus the full basket, and native share-sheet sharing.
- 63 further tests, including 30 integration tests against a real Postgres
  running in-process via PGlite.

#### Changed
- Local development needs no Docker: `DATABASE_URL=pglite://.data/dev` runs
  Postgres as WASM in-process. `docker compose` remains for a real server.

#### Fixed
- Long product names pushed the price out of the row; the flex row was missing
  `min-w-0`. Prices now truncate the name and hold a fixed right-aligned
  column, which is the point of setting figures in mono.

## [0.1.0] — 2026-09-20

### Phase 0 — Foundations and the K-Ruoka adapter

The riskiest part of the project first: the app depends on an undocumented
third-party API, so that integration is proven before anything is built on it.

#### Added
- Next.js 16 / React 19 / TypeScript scaffold with `strict` and
  `noUncheckedIndexedAccess`.
- **K-Ruoka adapter** (`src/lib/kruoka/`) — a server-side client plus a
  normalizer that maps the upstream payload onto our own domain model.
  - Handles all three pricing variants: `normal`, per-unit `discount`, and
    `batch` multi-buy.
  - Handles all three ways goods are sold: `piece`, `mass`, `approximatePiece`.
  - `lineTotal()` charges bundle prices only for complete bundles, so buying
    one of a "2 for 4,50" offer costs the normal single price.
  - Request throttling and browser-shaped headers, because the upstream answers
    `409` to bare requests and sits behind Cloudflare.
- 22 unit tests against a **real captured API payload** (`tests/fixtures/`),
  covering every pricing and quantity shape.
- Design system — "Enamel & Scale" — as Tailwind v4 CSS-first tokens:
  warm enamel surfaces, ink text, one signal-orange accent, green reserved for
  savings, and Martian Mono for all figures so price columns align.
- Multi-stage `Dockerfile` (non-root, `output: "standalone"`, healthcheck) and
  a `compose.yaml` with Postgres 18.
- CI: lint, typecheck, unit tests with coverage, production build, and an
  end-to-end job with a Postgres service.
- Container workflow publishing multi-arch images to GHCR with build
  provenance and a post-push smoke test.
- `AGENTS.md` documenting the stack, conventions and the upstream integration's
  traps.

#### Notes
- The K-Ruoka endpoint sends no CORS headers, so it can only be called
  server-side. Confirmed by testing from a foreign origin.
- Catalogue data is never committed: this repository is public and the data is
  Kesko's. `.gitignore` blocks `data/catalogue/` and `.cache/`.

[Unreleased]: https://github.com/Saavuori/ostoslista/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Saavuori/ostoslista/releases/tag/v0.1.0
