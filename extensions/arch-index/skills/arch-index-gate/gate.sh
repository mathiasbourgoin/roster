#!/usr/bin/env bash
# gate.sh — arch-index invariant gate (code-intel pack seam, provides: gate).
# $1 = path to the extracted code-intel JSONL block (one invariant per line).
# Exit: 0 = all pass, 1 = invariant violated, 2 = malformed/unsupported declaration,
#       3 = degraded (index/tools missing, OCaml cmt artifacts missing, helper crash).
set -u

BLOCK="${1:-}"
DB=".arch-index/index.db"

fail3() { echo "DEGRADED: $*" >&2; exit 3; }
fail2() { echo "MALFORMED: $*" >&2; exit 2; }

[ -n "$BLOCK" ] && [ -f "$BLOCK" ] || fail2 "usage: bash gate.sh <invariants.jsonl> (block file missing)"

# OCaml degradation (FR-071): dune project with no built .cmt typed-AST artifacts.
if [ -f dune-project ]; then
  shopt -s globstar nullglob
  cmts=(_build/**/*.cmt)
  shopt -u globstar nullglob
  [ ${#cmts[@]} -gt 0 ] || fail3 "cmt-artifacts-missing (run dune build)"
fi

HAVE_ARCH=0
command -v arch-index >/dev/null 2>&1 && HAVE_ARCH=1
HAVE_SQLITE=0
command -v sqlite3 >/dev/null 2>&1 && HAVE_SQLITE=1
if [ "$HAVE_ARCH" -eq 0 ] && [ "$HAVE_SQLITE" -eq 0 ]; then
  fail3 "tool-missing: neither arch-index nor sqlite3 is on PATH"
fi
[ -f "$DB" ] || fail3 "index-missing: $DB not found (run arch-index-init first)"
command -v node >/dev/null 2>&1 || fail3 "helper-missing: node is required to parse JSON declarations"

# Parse the whole JSONL block to TSV: id <TAB> limit <TAB> query. Exit 4 = malformed,
# 5 = unsupported check type (both map to gate exit 2 — defense in depth; the
# resolver pre-validates the envelope but not the pack-owned check shape).
PARSE_JS='
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/);
const out = [];
lines.forEach((raw, i) => {
  const line = raw.trim();
  if (!line) return;
  let decl;
  try { decl = JSON.parse(line); } catch (e) { console.error("line " + (i + 1) + ": malformed JSON: " + e.message); process.exit(4); }
  if (!decl || typeof decl !== "object" || Array.isArray(decl)) { console.error("line " + (i + 1) + ": declaration must be a JSON object"); process.exit(4); }
  if (decl.type !== "reachability") { console.error("line " + (i + 1) + ": unsupported check type " + JSON.stringify(decl.type) + " — arch-index-gate only supports \"reachability\""); process.exit(5); }
  const check = decl.check;
  if (!check || typeof check !== "object" || Array.isArray(check) || typeof check.query !== "string" || !check.query.trim()) { console.error("line " + (i + 1) + ": check needs a non-empty string `query`"); process.exit(4); }
  let limit;
  if (check.expect === "none") limit = 0;
  else if (Number.isInteger(check.max) && check.max >= 0) limit = check.max;
  else { console.error("line " + (i + 1) + ": check needs `expect: \"none\"` or a non-negative integer `max`"); process.exit(4); }
  const id = typeof decl.id === "string" && decl.id ? decl.id : "line-" + (i + 1);
  out.push([id, String(limit), check.query.replace(/[\t\r\n]+/g, " ")].join("\t"));
});
if (out.length) process.stdout.write(out.join("\n") + "\n");
'

# Count rows in an `arch-index query --json` JSON-array result (stdin).
COUNT_JS='
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  let rows;
  try { rows = JSON.parse(s.trim() === "" ? "[]" : s); } catch { process.exit(1); }
  if (!Array.isArray(rows)) process.exit(1);
  console.log(rows.length);
});
'

parsed=$(node -e "$PARSE_JS" "$BLOCK")
rc=$?
if [ $rc -eq 4 ] || [ $rc -eq 5 ]; then
  fail2 "invalid code-intel declaration for arch-index-gate (see message above)"
fi
[ $rc -eq 0 ] || fail3 "declaration parse helper failed (exit $rc)"

if [ -z "$parsed" ]; then
  echo "PASS: 0 invariants declared"
  exit 0
fi

violations=0
while IFS=$'\t' read -r id limit query; do
  [ -n "$id" ] || continue
  if [ "$HAVE_ARCH" -eq 1 ]; then
    rows=$(arch-index query --json "$query" 2>&1) || fail3 "arch-index query failed for $id: $rows"
    count=$(printf '%s' "$rows" | node -e "$COUNT_JS") \
      || fail3 "arch-index query --json returned non-JSON-array output for $id"
  else
    rows=$(sqlite3 "$DB" "$query" 2>&1) || fail3 "sqlite3 query failed for $id: $rows"
    count=0
    while IFS= read -r row; do [ -n "$row" ] && count=$((count + 1)); done <<< "$rows"
  fi
  if [ "$count" -gt "$limit" ]; then
    echo "VIOLATION $id: $count row(s), allowed <= $limit"
    [ -n "$rows" ] && printf '%s\n' "$rows"
    violations=1
  else
    echo "PASS $id ($count row(s), allowed <= $limit)"
  fi
done <<< "$parsed"

[ "$violations" -eq 0 ] || exit 1
exit 0
