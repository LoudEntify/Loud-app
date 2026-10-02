#!/usr/bin/env bash
# scripts/db/run-sql-tests.sh
# Runs every supabase/tests/*.sql against DATABASE_URL, each inside one
# transaction that is ROLLED BACK at the end, so tests leave no rows behind
# and can run in any order. A test fails by raising; the runner stops there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required}"
pass=0
for f in "$ROOT"/supabase/tests/*.sql; do
  name="$(basename "$f")"
  if ! { echo 'begin;'; cat "$f"; echo 'rollback;'; } | psql -v ON_ERROR_STOP=1 -q -X "$DATABASE_URL" > /tmp/sql-test.out 2>&1; then
    echo "✗ $name" >&2
    cat /tmp/sql-test.out >&2
    exit 1
  fi
  echo "✔ $name"
  pass=$((pass + 1))
done
echo "all $pass SQL test file(s) passed"
