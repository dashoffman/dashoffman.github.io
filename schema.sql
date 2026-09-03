-- PoE2 Guild Stash Tracker — Supabase schema
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Safe to re-run: uses "create table if not exists" / drop-and-recreate for views & functions.

-- ---------- members (private: holds PINs) ----------
create table if not exists members (
  id text primary key,
  name text not null,
  pin text not null,
  color text not null
);

insert into members (id, name, pin, color) values
  ('garrett', 'Garrett', '1111', '#c9a961'),
  ('zach',    'Zach',    '2222', '#8b7fd6'),
  ('jordan',  'Jordan',  '3333', '#6fae8f'),
  ('justin',  'Justin',  '4444', '#c97b63')
on conflict (id) do nothing;

alter table members enable row level security;
-- No policies granted on `members` itself -> anon/authenticated have zero access.
-- Only the service_role (which bypasses RLS) and the SECURITY DEFINER function below can read it.

-- Public-safe view: names/colors only, never the pin.
create or replace view members_public as
  select id, name, color from members;

grant select on members_public to anon, authenticated;

-- Login check: returns true/false without ever exposing the pin column.
create or replace function verify_login(p_member_id text, p_pin text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from members where id = p_member_id and pin = p_pin
  );
$$;

grant execute on function verify_login(text, text) to anon, authenticated;

-- ---------- currencies (config table) ----------
create table if not exists currencies (
  id text primary key,
  name text not null,
  category text not null check (category in ('liquid', 'investment')),
  glyph text not null,          -- short glyph/abbreviation shown in UI
  color text not null,
  sort_order int not null default 0,
  threshold_target numeric      -- div-equivalent "afford this" target, investment currencies only
);

insert into currencies (id, name, category, glyph, color, sort_order, threshold_target) values
  ('divine',      'Divine Orb',        'liquid',     'DIV', '#c9a961', 1, null),
  ('exalted',     'Exalted Orb',       'liquid',     'EX',  '#d4c199', 2, null),
  ('fracturing',  'Fracturing Orb',    'liquid',     'FRC', '#9fb8c9', 3, null),
  ('mirror',      'Mirror of Kalandra','investment', 'MIR', '#e6d3a3', 10, 250),
  ('hinekora',    'Hinekora''s Lock',  'investment', 'HIN', '#b39ddb', 11, 60),
  ('omen_light',  'Omen of Light',     'investment', 'OoL', '#f0e6c8', 12, 15),
  ('omen_whittling','Omen of Whittling','investment','OoW', '#c8d8f0', 13, 8)
on conflict (id) do nothing;

alter table currencies enable row level security;
create policy if not exists "currencies readable by all" on currencies
  for select using (true);

-- ---------- price_history (written hourly by GitHub Action, service_role only) ----------
create table if not exists price_history (
  id bigint generated always as identity primary key,
  currency_id text not null references currencies(id),
  ts timestamptz not null,
  div_price numeric not null,
  unique (currency_id, ts)
);

create index if not exists price_history_currency_ts_idx on price_history (currency_id, ts desc);

alter table price_history enable row level security;
create policy if not exists "price_history readable by all" on price_history
  for select using (true);
-- No insert/update/delete policy for anon/authenticated: only service_role (CI) can write.

-- ---------- transactions (ledger: deposits & withdrawals) ----------
create table if not exists transactions (
  id bigint generated always as identity primary key,
  member_id text not null references members(id),
  currency_id text not null references currencies(id),
  qty numeric not null check (qty > 0),
  type text not null check (type in ('deposit', 'withdrawal')),
  note text,
  ts timestamptz not null default now()
);

alter table transactions enable row level security;
create policy if not exists "transactions readable by all" on transactions
  for select using (true);
create policy if not exists "transactions writable by all" on transactions
  for insert with check (true);

-- ---------- investments (pooled buy-ins) ----------
create table if not exists investments (
  id bigint generated always as identity primary key,
  currency_id text not null references currencies(id),
  qty numeric not null default 1,
  total_cost_div numeric not null check (total_cost_div > 0),
  ts timestamptz not null default now(),
  note text
);

alter table investments enable row level security;
create policy if not exists "investments readable by all" on investments
  for select using (true);
create policy if not exists "investments writable by all" on investments
  for insert with check (true);

create table if not exists investment_contributions (
  investment_id bigint not null references investments(id) on delete cascade,
  member_id text not null references members(id),
  amount_div numeric not null check (amount_div >= 0),
  primary key (investment_id, member_id)
);

alter table investment_contributions enable row level security;
create policy if not exists "investment_contributions readable by all" on investment_contributions
  for select using (true);
create policy if not exists "investment_contributions writable by all" on investment_contributions
  for insert with check (true);

-- ---------- splits ----------
create table if not exists splits (
  id bigint generated always as identity primary key,
  item_name text not null,
  sale_price_div numeric not null check (sale_price_div > 0),
  ts timestamptz not null default now(),
  note text
);

alter table splits enable row level security;
create policy if not exists "splits readable by all" on splits
  for select using (true);
create policy if not exists "splits writable by all" on splits
  for insert with check (true);

create table if not exists split_participants (
  split_id bigint not null references splits(id) on delete cascade,
  member_id text not null references members(id),
  primary key (split_id, member_id)
);

alter table split_participants enable row level security;
create policy if not exists "split_participants readable by all" on split_participants
  for select using (true);
create policy if not exists "split_participants writable by all" on split_participants
  for insert with check (true);
