#!/bin/bash
# CoreBuild proposals stack health check (every 10 minutes from cron).
# Sends one ntfy alert when something breaks and one when it recovers — never repeats while the state is unchanged.
# Checks: deck-builder, Tika (file reading), Open WebUI, and both public hostnames through the Cloudflare tunnel.
NTFY_URL=${NTFY_URL:-http://10.10.2.10:8093/monitoring}
NTFY_ENV=${NTFY_ENV:-/mnt/cache/appdata/11-monitoring/.env}
NTFY_TOKEN_VAR=${NTFY_TOKEN_VAR:-DIUN_NTFY_TOKEN}
STATE=${STATE:-/mnt/user/appdata/20-corbuild-deckbuilder/.health-state}
AI_HOST=${AI_HOST:-https://ai.corebuild.com.sa}
DECKS_HOST=${DECKS_HOST:-https://decks.corebuild.com.sa}

fail=()
docker exec deck-builder node -e "fetch('http://localhost:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null || fail+=("deck-builder is down")
docker exec deck-builder node -e "fetch('http://open-webui-tika:9998/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null || fail+=("Tika is down (uploaded files cannot be read)")
docker exec deck-builder node -e "fetch('http://open-webui:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null || fail+=("Open WebUI is down")
curl -fsS -m 20 -o /dev/null "$AI_HOST/health" || fail+=("$AI_HOST unreachable (tunnel?)")
curl -fsS -m 20 -o /dev/null "$DECKS_HOST/health" || fail+=("$DECKS_HOST unreachable (download links broken)")

now=$([ ${#fail[@]} -eq 0 ] && echo ok || printf '%s; ' "${fail[@]}")
prev=$(cat "$STATE" 2>/dev/null)
[ "$now" = "$prev" ] && exit 0
echo "$now" > "$STATE"
tok=$(grep -E "^${NTFY_TOKEN_VAR}=" "$NTFY_ENV" 2>/dev/null | cut -d= -f2- | tr -d "\"'")
[ -n "$tok" ] || exit 0
if [ "$now" = ok ]; then title="CoreBuild AI recovered"; prio=default; msg="All CoreBuild proposal services are working again."
else title="CoreBuild AI problem"; prio=high; msg="$now"; fi
curl -fsS -m 20 -H "Authorization: Bearer $tok" -H "Title: $title" -H "Priority: $prio" -H "Tags: building_construction" -d "$msg" "$NTFY_URL" >/dev/null
