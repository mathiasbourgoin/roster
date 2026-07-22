#!/usr/bin/env bash
# orient.sh — arch-index research-orientation provider (code-intel pack seam,
# provides: research-orientation). Modes: callers <sym> | callees <sym> |
# fan-in | definition <sym> | path <A> <B>.
# Emits JSON row-objects on stdout; first content line (exit-0 only) is the
# mandatory index-freshness header. Read-only against .arch-index/index.db.
# Relies ONLY on calls(caller,callee) and symbols(name,visibility,comment_quality_score).
# Exit: 0 = rows emitted (possibly an empty array []), 3 = degraded
#       (index/tools/schema/usage) — verdict-neutral, never a hard failure.
set -u

DB=".arch-index/index.db"
TOP_N=10
DEPTH_CAP=20
TIMEOUT_SEC=120 # matches DEFAULT_TIMEOUT_SEC in scripts/code-intel-resolve.js

fail3() { echo "DEGRADED: $*" >&2; exit 3; }

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

MODE="${1:-}"
case "$MODE" in
  callers|callees|definition)
    [ -n "${2:-}" ] || fail3 "usage: orient.sh $MODE <symbol> (symbol argument missing)"
    SYM="${2//\'/\'\'}"
    ;;
  fan-in) ;;
  path)
    [ -n "${2:-}" ] && [ -n "${3:-}" ] || fail3 "usage: orient.sh path <A> <B> (both endpoints required)"
    NODE_A="${2//\'/\'\'}"
    NODE_B="${3//\'/\'\'}"
    ;;
  *) fail3 "usage: orient.sh <callers|callees|fan-in|definition|path> [args...] (mode missing or invalid)" ;;
esac

[ -f "$DB" ] || fail3 "index-missing: $DB not found (run arch-index-init first)"

HAVE_ARCH=0
command -v arch-index >/dev/null 2>&1 && HAVE_ARCH=1
HAVE_SQLITE=0
command -v sqlite3 >/dev/null 2>&1 && HAVE_SQLITE=1
if [ "$HAVE_ARCH" -eq 0 ] && [ "$HAVE_SQLITE" -eq 0 ]; then
  fail3 "tool-missing: neither arch-index nor sqlite3 is on PATH"
fi
HAVE_TIMEOUT=0
command -v timeout >/dev/null 2>&1 && HAVE_TIMEOUT=1

# Run a SQL query, returning a JSON array on stdout (dual path: prefer
# `arch-index query --json`, else raw `sqlite3 -json`; matches audit.sh:38-47).
# Bounded by TIMEOUT_SEC (same bound the resolver applies) whenever coreutils
# `timeout` is on PATH, so direct `bash orient.sh ...` invocation is bounded
# too, not only the resolver-mediated path.
run_query() {
  local out
  local -a cmd
  if [ "$HAVE_ARCH" -eq 1 ]; then
    cmd=(arch-index query --json "$1")
  else
    cmd=(sqlite3 -json "$DB" "$1")
  fi
  if [ "$HAVE_TIMEOUT" -eq 1 ]; then
    out=$(timeout --foreground -k 5 "${TIMEOUT_SEC}s" "${cmd[@]}" 2>/dev/null) || return 1
  else
    out=$("${cmd[@]}" 2>/dev/null) || return 1
  fi
  [ -n "$out" ] && printf '%s' "$out" || printf '[]'
}

table_count() { # $1 = table name -> row count of a "SELECT 1" probe, or empty on failure
  if [ "$HAVE_ARCH" -eq 1 ]; then
    arch-index query --json "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='$1'" 2>/dev/null \
      | grep -o '"n":[0-9]*' | grep -o '[0-9]*$'
  else
    sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$1'" 2>/dev/null
  fi
}

# Table-presence probe (FR-004/FR-022): rely ONLY on the two observable tables.
for _table in calls symbols; do
  n=$(table_count "$_table")
  case "$n" in
    ''|*[!0-9]*|0) fail3 "schema-mismatch: $_table not found" ;;
  esac
done

# --- mandatory index-freshness header (first content line, exit-0 path only) --
mtime=$(date -u -r "$DB" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || mtime="unknown"
head_commit=$(git rev-parse --short HEAD 2>/dev/null) || head_commit="unknown"
echo "<!-- index-freshness: $mtime vs HEAD $head_commit -->"

case "$MODE" in
  callees)
    run_query "SELECT DISTINCT callee FROM calls WHERE caller = '$SYM' ORDER BY callee LIMIT $TOP_N" \
      || fail3 "query failed for mode callees"
    ;;
  callers)
    run_query "SELECT DISTINCT caller FROM calls WHERE callee = '$SYM' ORDER BY caller LIMIT $TOP_N" \
      || fail3 "query failed for mode callers"
    ;;
  fan-in)
    run_query "SELECT callee, COUNT(*) AS fan_in FROM calls GROUP BY callee ORDER BY fan_in DESC LIMIT $TOP_N" \
      || fail3 "query failed for mode fan-in"
    ;;
  definition)
    run_query "SELECT name, visibility, comment_quality_score FROM symbols WHERE name = '$SYM' LIMIT 1" \
      || fail3 "query failed for mode definition"
    ;;
  path)
    if [ "$NODE_A" = "$NODE_B" ]; then
      # Same-node request: trivial zero-length path, never an error (FR-011).
      # json_escape the raw (unescaped) $2, not the SQL-escaped NODE_A — NODE_A
      # already had its quotes doubled for SQL and must not be escaped again.
      printf '[{"path":"%s","level":0,"note":"same-node"}]' "$(json_escape "$2")"
    else
      # Recursive CTE with a simple-path guard: the accumulated `path` column
      # is per-walk, so plain UNION only dedupes identical (node, path, level)
      # rows — it does NOT stop a branching/cyclic graph from re-deriving the
      # same node down countless distinct paths (exponential blowup). The
      # `instr(...) = 0` predicate below excludes any callee already present
      # on the walk's accumulated path, enforcing a simple path per row; the
      # depth cap remains as a secondary bound.
      run_query "WITH RECURSIVE walk(node, path, level) AS (
        SELECT '$NODE_A', '$NODE_A', 0
        UNION
        SELECT c.callee, walk.path || '->' || c.callee, walk.level + 1
        FROM calls c JOIN walk ON c.caller = walk.node
        WHERE walk.level < $DEPTH_CAP
          AND instr('->'||walk.path||'->', '->'||c.callee||'->') = 0
      )
      SELECT path, level FROM walk WHERE node = '$NODE_B' ORDER BY level ASC LIMIT 1" \
        || fail3 "query failed for mode path"
    fi
    ;;
esac

exit 0
