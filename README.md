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
| 1 | Lists, items, share links | In progress |
| 2 | Product search, prices, totals | Planned |
| 3 | Realtime sync | Planned |
| 4 | Offline-first | Planned |
| 5 | Aisle grouping, history, polish | Planned |

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
and unversioned, and Kesko publishes no open product API — so the integration is
isolated in `src/lib/kruoka/`, cached conservatively, and never bulk-crawled.
No catalogue data is committed to this repository.

## Licence

Not yet chosen.
