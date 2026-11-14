#!/usr/bin/env bash
# Brings a database up to date: migrations (under an advisory lock, so two deploys never migrate at once), then the
# production seed (plans and starter regulations; never demo data). Safe to run on every deploy.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is not set}"
if [[ "${RSWIM_DEMO_MODE:-0}" == "1" ]]; then
  echo "release.sh is for staging and production; the demo has its own reset" >&2
  exit 1
fi
cd "$(dirname "$0")/../.."
pnpm --filter @rswim/db migrate
pnpm --filter @rswim/seed seed:production
