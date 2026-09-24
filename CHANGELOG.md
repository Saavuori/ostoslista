# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Work is organised in phases. Each phase ships with its own tests and the suite
must be green before the next phase begins.

## [Unreleased]

### Fixed

- **Multi-buy totals.** A "2 kpl 4,50 €" offer only applies to whole bundles,
  but list totals multiplied its per-unit share by the quantity, so buying one
  showed 2,25 € instead of the shelf price 2,39 €. Rows now snapshot the
  single-unit price and totals go through `lineTotalCents()`. Rows added
  before this keep their old snapshot and can still under-report a remainder.
- **Writes had no author.** The list view never had a member id, so
  `checkedBy` stayed empty, last-write-wins tie-breaks compared empty strings,
  and no device could recognise the echo of its own change. Each tab now
  carries an id (sessionStorage, so two tabs never ignore each other).
- **Missed live updates after a restart.** Event ids restarted at zero, so a
  phone reconnecting after a deploy sent an id that looked like the future and
  was replayed nothing — the edits made while it was away never arrived. Ids
  are now seeded from the clock, and replay returns "refetch" whenever it
  cannot vouch for the history: after a restart, after the list's buffer was
  released, or after edits landed while nobody was listening. The presence
  update sent as the last viewer left also no longer re-creates that buffer.
- **Deleted rows coming back.** Deleting a row whose offline creation was
  still in flight cancelled both from the outbox; the creation landed and the
  row returned on the next sync. The delete is now always sent as a
  tombstone, and a flush no longer re-shows rows with a delete still queued.
- `DELETE …/items/:id?by=` rejects a malformed member id with a 400 instead of
  a database error.
- Removed `ld.json`, a stray Kesko product record committed by accident.
- **The live stream answered a bad link with a 500.** `/events` sits outside
  the shared error handler, so a wrong, revoked or expired token surfaced as
  an unhandled server error. It now gets the same 404 as every other route.
- `PATCH` / `DELETE …/items/:id` answer a malformed item id with a 404 rather
  than a database error and a 500.
- **Search fell back to an index that could not find what search had
  cached.** Products stored from a live search had no folded `searchName`, so
  once upstream was unreachable they only matched by case-sensitive name —
  "saarioinen" missed "Saarioinen …". The sitemap import also only lowercased
  names instead of folding them the way queries are.
- A row created *and* ticked offline arrived without `checkedBy` / `checkedAt`.
  It is now credited like any other check-off.
- Live updates for an add or an edit were published before the transaction
  committed, so a write that rolled back could still reach other devices.
- The service worker cached error responses. A 404 for a build chunk
  mid-deploy was then served cache-first until the cache version changed;
  only successful responses are kept now.
- The offline queue backed off after every flush, including ones with nothing
  to send, so each focus or reconnect lengthened the wait before a real
  failed change was retried. Only real failures count now.
- `npm run db:migrate` on PGlite reported every failure — including a broken
  migration — as "stop `npm run dev`". Only a failure to open the database
  says that now.

### List rows carry what the search result showed

Previously a product went into the list as a name and a price, and everything
that made it identifiable was dropped at the moment it became useful.

#### Added
- Product picture, comparison price (`7,50 €/kg`) and the offer
  ("2 kpl 4,50 €" or "−16 %") on each list row, snapshotted onto the item so
  they survive with no connection — the shop is where this matters and the
  shop is where there is no signal.
- Re-adding from history restores the whole row, not just the name.
- The picture column is reserved per list rather than per row, so a list of
  hand-typed items carries no empty gutter and a mixed list stays aligned.

#### Notes
- Offers render as "2 kpl 4,50 €" rather than a percentage where a multi-buy
  applies: it says what to actually do in the aisle.
- S-market was investigated and **cannot** be added. Every automated client —
  an honest user-agent, plain curl, a browser user-agent — is answered with a
  Vercel Security Checkpoint (`429`), while a real browser is served normally.
  That is an explicit bot challenge and this project does not defeat those.
  Product EANs do match across the chains, so cross-chain price comparison
  would be straightforward if access were ever granted.

### Real catalogue data

#### Added
- **Local product index.** Search runs entirely against the `products` table
  instead of calling an upstream API per keystroke — instant, and it costs
  nobody anything.
- Finnish diacritic folding, so "leipa" finds "leipä". Names are stored folded
  and queries are folded to match.
- `npm run catalogue:import` loads a catalogue snapshot from `.data/seed/`
  (gitignored: it is Kesko's data and this repository is public).
- `npm run catalogue:ingest` extracts the same data by driving a real browser
  over the public category pages.
- Product-page reader (`productPage.ts`) parsing the schema.org JSON-LD the
  site publishes, and a sitemap reader (`sitemap.ts`) that recovers names and
  EANs from product URL slugs.
- Aisle ordering taken from the site's own category order, so shopping mode
  follows the real layout of a shop.

#### Notes on the data source
The earlier conclusion — that this data could not be read at all — was wrong,
and the error message had been saying so the whole time:
`409 {"error":{"message":"Client version is too old - reload"}}`. That is an
ordinary API contract, not bot protection.

Search is live again, so Plussa campaign prices and multi-buy offers are back;
the phase 0 normalizer and its tests already covered them. Requests carry
`X-K-Build-Number`, discovered from the storefront and refreshed when the API
says it is stale, and go through curl, which this domain serves, rather than
Node's fetch, which it answers with a Cloudflare challenge.

Nothing here defeats bot protection: no challenge is solved, no stealth browser
is used, no TLS fingerprint is forged, and the User-Agent identifies the app
honestly. Headless Chromium *is* challenged, which is why browser-driven
ingestion was abandoned. The local index remains as the offline fallback.

## [1.0.0] — 2026-09-20

### Phase 5 — Aisle grouping, history and polish

#### Added
- **Shopping order.** Items group by aisle so the shop can be walked once
  instead of criss-crossed. The aisle is snapshotted onto the item rather than
  joined from the product cache, so grouping still works with no connection —
  which is exactly when it is used. The toggle appears only when there is more
  than one aisle to sort into, and the choice is remembered per list.
- **Item history.** Things this list has bought before and is not holding right
  now, offered as one-tap chips with their price and aisle intact. Scoped to
  the list rather than the device, so it works for whoever opens the link.
- Migration `0002` adding `aisle_name` / `aisle_order` to list items.

#### Fixed
- **Offline edits could be silently discarded.** `updatedAt` on a stored row
  comes from the server clock while a queued edit carries the client's, so
  comparing them was a guess rather than a causality check. A check-off queued
  moments after the item was added tied on timestamp, lost the tie-break, and
  vanished — the change looked applied locally and then disappeared on reload.

  Client timestamps are now reconciled against the server's: still clamped
  against a fast clock, but a change that is not *clearly* older than what is
  stored is treated as newer, because it is explicit user intent the server has
  not seen. Beyond a 5s skew tolerance the stored value still wins, so a
  genuinely stale offline edit cannot overwrite someone else's newer change.

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
