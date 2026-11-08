#!/usr/bin/env bash
# Downloads the PostgREST static binary into .cache/ (gitignored) for the
# local end-to-end stack (scripts/dev/local-stack.mjs). Pinned version.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${POSTGREST_VERSION:-v13.0.4}"
DEST="$ROOT/.cache/postgrest"
if [ -x "$DEST" ] && "$DEST" --version 2>/dev/null | grep -q "${VERSION#v}"; then
  echo "postgrest $VERSION already present at $DEST"; exit 0
fi
mkdir -p "$ROOT/.cache"
URL="https://github.com/PostgREST/postgrest/releases/download/$VERSION/postgrest-$VERSION-linux-static-x86-64.tar.xz"
echo "▶ downloading $URL"
# --fail, and say so when it fails.
#
# This was `curl -sSL` with no --fail, so a 404 or a 502 wrote the error
# page into postgrest.tar.xz and the next line reported "xz: (stdin):
# File format not recognized / tar: Child returned status 1". On
# 8 November that sent me looking for a corrupt archive when GitHub
# releases had simply returned an error body. A download that fails
# should say the download failed.
#
# Three attempts, because this is a transient fetch in a test harness
# and a single flake should not cost a whole e2e run.
for attempt in 1 2 3; do
  if curl --fail --silent --show-error --location --retry 2 --retry-delay 3 \
       -o "$ROOT/.cache/postgrest.tar.xz" "$URL"; then
    break
  fi
  if [ "$attempt" = 3 ]; then
    echo "could not download postgrest $VERSION from $URL" >&2
    echo "the e2e stack needs it; this is a network or an upstream-release problem, not a test failure" >&2
    exit 1
  fi
  echo "attempt $attempt failed; retrying" >&2
  sleep $((attempt * 5))
done
tar -xJf "$ROOT/.cache/postgrest.tar.xz" -C "$ROOT/.cache"
chmod +x "$DEST"
"$DEST" --version
