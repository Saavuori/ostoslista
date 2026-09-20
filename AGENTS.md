# AGENTS.md

Operating manual for this repository — for coding agents and for humans who want
the short version. Read this before changing anything.

## What this is

**Ostoslista** is a shared grocery list. You make a list, send someone a link,
and you both edit it at the same time — including in a shop with no signal.
Product names, prices and pictures come from K-Ruoka.

The whole design follows from two moments:

1. **Adding at home** — relaxed, search-driven, you want autocomplete and pictures.
2. **Checking off in a shop** — one hand, bright light, cold, and usually no
   usable connection. Big targets, bottom-anchored actions, offline-first.

If a change makes moment 2 worse, it is the wrong change.

## Quick start

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev                 # http://localhost:3000
```

That needs **no Docker and no installed Postgres**. `.env.example` points
`DATABASE_URL` at `pglite://.data/dev` — Postgres compiled to WASM, running
in-process. It is the same engine as production, so behaviour does not drift.

Against a real Postgres instead:

```bash
docker compose up -d db
DATABASE_URL=postgres://ostoslista:ostoslista@localhost:5432/ostoslista npm run db:migrate
```

Full stack in containers:

```bash
docker compose up -d --build
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build (`output: "standalone"`) |
| `npm test` | Vitest unit + integration suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end specs |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome lint + format check |
| `npm run lint:fix` | Autofix what Biome can |
| `npm run verify` | **lint + typecheck + test — run this before every commit** |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:migrate` | Apply migrations |
| `npm run docker:up` | Build and start the full stack |

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19 | API routes give us the server-side K-Ruoka proxy in the same deployable |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | |
| Styling | Tailwind CSS v4, CSS-first `@theme` | Tokens live in `src/app/globals.css`, not a JS config |
| Database | Postgres 18 + Drizzle ORM | Relational price data; typed queries without a heavy runtime |
| Realtime | Server-Sent Events + in-process bus | One-way fanout is all a list needs, survives proxies far better than WebSockets, and reconnects itself with `Last-Event-ID` |
| Offline | Dexie (IndexedDB) + outbox | The local copy is what the UI reads; the server is reconciled with afterwards |
| Lint/format | Biome | One fast tool instead of ESLint + Prettier |
| Tests | Vitest, Testing Library, Playwright | |
| Runtime | Docker/Podman, non-root, `standalone` output | |

## Layout

```
src/
  app/
    api/
      health/          liveness probe
      lists/           list + item CRUD
      products/        K-Ruoka proxy (search, EAN lookup)
      events/          SSE stream per list
    l/[token]/         the shared list view
  lib/
    kruoka/            upstream adapter — client, normalizer, types
    db/                Drizzle schema, migrations, connection
    sync/              last-write-wins reconciliation
    offline/           IndexedDB store and the outbound queue
  components/
tests/
  fixtures/            real captured API payloads
  unit/
  e2e/                 Playwright
```

## The K-Ruoka integration — read this before touching it

This is the fragile part of the system. It is deliberately quarantined in
`src/lib/kruoka/`.

**It is an undocumented, unversioned internal API.** There is no public Kesko
product API. Things that follow from that:

- **It is server-side only.** The endpoint sends no CORS headers — a browser
  calling it directly fails at preflight. Verified:
  `No 'Access-Control-Allow-Origin' header is present`. Everything client-side
  goes through our own `/api/products/*` routes.
- **Two things are required to get a useful answer.** Both came from the API's
  own error responses, not from guessing.

  1. **`X-K-Build-Number`.** Without it the API replies
     `409 {"error":{"message":"Client version is too old - reload"}}`. The
     storefront serves its assets from `/assets/b-<number>/`, so the current
     value is read from there and refreshed automatically when the API reports
     it is stale — see `buildNumber.ts`. It changes on every deploy, so never
     hard-code it.
  2. **curl, not Node's `fetch`.** Node's client is answered with a Cloudflare
     challenge page on this domain; curl is served normally. `transport.ts`
     shells out via `execFile` with an argument array — there is no shell, so a
     product name full of quotes and semicolons is an argument and nothing
     else. Requests outside `https://www.k-ruoka.fi` are refused.

  **What this is not.** No challenge is solved, no stealth browser is used, and
  no TLS fingerprint is forged. curl presents its own, and the User-Agent
  identifies this app honestly. Preferring a client the server actually serves
  is a compatibility choice, not a disguise.

  **Do not replace it with anything that disguises itself.** Headless Chromium
  *is* challenged (`403`, "Just a moment…"), which is why
  `scripts/ingest-catalogue.ts` does not work and is kept only for reference.
  If curl ever stops being served, the answer is to ask Kesko — not to escalate.

- **The local index is the fallback, not the primary.** When upstream cannot be
  reached, search degrades to cached names, pictures and last-seen prices
  instead of failing. `npm run catalogue:import` seeds it from
  `.data/seed/*.txt` (gitignored: Kesko's data, public repo).

- **Never bulk-crawl.** Prices are per-store (`storeId=N106` is Iso Omena), so a
  full mirror would be ~1,000 stores × ~20,000 products daily. Instead: cache
  product identity globally and long-lived, cache price per `(ean, storeId)`
  with a short TTL, and fetch lazily only for products someone actually has on
  a list.
- **Never commit catalogue data.** This repo is public; the catalogue is
  Kesko's. `.gitignore` blocks `data/catalogue/` and `.cache/`.
- **Hotlink images**, don't mirror them: `public.keskofiles.com/f/k-ruoka/...`.

### The pricing model, which is the easiest thing to get wrong

`mobilescan.pricing` has up to three variants:

| Variant | Meaning | Trap |
|---|---|---|
| `normal` | Shelf price. Always present. | — |
| `discount` | Per-unit campaign price. | Usually needs a Plussa card (`discountType: "PLUSSA"`) |
| `batch` | Multi-buy: `amount: 2`, `price: 4.50` | **`price` is the price of the whole bundle, not per unit.** Reading it naively doubles the total. |

`normalize.ts` collapses all three into `PriceOffer` with an
`effectiveUnitPrice`, and `lineTotal()` handles partial bundles — buying 1 of a
"2 for 4,50" costs the normal 2,39, not 2,25. There are tests for every one of
these cases. **Do not change the pricing logic without running them.**

Products are also sold three different ways (`soldBy`): `piece`, `mass`
(loose, priced per kg) and `approximatePiece` (a whole fish, ~1.5 kg). Quantity
is therefore `numeric` with a unit, never an integer.

## Realtime

`src/lib/realtime/bus.ts` is an **in-process** publish/subscribe bus. That is
deliberate: this app deploys as one container on one VM, so a broker would be
machinery without a job.

**If this is ever run with more than one replica, the bus must be replaced with
Postgres `LISTEN`/`NOTIFY`.** Two replicas would each only deliver events to
the clients connected to themselves, and lists would silently diverge. The
`publish()` signature is async purely to keep that swap a local change.

Other things worth knowing before editing it:

- Events carry an `origin`. A client ignores its own echo, because the local
  optimistic update is already newer. Dropping this makes the UI flicker.
- The replay buffer is bounded. `replaySince()` returns `null` when a client
  was away too long, which means "refetch" — never treat that as "no changes".
- Streams are heartbeated every 20s. Without it, proxies close idle connections
  and clients reconnect in a loop.

## Offline

`src/lib/offline/` is split so the hard part is testable without a browser:

- `outbox.ts` — the decisions (collapsing, payload shape, backoff). Pure.
- `queue.ts` — storage, fetch and the retry loop. Plumbing.
- `db.ts` — the Dexie schema.

Rules that are easy to break:

- **The outbox holds intent, not history.** New changes collapse into what is
  already queued for that row. A `delete` cancels a pending `create` outright.
  Anything that turns this into an append-only log will flood the server after
  a long trip.
- **Deletes are tombstones on the wire.** The server has to tell "removed"
  from "not mentioned".
- **Never cache `/api/` in the service worker.** A stale list is worse than a
  visibly missing one, and a cached write would be silently dropped.
- **Sort keys are bounded** (`numeric(20, 6)`). Do not use sentinels like
  `Number.MAX_SAFE_INTEGER`; they sort fine locally and fail the whole sync
  batch at the database.
- Failures are reported as "waiting to send", not as errors, until the queue
  actually gives up. Telling someone mid-shop that their tap failed — when it
  did not — is worse than saying nothing.

## When the catalogue is unavailable

This is a first-class state, not an error case.

- `/api/products/search` returns `200` with `{ items: [], degraded: true }`
  rather than an error status, because a failed search must never block adding
  something to a list.
- `AddItemBar` shows a quiet line explaining that search is unavailable and
  that names still work. It does not look like a crash.
- `getPrices()` serves a **stale cached price** rather than failing. Someone
  standing in a shop is better served by yesterday's price than by an error.
- Items carry `nameSnapshot` and `priceCentsSnapshot`, so a list keeps
  displaying correctly and totalling correctly with no catalogue at all.

## Conventions

- **Finnish in the UI, English in the code.** User-facing strings are Finnish;
  identifiers, comments and commit messages are English.
- **Numbers use the `.tabular` class** (Martian Mono, tabular figures) so price
  columns align. Prices are stored and computed in **cents** to avoid float
  drift, and converted at the edges.
- **Soft deletes only** on list items. A hard delete that syncs after an offline
  edit resurrects the row — the classic shared-list bug.
- **Client-generated UUIDv7 ids** so an offline add needs no round-trip.
- Tap targets are at least `--spacing-touch` (48px).
- Colour carries meaning: `signal` (orange) is action, `fresh` (green) is
  *savings only*. Do not use green for "done" — that is what the strike-through
  is for.

## Testing rules

Each phase ships with its tests and the suite must be green before the next
phase starts. That is the project's core working agreement.

- Unit tests live next to the code (`src/lib/kruoka/normalize.test.ts`).
- Fixtures in `tests/fixtures/` are **real captured payloads**, trimmed but
  structurally verbatim. When upstream changes, re-capture rather than hand-edit.
- Component tests opt into jsdom with a `@vitest-environment jsdom` docblock;
  the default environment is `node` so logic tests stay fast.
- E2E specs assume a running app and a clean database.

## Deployment

Target is a single Oracle Cloud VM running rootless Podman behind Caddy.
The image is built by CI and is plain OCI, so `docker` and `podman` both work.

```bash
# Migrations are a deploy step, run from a checkout against the production
# database. They are deliberately NOT run by the container on start: two
# replicas starting at once would race, and a failed migration would turn into
# a crash loop rather than a clear error.
DATABASE_URL=postgres://... npm run db:migrate

podman pull ghcr.io/saavuori/ostoslista:latest
systemctl --user restart ostoslista
```

Rollback is redeploying the previous tag. Migrations are written to be additive
so a rollback does not strand the schema.

## Gotchas

- `output: "standalone"` means the runtime image has no `node_modules`. A
  dependency that is only `require`d dynamically will be missing at runtime.
- The service worker is served `no-store`. Do not cache it, or clients pin to
  an old build forever.
- `npm run db:generate` writes SQL to `drizzle/`. That directory **is**
  committed and ships in the image.
- Database drivers are listed in `serverExternalPackages`. PGlite locates its
  WASM payload relative to its own file, and bundling rewrites that path to a
  build-time placeholder, so it must stay external.
- Turbopack does not pick up **new** route files created while `next dev` is
  running — they 404 until the server restarts. If a route you just added is
  missing, restart before debugging it.
- PGlite allows **one writer per directory**. Running `npm run db:migrate`
  while `npm run dev` is up fails with a raw `Aborted()` WASM stack that cannot
  be caught or improved. Stop the dev server first; if it persists, delete
  `.data/dev` — the local database is disposable.
- Next 16 blocks cross-origin dev requests and counts `127.0.0.1` as separate
  from `localhost`. `allowedDevOrigins` covers both; without it the client
  bundle never loads over loopback and every interaction silently does nothing.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
