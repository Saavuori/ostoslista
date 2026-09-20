# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Work is organised in phases. Each phase ships with its own tests and the suite
must be green before the next phase begins.

## [Unreleased]

### Phase 2 — Product search, prices and totals
- Not started.

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
