#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cli="$repo_root/dist/scripts/roster-extension.js"

if [ ! -f "$cli" ]; then
  npm --prefix "$repo_root" run build:ts >/dev/null
fi

exec node "$cli" "$@"
