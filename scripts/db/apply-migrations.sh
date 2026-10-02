#!/usr/bin/env bash
# scripts/db/apply-migrations.sh
# ─────────────────────────────────────────────────────────────
# Apply every supabase/migrations/*.sql, in filename order, to a plain
# Postgres database, from scratch — the same thing `supabase db push` does
# on staging, but with no Supabase account, CLI or Docker needed.
#
# Usage:
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/loudentify_test \
#     scripts/db/apply-migrations.sh [--fresh]
#
#   --fresh   drop and recreate the database named in DATABASE_URL first
#             (the normal mode in CI and for local verification).
#
# Stops at the first error (ON_ERROR_STOP), prints the file that failed.
# Records each applied file in supabase_migrations.schema_migrations with
# the same shape the Supabase CLI uses, so `supabase migration list` on a
# database prepared this way agrees with one prepared by the CLI.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required (postgres://user:pass@host:port/dbname)}"

FRESH=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

DBNAME="${DATABASE_URL##*/}"; DBNAME="${DBNAME%%\?*}"
ADMIN_URL="${DATABASE_URL%/*}/postgres"

if [ "$FRESH" = "1" ]; then
  echo "▶ recreating database $DBNAME"
  psql -v ON_ERROR_STOP=1 -q "$ADMIN_URL" -c "drop database if exists \"$DBNAME\" with (force);" -c "create database \"$DBNAME\";"
fi

echo "▶ installing the Supabase stub (roles, auth, storage, default privileges)"
psql -v ON_ERROR_STOP=1 -q "$DATABASE_URL" -f "$ROOT/scripts/db/supabase-stub.sql"

psql -v ON_ERROR_STOP=1 -q "$DATABASE_URL" <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

count=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$f" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  already="$(psql -At "$DATABASE_URL" -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")"
  if [ "$already" = "1" ]; then
    echo "  = $base (already applied)"
    continue
  fi
  echo "  + $base"
  if ! psql -v ON_ERROR_STOP=1 -q -X "$DATABASE_URL" -f "$f" > /tmp/apply-migration.out 2>&1; then
    echo "✗ FAILED: $base" >&2
    cat /tmp/apply-migration.out >&2
    exit 1
  fi
  psql -v ON_ERROR_STOP=1 -q "$DATABASE_URL" -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  count=$((count + 1))
done
echo "✔ applied $count migration(s) to $DBNAME"
