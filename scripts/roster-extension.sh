#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cli="$repo_root/dist/scripts/roster-extension.js"

# Rebuild when the dist entry is missing OR a runtime source of the CLI (the
# entry module or a scripts/extension/ module) is newer than the built entry.
# Watch set is limited to the CLI's own sources — watching all of scripts/
# would rebuild forever on unrelated or future-dated test files. mtime
# heuristic: conservative — false positives cost one rebuild, false negatives
# are limited to mtime-preserving copies.
if [ ! -f "$cli" ] || [ -n "$(find "$repo_root/scripts/roster-extension.ts" "$repo_root/scripts/extension" -name '*.ts' -newer "$cli" -print -quit 2>/dev/null)" ]; then
  npm --prefix "$repo_root" run build:ts >/dev/null
fi

exec node "$cli" "$@"
