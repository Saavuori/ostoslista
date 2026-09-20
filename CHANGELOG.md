# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Work is organised in phases. Each phase ships with its own tests and the suite
must be green before the next phase begins.

## [Unreleased]

### Phase 1 — Lists, items and share links
- In progress.

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
