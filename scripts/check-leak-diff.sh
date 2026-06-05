#!/usr/bin/env bash
# check-leak-diff.sh — the ENFORCEMENT layer for check-leak.js.
#
# Runs the leak scanner over the files a change actually touches, with the file list derived from
# `git diff` — NOT from an agent-supplied argv. This is what makes the gate real: an automated
# upgrader (or any author) cannot narrow the scan by omitting a file, because git decides the set.
# Wire this into CI and/or a pre-land hook so a HIGH leak blocks the merge (rules/escalation.md
# "Enforcement"). check-leak.js alone only reports; this is what fails the build.
#
# Usage:  check-leak-diff.sh [base-ref]
#   base-ref defaults to the first that resolves: origin/main → main → HEAD~1.
#   Scans `git diff --name-only <base>...HEAD` (added/modified; deletions skipped).
#   Paths matching a glob in .check-leak-ignore (repo root) are skipped (e.g. the scanner's own
#   fixture file, which legitimately contains secret-shaped test strings).
# Exit:  0 = clean / nothing to scan   1 = HIGH leak in a changed file (block the merge)

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
SCANNER="scripts/check-leak.js"

# Resolve a usable base ref. Skip any candidate that resolves to HEAD itself — diffing HEAD against
# HEAD yields an empty set and would silently scan nothing (a false green, e.g. push-to-main when
# `before` is unresolvable and origin/main == HEAD). Fall through to the actual parent (HEAD~1).
base=""
head_sha="$(git rev-parse HEAD 2>/dev/null || echo HEAD)"
for c in "${1:-}" origin/main main HEAD~1; do
  [ -n "$c" ] || continue
  git rev-parse --verify --quiet "$c^{commit}" >/dev/null 2>&1 || continue
  [ "$(git rev-parse "$c^{commit}")" = "$head_sha" ] && continue
  base="$c"; break
done
if [ -z "$base" ]; then
  echo "check-leak-diff: no base ref resolved — scanning nothing (first commit / shallow clone)."
  exit 0
fi

# Changed files (exclude deletions).
mapfile -t changed < <(git diff --name-only --diff-filter=d "$base"...HEAD 2>/dev/null || true)

# Ignore globs (one per line; '#' comments and blanks skipped).
ignore=()
[ -f .check-leak-ignore ] && mapfile -t ignore < <(grep -vE '^[[:space:]]*(#|$)' .check-leak-ignore || true)

files=()
for f in "${changed[@]:-}"; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  skip=0
  for g in "${ignore[@]:-}"; do
    [ -n "$g" ] || continue
    # shellcheck disable=SC2053
    if [[ "$f" == $g ]]; then skip=1; break; fi
  done
  [ "$skip" = 1 ] && continue
  files+=("$f")
done

if [ "${#files[@]}" -eq 0 ]; then
  echo "check-leak-diff: no scannable changed files vs $base."
  exit 0
fi

echo "check-leak-diff: scanning ${#files[@]} changed file(s) vs $base"
node "$SCANNER" "${files[@]}"
