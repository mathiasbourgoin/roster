#!/usr/bin/env bash
# xruntime-exec.sh — standardized cross-runtime (second-model) invocation wrapper.
# Usage: ./scripts/xruntime-exec.sh <codex|opencode> "<prompt>" [--write] [--timeout <sec>] [--out <file>]
#
# Motivated by: friction cluster "cross-runtime invocation friction" (8+ occurrences —
# codex needs --skip-git-repo-check; hangs reading stdin unless </dev/null; shell wrappers
# swallow stdout unless file-redirected; manual tree-integrity snapshots around
# workspace-write runs; opencode capture timeouts). Health report 2026-07-10 P2.
# Added: 2026-07-10
#
# Behavior:
#   - stdin is closed (prevents `codex exec` interactive hang)
#   - codex: `codex exec --skip-git-repo-check`, sandbox read-only unless --write
#     (then --sandbox workspace-write); opencode: `opencode run`
#   - runtime output captured to --out file (default: mktemp), then echoed to stdout
#     (file-capture survives output-mangling shell wrappers)
#   - git tree-integrity snapshot (`git status --porcelain | sha256sum`) before/after;
#     divergence prints TREE-MUTATED on stderr and exits 3
#   - XRUNTIME_BIN overrides the runtime binary (testing hook)
#
# Exit codes: runtime's own exit code; 2 = usage error; 3 = tree mutated; 124 = timeout.
#
# Tested (2026-07-10): nominal via XRUNTIME_BIN=/bin/echo stub (exit 0, output captured &
# echoed); usage error on missing prompt (exit 2, stderr message); unknown runtime (exit 2);
# tree-mutation detection via stub touching a file (exit 3, TREE-MUTATED on stderr).
set -uo pipefail

RUNTIME="${1:-}"
PROMPT="${2:-}"
shift 2 2>/dev/null || { echo "usage: xruntime-exec.sh <codex|opencode> \"<prompt>\" [--write] [--timeout <sec>] [--out <file>]" >&2; exit 2; }

WRITE=0
TIMEOUT=480
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --write) WRITE=1 ;;
    --timeout) TIMEOUT="${2:-480}"; shift ;;
    --out) OUT="${2:-}"; shift ;;
    *) echo "xruntime-exec: unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -z "$PROMPT" ] && { echo "xruntime-exec: empty prompt" >&2; exit 2; }
[ -z "$OUT" ] && OUT="$(mktemp)"

case "$RUNTIME" in
  codex)
    CMD=("${XRUNTIME_BIN:-codex}" exec --skip-git-repo-check)
    [ "$WRITE" -eq 1 ] && CMD+=(--sandbox workspace-write)
    CMD+=("$PROMPT")
    ;;
  opencode)
    CMD=("${XRUNTIME_BIN:-opencode}" run "$PROMPT")
    ;;
  *) echo "xruntime-exec: unknown runtime '$RUNTIME' (codex|opencode)" >&2; exit 2 ;;
esac

in_repo() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }
snapshot() { git status --porcelain -uall 2>/dev/null | sha256sum | cut -d' ' -f1; }

BEFORE=""
in_repo && BEFORE="$(snapshot)"

timeout "$TIMEOUT" "${CMD[@]}" < /dev/null > "$OUT" 2>&1
RC=$?

cat "$OUT"

if in_repo && [ -n "$BEFORE" ]; then
  AFTER="$(snapshot)"
  if [ "$BEFORE" != "$AFTER" ]; then
    echo "xruntime-exec: TREE-MUTATED — the $RUNTIME run changed the working tree (before=$BEFORE after=$AFTER). Inspect 'git status' before trusting results." >&2
    exit 3
  fi
fi

exit "$RC"
