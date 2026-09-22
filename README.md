# Ostoslista

Yhteinen ostoslista. Tee lista, jaa linkki, merkitse ostetuksi — myös kaupassa
ilman verkkoyhteyttä. Tuotetiedot, hinnat ja kuvat tulevat K-Ruoasta.

> A shared grocery list for Finnish households. Make a list, send a link, edit
> it together in real time, and keep ticking things off in the shop when there
> is no signal.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold + K-Ruoka adapter | Done |
| 1 | Lists, items, share links | Done |
| 2 | Product search, prices, totals | Done — see the data-source note below |
| 3 | Realtime sync | Done |
| 4 | Offline-first | Done |
| 5 | Aisle grouping, history, polish | Done |

250 unit and integration tests, 16 end-to-end tests.

## Quick start

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run db:migrate
npm run dev
```

Or run everything in containers:

```bash
docker compose up -d --build
```

Then open http://localhost:3000.

## Development

See **[AGENTS.md](AGENTS.md)** for the stack, project layout, conventions and
the traps in the K-Ruoka integration. Run `npm run verify` before committing.

## A note on the data source

Product data comes from K-Ruoka's internal storefront API. It is undocumented
and unversioned, and Kesko publishes no open product API — so the integration
is isolated in `src/lib/kruoka/`, cached conservatively, and never bulk-crawled.
No catalogue data is committed to this repository.

**Live product lookups are currently blocked.** Cloudflare answers server-side
requests with a consistent `403`, while the same URL succeeds from a real
browser session. No attempt is made to work around that.

The app runs degraded by design, and it is tested that way: product search
returns nothing and says so, prices already cached are served stale rather than
erroring, and every item carries a name and price snapshot so existing lists
keep displaying and totalling correctly. Everything except autocomplete works.

## Licence

Not yet chosen.
