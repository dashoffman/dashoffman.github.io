# Guild Stash Tracker — setup

A static site (plain HTML/CSS/JS, no build step) backed by Supabase (Postgres) for
shared data, and a GitHub Actions cron job that pulls prices from poe.ninja.

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → sign in → New project.
2. Once it's up: **SQL Editor** → paste the contents of [`schema.sql`](schema.sql) → Run.
   This creates all tables, seeds the four members with placeholder PINs
   (`1111`/`2222`/`3333`/`4444` for Garrett/Zach/Jordan/Justin), and seeds the
   currency list. **Change the PINs** afterwards:
   ```sql
   update members set pin = '5309' where id = 'garrett';
   ```
3. **Project Settings → API**: copy the **Project URL** and **anon public** key into
   [`js/config.js`](js/config.js). These are safe to be public — real access control
   is enforced by the Postgres Row Level Security policies in `schema.sql`, not by
   keeping this key secret.

## 2. Wire up the price-fetch job

1. In your GitHub repo → **Settings → Secrets and variables → Actions**:
   - **Secrets** → add `SUPABASE_URL` (same Project URL as above) and
     `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → `service_role` key —
     keep this one out of client code, it bypasses Row Level Security).
   - **Variables** → add `POE_LEAGUE` set to the exact league name as it appears
     on poe.ninja (e.g. the current PoE2 challenge league).
2. **Verify the poe.ninja endpoint** — poe.ninja doesn't publish a documented,
   stable API, and [`scripts/fetch-prices.sh`](scripts/fetch-prices.sh) assumes the
   same `api/data/currencyoverview` / `api/data/itemoverview` shape PoE1 uses. Before
   relying on this: open poe.ninja's PoE2 economy page, open devtools → Network,
   reload, and find the request that returns currency/item prices. If the URL differs,
   update `PONINJA_BASE_URL` (and the `PONINJA_CURRENCY_TYPES` / `PONINJA_ITEM_TYPES`
   env vars) at the top of the script.
3. Once secrets are set, go to the **Actions** tab → "Update currency prices" →
   **Run workflow** to trigger it manually and confirm it succeeds (check the logs —
   it'll tell you exactly which currency it couldn't price if something's off). It
   otherwise runs automatically every hour.

## 3. Enable GitHub Pages

**Settings → Pages** → Source: "Deploy from a branch" → Branch: `main` / `(root)`.
Since this repo is `<username>.github.io`, it publishes at `https://<username>.github.io/`.

## 4. First login

Pick your name, enter your PIN (change these from the placeholders — see step 1.2).
There's no shared state until someone records a deposit — start on the Ledger page.

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
