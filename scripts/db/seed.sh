#!/usr/bin/env bash
# Seed synthetic shows into DATABASE_URL (local/CI). Re-runnable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL is required}"
psql -v ON_ERROR_STOP=1 -q "$DATABASE_URL" -f "$ROOT/scripts/db/seed-synthetic.sql"
