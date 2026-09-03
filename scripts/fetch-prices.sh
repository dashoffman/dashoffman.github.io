#!/usr/bin/env bash
# Pulls current currency prices from poe.ninja and upserts an hourly price_history
# row per tracked currency into Supabase, using the service_role key (server-side
# only — never ship this key to the browser).
#
# VERIFY BEFORE RELYING ON THIS: poe.ninja doesn't publish a stable, documented API,
# and its PoE2 economy endpoints may differ from the PoE1 ones assumed below. Open
# poe.ninja's PoE2 economy page in a browser, open devtools -> Network, reload, and
# find the XHR request(s) that return currency/item price data. Adjust
# PONINJA_BASE_URL / PONINJA_CURRENCY_TYPES / PONINJA_ITEM_TYPES below (or the
# repo variables of the same name) to match what you see.
#
# Required environment variables:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POE_LEAGUE
# Optional:
#   PONINJA_BASE_URL      (default: https://poe.ninja/api/data)
#   PONINJA_CURRENCY_TYPES (default: "Currency,Fragment")
#   PONINJA_ITEM_TYPES     (default: "Omen")

set -euo pipefail

BASE_URL="${PONINJA_BASE_URL:-https://poe.ninja/api/data}"
CURRENCY_TYPES="${PONINJA_CURRENCY_TYPES:-Currency,Fragment}"
ITEM_TYPES="${PONINJA_ITEM_TYPES:-Omen}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAP_FILE="$SCRIPT_DIR/currency-map.json"

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
: "${POE_LEAGUE:?POE_LEAGUE is required (exact league name as shown on poe.ninja)}"

all_lines="[]"

for type in ${CURRENCY_TYPES//,/ }; do
  echo "Fetching currencyoverview type=$type league=$POE_LEAGUE ..."
  resp=$(curl -sf "${BASE_URL}/currencyoverview?league=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$POE_LEAGUE")&type=${type}" || echo '{}')
  lines=$(echo "$resp" | jq '[.lines[]? | {name: .currencyTypeName, chaosValue: .chaosEquivalent}]')
  all_lines=$(echo "$all_lines" "$lines" | jq -s 'add')
done

for type in ${ITEM_TYPES//,/ }; do
  echo "Fetching itemoverview type=$type league=$POE_LEAGUE ..."
  resp=$(curl -sf "${BASE_URL}/itemoverview?league=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$POE_LEAGUE")&type=${type}" || echo '{}')
  lines=$(echo "$resp" | jq '[.lines[]? | {name: .name, chaosValue: .chaosValue}]')
  all_lines=$(echo "$all_lines" "$lines" | jq -s 'add')
done

echo "Collected $(echo "$all_lines" | jq 'length') priced line items."

divine_chaos=$(echo "$all_lines" | jq -r '[.[] | select(.name=="Divine Orb")][0].chaosValue // empty')
if [ -z "$divine_chaos" ]; then
  echo "ERROR: couldn't find Divine Orb price in poe.ninja response — league name or endpoint is likely wrong." >&2
  exit 1
fi

ts=$(date -u +"%Y-%m-%dT%H:00:00Z")
rows="[]"

while IFS= read -r entry; do
  id=$(echo "$entry" | jq -r '.id')
  match=$(echo "$entry" | jq -r '.match')

  if [ "$id" = "divine" ]; then
    div_price=1
  else
    chaos=$(echo "$all_lines" | jq -r --arg n "$match" '[.[] | select(.name==$n)][0].chaosValue // empty')
    if [ -z "$chaos" ]; then
      echo "WARNING: no price found for '$match' (currency id: $id) — skipping this tick." >&2
      continue
    fi
    div_price=$(python3 -c "print(float('$chaos') / float('$divine_chaos'))")
  fi

  row=$(jq -n --arg cid "$id" --arg ts "$ts" --arg price "$div_price" \
    '{currency_id: $cid, ts: $ts, div_price: ($price | tonumber)}')
  rows=$(echo "$rows" | jq --argjson r "$row" '. + [$r]')
done < <(jq -c '.[]' "$MAP_FILE")

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
