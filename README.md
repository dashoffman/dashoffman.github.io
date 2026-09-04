# Guild Stash Tracker

A static site (plain HTML/CSS/JS, no build step) at https://dashoffman.github.io/,
backed by Supabase (Postgres) for shared data, and a GitHub Actions job that pulls
prices from poe.ninja every hour.

Everything is already set up and live: Supabase project created and schema applied,
GitHub Pages enabled, and the price-fetch job running hourly with real data flowing
in. What follows is how to maintain it.

## Changing PINs

The four members were seeded with placeholder PINs. Change them any time in the
Supabase SQL Editor:

```sql
update members set pin = '5309' where id = 'garrett';
```

## Switching the league

The price-fetch job reads the league from a repo variable (**Settings → Secrets and
variables → Actions → Variables → `POE_LEAGUE`**), currently set to `Runes of Aldur`
since `Forbidden Rites` hadn't started yet and has no price history. Once Forbidden
Rites is live, update that variable to `Forbidden Rites` (or whatever exact id
[`/poe2/api/economy/leagues`](https://poe.ninja/poe2/api/economy/leagues) reports) —
no code change needed, just the variable.

At the same time, flush the old league's cached price data in the Supabase SQL
Editor. Neither `price_history` nor `poe_ninja_snapshots` has a `league` column, so
without this the old league's prices and poe.ninja's raw historical cache sit
back-to-back with the new league's completely different economy and nothing to tell
them apart — corrupting the Inflation Index's "all-time" change and any chart that
spans the transition:

```sql
delete from price_history;
delete from poe_ninja_snapshots;
```

Nothing else depends on this data — `investments`/`transactions` store their own
div amounts and quantities at the time they were recorded, not a live price lookup —
so both tables start clean and refill on the next hourly pull.

## Investment affordability targets

`threshold_target` in the `currencies` table is the "fully funded" div amount shown
on the Investments page's progress bars. Adjust per-item any time:

```sql
update currencies set threshold_target = 300 where id = 'mirror';
```

## Adding a new tracked currency

Insert a row into `currencies` (and, if it should be priced automatically, a matching
entry in [`scripts/currency-map.json`](scripts/currency-map.json) pointing at its
poe.ninja `type`/`id` — see [`scripts/fetch-prices.sh`](scripts/fetch-prices.sh) for
how to look those up via https://poe.ninja/docs/api). Everything else (the ledger,
holdings math, unit engine) works off that table with no other changes.

## Re-running or debugging the price fetch

**Actions tab → "Update currency prices" → Run workflow** triggers it manually; check
the run's logs if a currency's price didn't update (it warns by name rather than
failing silently). It otherwise runs automatically at :37 past every hour — chosen
to land away from the top-of-hour crunch when most other repos' cron jobs also
fire, since GitHub Actions schedules are best-effort and can be delayed or
silently skipped under load, especially in that busier window. Even at :37,
occasional missed hours are expected; if a gap ever matters, use "Run workflow"
above to backfill it manually.

## How it works / design notes

- **No backend server** — the browser talks to Supabase directly (Postgres REST API +
  Row Level Security), and GitHub Actions runs the hourly price fetch. This is why
  GitHub Pages (which only serves static files) is enough.
- **Login is a lightweight PIN check**, not real authentication — appropriate for a
  closed group of 4 friends, not a substitute for real auth if this ever needs to be
  more adversarial. Whoever picks a name on a given device stays "logged in" there
  (stored in that browser's localStorage) until they log out.
- **Ownership uses a unitized/NAV model** (like a mutual fund) — see
  [`js/ledgerMath.js`](js/ledgerMath.js) for the full engine and the assumptions it
  documents inline (e.g. investment buy-ins are assumed to be funded from Divine Orb
  holdings, and split proceeds are assumed to land as Divine Orb). Nothing derived
  (units, value-per-unit, holdings) is stored — it's all replayed from the raw
  transaction/investment/split event log plus the price history, so there's no
  drift between the ledger and what's displayed.
- **Prices are Divine-denominated at the source** — poe.ninja's PoE2 exchange-overview
  API quotes every price directly in Divine Orbs (`core.primary == "divine"`), so
  `scripts/fetch-prices.sh` does a direct lookup with no chaos-orb conversion math.
