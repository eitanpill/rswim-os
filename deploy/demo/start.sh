#!/usr/bin/env bash
# The live demo in one container: Postgres, the Inngest dev server, the worker and the web app, all on fake data and
# fake providers. The database is rebuilt at boot, every night at RSWIM_DEMO_RESET_HOUR (Israel time) and whenever
# /dev/reset?key=… asks for it. If any process dies the container exits, and the host restarts it on fresh data.
set -euo pipefail

APP=/app
PGDATA=${PGDATA:-/var/lib/postgresql/data}
export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/rswim_demo
export RSWIM_DEMO_RESET_FLAG=${RSWIM_DEMO_RESET_FLAG:-/tmp/rswim-demo-reset}
RESET_HOUR=${RSWIM_DEMO_RESET_HOUR:-3}
WEB_PORT=${PORT:-3000}

# The demo never talks to a real provider, whatever the host's environment says.
unset GHL_API_TOKEN GHL_WEBHOOK_PUBLIC_KEY GROW_WEBHOOK_SECRET NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY INNGEST_EVENT_KEY INNGEST_SIGNING_KEY
export RSWIM_DEMO_MODE=1 RSWIM_PLAIN_POSTGRES=1 \
  RSWIM_MESSAGING_FAKE=1 RSWIM_GHL_FAKE=1 RSWIM_GROW_FAKE=1 RSWIM_INVOICING_FAKE=1 RSWIM_DNS_FAKE=1 \
  RSWIM_COPILOT_FAKE=1 RSWIM_BOT_FAKE=1
# Real Claude only when the host explicitly opts in (it costs money and the demo is public).
if [[ "${RSWIM_DEMO_REAL_CLAUDE:-0}" == "1" && -n "${ANTHROPIC_API_KEY:-}" ]]; then
  unset RSWIM_COPILOT_FAKE RSWIM_BOT_FAKE
else
  unset ANTHROPIC_API_KEY
fi
# Encrypted fields need a key; the data is rebuilt at boot, so a fresh random one is fine.
export RSWIM_MASTER_KEY=${RSWIM_MASTER_KEY:-$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")}
export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=Asia/Jerusalem

log() { echo "[demo] $(date -Is) $*"; }

# ─── Postgres (localhost only, trust auth: nothing outside the container can reach it) ───
if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
  mkdir -p "$PGDATA" && chown -R postgres:postgres "$PGDATA"
  gosu postgres initdb -D "$PGDATA" --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
fi
chown -R postgres:postgres "$PGDATA"
gosu postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -c max_connections=60" -w start >/dev/null
log "postgres up"

reset_demo() {
  log "resetting demo data"
  (cd "$APP/packages/seed" && node --import tsx src/live-demo-reset.ts)
  rm -f "$RSWIM_DEMO_RESET_FLAG"
}
reset_demo

pids=()
# ─── Inngest dev server: runs the worker's crons and events in memory, reachable only inside the container.
# It polls the worker's URL until it answers, then keeps its function list in sync. ───
inngest-cli dev --no-discovery -u http://127.0.0.1:3030/api/inngest --host 127.0.0.1 --port 8288 \
  --log-level warn &
pids+=($!)
# ─── Worker ───
(cd "$APP/apps/worker" && INNGEST_DEV=1 INNGEST_BASE_URL=http://127.0.0.1:8288 PORT=3030 \
  node --import tsx src/server.ts) &
pids+=($!)
# ─── Web ───
(cd "$APP/apps/web" && exec node_modules/.bin/next start --hostname 0.0.0.0 --port "$WEB_PORT") &
pids+=($!)
log "web on :$WEB_PORT"

last_nightly=$(date +%F)
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      log "process $pid exited; stopping so the host restarts the demo"
      exit 1
    fi
  done
  today=$(date +%F)
  if [[ -f "$RSWIM_DEMO_RESET_FLAG" ]]; then
    reset_demo || log "reset failed"
  elif [[ "$today" != "$last_nightly" && "$(date +%-H)" -ge "$RESET_HOUR" ]]; then
    last_nightly=$today
    reset_demo || log "nightly reset failed"
  fi
  sleep 5
done
