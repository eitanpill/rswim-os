#!/usr/bin/env bash
# Backup and restore drill. Takes a logical backup of SOURCE_DATABASE_URL (pg_dump, read-only on the source),
# restores it into a throwaway database on DRILL_ADMIN_URL, compares row counts of the tables that matter, then drops
# the throwaway database. Run it monthly against staging, and before the pilot against production
# (docs/saas/BACKUPS.md). The dump file is deleted at the end: it may hold real families' data.
#
#   SOURCE_DATABASE_URL=postgresql://...  DRILL_ADMIN_URL=postgresql://user:pass@host:5432/postgres \
#     deploy/production/restore-drill.sh
set -euo pipefail
: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is not set}"
: "${DRILL_ADMIN_URL:?DRILL_ADMIN_URL is not set (a server where a scratch database may be created)}"

name="restore_drill_$(date +%Y%m%d%H%M%S)"
dump="$(mktemp -d)/backup.dump"
target="${DRILL_ADMIN_URL%/*}/$name"
cleanup() {
  rm -rf "$(dirname "$dump")"
  psql "$DRILL_ADMIN_URL" -qc "drop database if exists $name with (force)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

tables="organizations memberships households students sessions ledger_entries plans org_subscriptions"
count() { # $1 url, $2 table → row count, or "-" when the table does not exist
  psql "$1" -Atc "select case when to_regclass('public.$2') is null then '-' else (select count(*)::text from public.$2) end" 2>/dev/null \
    | sed 's/^$/-/' || echo "-"
}
counts() { for t in $tables; do printf '%s=%s ' "$t" "$(count "$1" "$t")"; done; }

start=$(date +%s)
echo "1/4 backing up the source"
pg_dump --format=custom --no-owner --no-privileges --file="$dump" "$SOURCE_DATABASE_URL"
echo "    $(du -h "$dump" | cut -f1)"
before=$(counts "$SOURCE_DATABASE_URL")

echo "2/4 restoring into $name"
psql "$DRILL_ADMIN_URL" -qc "create database $name" >/dev/null
# Roles used by grants and policies (authenticated, anon, rswim_system...) exist on Supabase; on plain Postgres the
# restore skips what it cannot grant, which the comparison below does not depend on.
pg_restore --no-owner --no-privileges --dbname="$target" "$dump" 2>/tmp/restore-drill.log || true
after=$(counts "$target")

echo "3/4 comparing row counts"
echo "    source:   $before"
echo "    restored: $after"
if [[ "$before" != "$after" ]]; then
  echo "DRILL FAILED: the restored copy differs (see /tmp/restore-drill.log)" >&2
  exit 1
fi
migrations=$(psql "$target" -Atc "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null || echo 0)
echo "    migrations recorded: $migrations"

echo "4/4 done in $(( $(date +%s) - start ))s; the throwaway database and the dump are deleted"
