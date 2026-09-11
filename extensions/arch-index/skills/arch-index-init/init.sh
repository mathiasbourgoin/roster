#!/usr/bin/env bash
# init.sh — arch-index index bootstrap (code-intel pack seam, provides: init).
# Builds or refreshes the SQLite call-graph + symbol index at .arch-index/index.db.
# Exit: 0 = index built/refreshed, 3 = degraded (arch-index binary missing).
set -u

DB_DIR=".arch-index"
DB="$DB_DIR/index.db"

# --- language detection by manifest files -----------------------------------
langs=""
backends=""
[ -f go.mod ] && langs="$langs go" && backends="$backends go:LSP"
[ -f Cargo.toml ] && langs="$langs rust" && backends="$backends rust:LSP"
if [ -f tsconfig.json ] || [ -f package.json ]; then
  langs="$langs typescript/javascript"
  backends="$backends typescript:LSP"
fi
if [ -f pyproject.toml ] || [ -f setup.py ] || [ -f requirements.txt ]; then
  langs="$langs python"
  backends="$backends python:LSP"
fi
[ -f dune-project ] && langs="$langs ocaml" && backends="$backends ocaml:CMT"

if [ -z "$langs" ]; then
  echo "arch-index-init: no supported language manifests detected (go.mod, Cargo.toml,"
  echo "package.json/tsconfig.json, pyproject.toml/setup.py/requirements.txt, dune-project)."
  echo "Nothing to index."
  exit 0
fi

echo "arch-index-init: detected languages:$langs"
echo "arch-index-init: backends:$backends (LSP = language-server extraction, CMT = OCaml typed-AST)"

# --- tool presence -----------------------------------------------------------
if ! command -v arch-index >/dev/null 2>&1; then
  echo "arch-index-init: DEGRADED — the 'arch-index' binary is not on PATH." >&2
  echo "Install it from github.com/epure-team/arch-index, then re-run this skill." >&2
  exit 3
fi

# --- build or refresh --------------------------------------------------------
mkdir -p "$DB_DIR"
if [ -f "$DB" ]; then
  echo "arch-index-init: existing index found — running: arch-index refresh"
  arch-index refresh || exit 3
else
  echo "arch-index-init: no index yet — running: arch-index init"
  arch-index init || exit 3
fi

echo "arch-index-init: index written to $DB"
echo "arch-index-init: note — add '.arch-index/' to .gitignore (derived local artifact, do not commit)."
echo "arch-index-init: roster-qa (gate) and roster-audit (audit-section) read this index; they never rebuild it."
exit 0
