---
name: arch-index-orient
description: Research-orientation provider — exposes callers/callees/fan-in/definition/path queries over the arch-index SQLite index for roster-research's graph-first-then-verify protocol.
version: 1.0.0
capability: code-intel
provides: research-orientation
entry: bash orient.sh
requires_tools: [arch-index]
---

# arch-index-orient

Orientation provider for roster-research (never a QA gate — `provides` is
`research-orientation`, not `gate`). `orient.sh` emits JSON row-objects on
stdout, read-only against the SQLite index at `.arch-index/index.db` (built
by `arch-index-init` — never regenerated here).

The first content line of every successful (exit-0) invocation is the
mandatory index-freshness header:

```
<!-- index-freshness: <index.db mtime, ISO-8601 UTC> vs HEAD <commit short> -->
```

so consumers can see when the index is stale relative to HEAD before trusting
a graph hit — this is advisory only, never a gate.

## Modes

`bash orient.sh <mode> [args...]`, dispatched by `$1`:

- `callees <sym>` — symbols `<sym>` calls (`calls` rows where `caller = <sym>`).
- `callers <sym>` — symbols that call `<sym>` (`calls` rows where `callee = <sym>`).
- `fan-in` — symbols ranked by incoming-caller count (`GROUP BY callee`).
- `definition <sym>` — the `symbols` row for `<sym>` (empty array if absent).
- `path <A> <B>` — a depth-bounded path from `A` to `B` over `calls`, via a
  recursive CTE with a simple-path guard (`instr` excludes any node already on
  the walk's accumulated path) plus an explicit depth-counter cap as a
  secondary bound. `UNION` alone only dedupes identical (node, path, level)
  rows and is not sufficient for cycle safety on branching/cyclic graphs; the
  simple-path guard is what actually terminates. `A == B` returns a trivial
  zero-length result; no path returns an empty array — both exit 0, never an
  error. Bounded by a 120s timeout (coreutils `timeout`, when on PATH) on
  direct invocation too, matching the resolver's own bound.

Every result set is capped by `TOP_N`/`LIMIT` (default 10).

## Steps

1. The consumer (`scripts/code-intel-resolve.js orient <mode> [args...]`)
   invokes `bash orient.sh <mode> [args...]` from the project root.
2. Degradation checks, each a distinct exit-3 reason token on stderr,
   verdict-neutral: index DB absent → `index-missing`; neither `arch-index`
   nor `sqlite3` on PATH → `tool-missing`; the DB lacks `calls` or `symbols`
   → `schema-mismatch: <table> not found`.
3. On success, the freshness header prints first, then the mode's JSON rows.
4. This pack relies ONLY on `calls(caller, callee)` and
   `symbols(name, visibility, comment_quality_score)` — no other table or
   column is referenced, so an upstream schema change degrades gracefully
   instead of breaking.

## Trust

Same sha256 execution-ack model as `arch-index-gate`/`arch-index-audit`: the
ack hashes this file's (`SKILL.md`) bytes, not the sibling `orient.sh` —
editing `SKILL.md` invalidates the ack; editing `orient.sh` does not (accepted
pre-existing property of the shared trust model, not a new gap).
