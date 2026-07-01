#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cli="$repo_root/dist/scripts/roster-extension.js"

# Rebuild when the dist entry is missing OR any TypeScript source under
# scripts/ (the entry module plus the scripts/extension/ modules it re-exports)
# is newer than the built entry. mtime heuristic: conservative — false
# positives cost one rebuild, false negatives are limited to mtime-preserving
# copies.
if [ ! -f "$cli" ] || [ -n "$(find "$repo_root/scripts" -name '*.ts' -newer "$cli" -print -quit)" ]; then
  npm --prefix "$repo_root" run build:ts >/dev/null
fi

exec node "$cli" "$@"
