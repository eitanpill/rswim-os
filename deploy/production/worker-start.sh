#!/usr/bin/env bash
# Production worker start: migrate, seed the plans, then serve the Inngest functions. Set RSWIM_SKIP_RELEASE=1 to
# start without migrating (e.g. a second replica, or while restoring a backup).
set -euo pipefail
cd /app
if [[ "${RSWIM_SKIP_RELEASE:-0}" != "1" ]]; then
  /app/deploy/production/release.sh
fi
cd /app/apps/worker
exec node --import tsx src/server.ts
