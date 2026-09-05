#!/usr/bin/env bash
# Pulls current currency prices from poe.ninja's documented PoE2 economy API
# (https://poe.ninja/docs/api) and upserts an hourly price_history row per tracked
# currency into Supabase, using the service_role key (server-side only — never ship
# this key to the browser). Also logs the full raw response for each `type` fetched
# into poe_ninja_snapshots, verbatim, so future features (new tracked items, volume/
# sparkline data, etc.) have historical data to work with even though today's app
# only extracts a handful of currencies' prices out of it.
#
# Endpoint: GET https://poe.ninja/poe2/api/economy/exchange/current/overview
#             ?league={league}&type={type}
# Response: { core: { primary, secondary, rates, items }, lines: [{ id, primaryValue, ... }] }
# `core.primary` is the reference currency every line's `primaryValue` is quoted in.
# Most of the time that's "divine" — exactly the div-equivalent price this app
# wants, so no conversion math is needed, just a direct lookup by id. Early in a
# fresh league, though, Divine Orbs are still scarce enough that poe.ninja falls
# back to quoting everything in Exalted instead (this happened at the start of
# Forbidden Rites). When that happens, `core.rates.divine` is poe.ninja's own
# ready-made Exalted-to-Divine conversion factor — multiplying every primaryValue
# by it recovers the same Divine-equivalent price this app has always stored. If
# core.rates.divine is ever missing too (no Divine trade data exists to compute a
# rate from at all), the script fails loudly for that type rather than guessing.
#
# scripts/currency-map.json maps our currency ids to poe.ninja's `type` (category)
# and `id` (line identifier) — e.g. Omens live under type=Ritual (poe.ninja names
# categories after the league that introduced them, not always the current one).
#
# Required environment variables:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POE_LEAGUE
# Optional:
#   PONINJA_BASE_URL (default: https://poe.ninja/poe2/api/economy/exchange/current/overview)

set -euo pipefail

BASE_URL="${PONINJA_BASE_URL:-https://poe.ninja/poe2/api/economy/exchange/current/overview}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAP_FILE="$SCRIPT_DIR/currency-map.json"

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${POE_LEAGUE:?POE_LEAGUE is required (exact league id, e.g. from https://poe.ninja/poe2/api/economy/leagues)}"

urlencode() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

ts=$(date -u +"%Y-%m-%dT%H:00:00Z")
rows="[]"
snapshots="[]"

for type in $(jq -r '[.[].ninjaType] | unique | .[]' "$MAP_FILE"); do
  echo "Fetching exchange overview type=$type league=$POE_LEAGUE ..."
  resp=$(curl -sf "${BASE_URL}?league=$(urlencode "$POE_LEAGUE")&type=${type}") || {
    echo "ERROR: request failed for type=$type — league name or endpoint is likely wrong." >&2
    continue
  }

  snapshot=$(jq -n --arg pulled_at "$ts" --arg league "$POE_LEAGUE" --arg ninja_type "$type" --argjson response "$resp" \
    '{pulled_at: $pulled_at, league: $league, ninja_type: $ninja_type, response: $response}')
  snapshots=$(echo "$snapshots" | jq --argjson s "$snapshot" '. + [$s]')

  primary=$(echo "$resp" | jq -r '.core.primary // empty')
  if [ "$primary" = "divine" ]; then
    divRate=1
  else
    divRate=$(echo "$resp" | jq -r '.core.rates.divine // empty')
    if [ -z "$divRate" ]; then
      echo "ERROR: poe.ninja's primary reference currency for type=$type is '$primary', and no core.rates.divine conversion factor is available — can't derive Divine-equivalent prices. Skipping this type." >&2
      continue
    fi
    echo "NOTE: type=$type is priced in '$primary' this run (Divine likely still scarce this early in the league) — converting via core.rates.divine=$divRate." >&2
  fi

  while IFS= read -r entry; do
    id=$(echo "$entry" | jq -r '.id')
    ninjaId=$(echo "$entry" | jq -r '.ninjaId')
    entryType=$(echo "$entry" | jq -r '.ninjaType')
    [ "$entryType" = "$type" ] || continue

    price=$(echo "$resp" | jq -r --arg nid "$ninjaId" '[.lines[] | select(.id==$nid)][0].primaryValue // empty')
    if [ -z "$price" ]; then
      echo "WARNING: no price found for '$ninjaId' (currency id: $id, type: $type) — skipping this tick." >&2
      continue
    fi

    row=$(jq -n --arg cid "$id" --arg ts "$ts" --arg price "$price" --arg rate "$divRate" \
      '{currency_id: $cid, ts: $ts, div_price: (($price | tonumber) * ($rate | tonumber))}')
    rows=$(echo "$rows" | jq --argjson r "$row" '. + [$r]')
  done < <(jq -c '.[]' "$MAP_FILE")
done

snapshot_count=$(echo "$snapshots" | jq 'length')
if [ "$snapshot_count" -gt 0 ]; then
  echo "Logging $snapshot_count raw snapshot(s) ..."
  curl -sf -X POST "${SUPABASE_URL}/rest/v1/poe_ninja_snapshots" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$snapshots"
fi

count=$(echo "$rows" | jq 'length')
if [ "$count" -eq 0 ]; then
  echo "No prices resolved this run — nothing to write." >&2
  exit 1
fi

echo "Upserting $count price rows for $ts ..."
curl -sf -X POST "${SUPABASE_URL}/rest/v1/price_history?on_conflict=currency_id,ts" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" \
  -d "$rows"

echo "Done."
