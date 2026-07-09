---
name: arch-index-init
description: Build or refresh the arch-index SQLite call-graph + symbol index for this project (run before the code-intel gate or audit can operate).
version: 1.0.0
capability: code-intel
provides: init
entry: bash init.sh
requires_tools: [arch-index]
---

# arch-index-init

Builds (or refreshes) the project's arch-index database at `.arch-index/index.db` —
a SQLite call-graph + symbol index produced by the `arch-index` tool
(github.com/epure-team/arch-index). The gate (`arch-index-gate`) and audit
(`arch-index-audit`) skills only *read* this index; this skill is the sole writer.

Backend detection is automatic per detected language:

- **LSP path** — go, rust, typescript/javascript, python: the index is extracted
  through the language server (best-effort per upstream arch-index).
- **CMT path** — OCaml: the index is derived from `.cmt` typed-AST artifacts under
  `_build/` (sound; requires `dune build` to have run first).

## Steps

1. Run `bash init.sh` from the project root (consumers invoke it via the seam `entry`).
2. The script detects project languages from manifest files (`go.mod`, `Cargo.toml`,
   `package.json`/`tsconfig.json`, `pyproject.toml`/`setup.py`/`requirements.txt`,
   `dune-project`) and reports which backend applies.
3. If `.arch-index/index.db` already exists it runs `arch-index refresh`, otherwise
   `arch-index init`. Exit 3 with a clear message when the `arch-index` binary is
   missing from PATH.
4. Add `.arch-index/` to `.gitignore` — the index is a derived local artifact and
   must not be committed (the script reminds you in its output).

## When to run

- Once after installing the pack, before the first roster-qa gate or audit run.
- After significant code changes, so gate/audit read a fresh index (the audit
  fragment discloses index staleness via its freshness header; it never
  regenerates the index itself).
