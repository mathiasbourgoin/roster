---
name: arch-index-gate
description: roster-qa invariant gate backed by the arch-index SQLite call-graph index — evaluates declared reachability invariants deterministically.
version: 1.0.0
capability: code-intel
provides: gate
entry: bash gate.sh
requires_tools: [arch-index]
---

# arch-index-gate

Deterministic invariant gate for roster-qa (GateExitContract, exits 0/1/2/3).
The consumer (`scripts/code-intel-resolve.js gate`) extracts the fenced
`code-intel` block from `kb/properties.md` and passes its path as `$1`; this
skill's `gate.sh` evaluates each declared invariant against the SQLite index at
`.arch-index/index.db` (built by `arch-index-init` — never rebuilt here).

## Check contract (pack-owned `check` semantics)

Only `"type": "reachability"` invariants are supported — any other type is a
malformed declaration for this pack (exit 2, naming the unsupported type).
Each check object is:

```json
{"query": "<SQL against the index>", "expect": "none"}
{"query": "<SQL against the index>", "max": 5}
```

Row-count semantics: `expect: "none"` → any returned row is a violation;
`max: N` → more than N rows is a violation. Queries run via
`arch-index query --json` when the binary is available, else directly via
`sqlite3 .arch-index/index.db`.

## Steps

1. roster-qa invokes `bash gate.sh <invariants.jsonl>` from the project root.
2. Degradation checks first (exit 3, verdict-neutral): index DB absent; both
   `arch-index` and `sqlite3` missing; OCaml project (`dune-project` present)
   with no `*.cmt` artifacts under `_build/` ("cmt-artifacts-missing (run dune build)").
3. Declarations parse (exit 2 on malformed JSON or unsupported check type —
   defense in depth; the resolver pre-validates the envelope).
4. Each invariant's query runs; violations print the invariant id plus the
   offending rows, and the gate exits 1 after evaluating all invariants.
5. All checks pass → one `PASS <id>` line per invariant, exit 0
   (zero declared invariants also exits 0).
