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
curl -sSL -o "$ROOT/.cache/postgrest.tar.xz" "$URL"
tar -xJf "$ROOT/.cache/postgrest.tar.xz" -C "$ROOT/.cache"
chmod +x "$DEST"
"$DEST" --version
