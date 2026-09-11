#!/usr/bin/env bash
# audit.sh — arch-index audit-section provider (code-intel pack seam, provides: audit-section).
# Emits a markdown fragment on stdout; first content line is the mandatory
# index-freshness header. Read-only against .arch-index/index.db.
# Exit: 0 = fragment emitted, 3 = degraded (index or tools missing).
set -u

DB=".arch-index/index.db"
TOP_N=10

fail3() { echo "DEGRADED: $*" >&2; exit 3; }

[ -f "$DB" ] || fail3 "index-missing: $DB not found (run arch-index-init first)"

HAVE_ARCH=0
command -v arch-index >/dev/null 2>&1 && HAVE_ARCH=1
HAVE_SQLITE=0
command -v sqlite3 >/dev/null 2>&1 && HAVE_SQLITE=1
if [ "$HAVE_ARCH" -eq 0 ] && [ "$HAVE_SQLITE" -eq 0 ]; then
  fail3 "tool-missing: neither arch-index nor sqlite3 is on PATH"
fi

# Render an `arch-index query --json` JSON array (stdin) as one line per row.
ROWS_JS='
let s = "";
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  let rows;
  try { rows = JSON.parse(s.trim() === "" ? "[]" : s); } catch { process.exit(1); }
  if (!Array.isArray(rows)) process.exit(1);
  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) console.log(Object.values(row).join(" | "));
    else console.log(String(row));
  }
});
'

run_query() { # $1 = SQL → rows on stdout (one per line); non-zero = no data for this section
  if [ "$HAVE_ARCH" -eq 1 ]; then
    local out
    out=$(arch-index query --json "$1" 2>/dev/null) || return 1
    command -v node >/dev/null 2>&1 || return 1
    printf '%s' "$out" | node -e "$ROWS_JS" || return 1
  else
    sqlite3 -separator ' | ' "$DB" "$1" 2>/dev/null || return 1
  fi
}

section() { # $1 = title, $2 = SQL — emitted only when the query returns data
  local rows
  if ! rows=$(run_query "$2"); then
    echo
    echo "<!-- section '$1' unavailable: query failed -->"
    return 0
  fi
  [ -n "$rows" ] || return 0
  echo
  echo "### $1"
  echo
  echo '```text'
  printf '%s\n' "$rows"
  echo '```'
}

# --- mandatory index-freshness header (first content line) -------------------
mtime=$(date -u -r "$DB" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || mtime="unknown"
head_commit=$(git rev-parse --short HEAD 2>/dev/null) || head_commit="unknown"
echo "<!-- index-freshness: $mtime vs HEAD $head_commit -->"
echo
echo "## arch-index audit section"

section "Fan-in hotspots (top $TOP_N symbols by caller count)" \
  "SELECT callee, COUNT(*) AS fan_in FROM calls GROUP BY callee ORDER BY fan_in DESC LIMIT $TOP_N"

section "Exposed and underdocumented (public symbols, low comment quality)" \
  "SELECT name, comment_quality_score FROM symbols WHERE visibility = 'public' AND comment_quality_score < 0.4 ORDER BY comment_quality_score ASC LIMIT $TOP_N"

section "Exit/panic reachability summary" \
  "SELECT caller, callee FROM calls WHERE callee IN ('exit', 'panic', 'abort') ORDER BY caller LIMIT $TOP_N"

exit 0
