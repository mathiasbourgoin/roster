#!/usr/bin/env bash
# Build a CMT main-schema index only when all producer inputs are explicit.
set -u

degraded() { echo "DEGRADED: $*" >&2; exit 3; }
[ -f dune-project ] || degraded "unsupported-backend: only OCaml CMT is adapted; LSP indexes have heuristic coverage"
command -v arch-callgraph-ocaml >/dev/null 2>&1 || degraded "tool-missing: arch-callgraph-ocaml"
[ -n "${ARCH_INDEX_SCHEMA_PATH:-}" ] && [ -f "$ARCH_INDEX_SCHEMA_PATH" ] || degraded "schema-path-missing: set ARCH_INDEX_SCHEMA_PATH to arch-index/architecture-schema.sql"
[ -d _build/default ] || degraded "cmt-artifacts-missing: run dune build"
shopt -s globstar nullglob
cmts=(_build/default/**/*.cmt)
shopt -u globstar nullglob
[ ${#cmts[@]} -gt 0 ] || degraded "cmt-artifacts-missing: run dune build"
mkdir -p .arch-index
tmp=$(mktemp .arch-index/index.XXXXXX.db) || degraded "temporary-index-create-failed"
trap 'rm -f "$tmp"' EXIT
arch-callgraph-ocaml --build-dir=_build/default --db-path="$tmp" --schema-path="$ARCH_INDEX_SCHEMA_PATH" || degraded "cmt-producer-failed"
# Check the exact output before installing it as the index consumers read.
ARCH_INDEX_DB_PATH="$tmp" python3 "$(dirname "$0")/../arch-index-gate/adapter.py" inspect >/dev/null || degraded "cmt-index-validation-failed"
mv -f "$tmp" .arch-index/index.db || degraded "index-install-failed"
trap - EXIT
echo "arch-index-init: CMT index written to .arch-index/index.db"
