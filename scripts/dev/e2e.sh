#!/usr/bin/env bash
# scripts/dev/e2e.sh — the whole viewer experience, end to end, locally:
#   1. migrations from scratch + synthetic seed into DATABASE_URL
#   2. the local Supabase stand-in (PostgREST + fake auth) on :54321
#   3. the Next.js app (production build, `next start`) on :3000
#   4. tests/e2e/{viewer,artist,site}.e2e.mjs in headless Chromium
# Everything is torn down at the end. Exit code is the test result.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/loudentify_e2e}"
export NEXT_PUBLIC_PLAYER_SOURCE_OVERRIDE=""
export NEXT_PUBLIC_KITCHECK_HOLD_MS="${NEXT_PUBLIC_KITCHECK_HOLD_MS:-4000}"   # two minutes in real life; seconds in the suite
export YOUTUBE_TOKEN_KEY="${YOUTUBE_TOKEN_KEY:-local-only-youtube-token-key-for-the-e2e-suite-0000}"
rm -rf .cache/egress
PORT="${PORT:-3000}"
# Refuse to run against a server we did not start (a stale one answers the
# health check and every result would be about the wrong build).
if curl -sf --max-time 2 "http://localhost:$PORT/api/build-info" > /dev/null 2>&1; then echo "something is already listening on :$PORT; stop it first"; exit 1; fi
if curl -sf --max-time 2 http://localhost:54321/health > /dev/null 2>&1; then echo "a local stack is already on :54321; stop it first"; exit 1; fi

scripts/db/apply-migrations.sh --fresh > /tmp/e2e-migrate.log 2>&1 || { cat /tmp/e2e-migrate.log; exit 1; }
scripts/db/seed.sh > /tmp/e2e-seed.log 2>&1 || { cat /tmp/e2e-seed.log; exit 1; }
scripts/dev/fetch-postgrest.sh > /tmp/e2e-pgrst.log 2>&1 || { cat /tmp/e2e-pgrst.log; exit 1; }

node scripts/dev/local-stack.mjs --write-env > /tmp/e2e-stack.log 2>&1 &
STACK_PID=$!
cleanup() { kill $STACK_PID 2>/dev/null || true; kill ${APP_PID:-0} 2>/dev/null || true; pkill -f '.cache/postgrest' 2>/dev/null || true; }
trap cleanup EXIT
for i in $(seq 1 30); do curl -sf http://localhost:54321/health > /dev/null && break; sleep 1; done
curl -sf http://localhost:54321/health > /dev/null || { echo "local stack did not start"; cat /tmp/e2e-stack.log; exit 1; }

set -a; . ./.env.local; set +a
if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then npx next build > /tmp/e2e-build.log 2>&1 || { tail -40 /tmp/e2e-build.log; exit 1; }; fi
npx next start -p "$PORT" > /tmp/e2e-app.log 2>&1 &
APP_PID=$!
for i in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/build-info" > /dev/null && break; sleep 1; done
curl -sf "http://localhost:$PORT/api/build-info" > /dev/null || { echo "app did not start"; tail -40 /tmp/e2e-app.log; exit 1; }

# A preinstalled Chromium (this sandbox: /opt/pw-browsers/chromium) is used when present;
# otherwise Playwright's own download (CI runs `npx playwright install chromium`).
if [ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium; fi
# E2E_SUITES="site" runs one suite while iterating; default is all three in order.
for suite in ${E2E_SUITES:-viewer artist site}; do
  BASE_URL="http://localhost:$PORT" NEXT_PUBLIC_KITCHECK_HOLD_MS=4000 node "tests/e2e/$suite.e2e.mjs"
done
