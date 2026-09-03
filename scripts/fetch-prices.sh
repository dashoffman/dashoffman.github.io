#!/usr/bin/env bash
# Pulls current currency prices from poe.ninja's documented PoE2 economy API
# (https://poe.ninja/docs/api) and upserts an hourly price_history row per tracked
# currency into Supabase, using the service_role key (server-side only — never ship
# this key to the browser).
#
# Endpoint: GET https://poe.ninja/poe2/api/economy/exchange/current/overview
#             ?league={league}&type={type}
# Response: { core: { primary, secondary, rates, items }, lines: [{ id, primaryValue, ... }] }
# `core.primary` is the reference currency every line's `primaryValue` is quoted in.
# For every PoE2 league so far that's "divine", which is exactly the div-equivalent
# price this app wants — so no chaos-orb math is needed, just a direct lookup by id.
# If poe.ninja ever changes the primary reference currency this script will notice
# (see the check below) and fail loudly rather than silently writing wrong prices.
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

for type in $(jq -r '[.[].ninjaType] | unique | .[]' "$MAP_FILE"); do
  echo "Fetching exchange overview type=$type league=$POE_LEAGUE ..."
  resp=$(curl -sf "${BASE_URL}?league=$(urlencode "$POE_LEAGUE")&type=${type}") || {
    echo "ERROR: request failed for type=$type — league name or endpoint is likely wrong." >&2
    continue
  }

  primary=$(echo "$resp" | jq -r '.core.primary // empty')
  if [ "$primary" != "divine" ]; then
    echo "ERROR: poe.ninja's primary reference currency for type=$type is '$primary', not 'divine' — the div-equivalent assumption in this script no longer holds. Skipping this type." >&2
    continue
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

    row=$(jq -n --arg cid "$id" --arg ts "$ts" --arg price "$price" \
      '{currency_id: $cid, ts: $ts, div_price: ($price | tonumber)}')
    rows=$(echo "$rows" | jq --argjson r "$row" '. + [$r]')
  done < <(jq -c '.[]' "$MAP_FILE")
done

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
