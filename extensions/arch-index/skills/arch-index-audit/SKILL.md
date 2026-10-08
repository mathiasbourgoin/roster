---
name: arch-index-audit
description: Advisory audit fragment from a provenance-checked CMT index.
version: 2.0.0
capability: code-intel
provides: audit-section
entry: bash audit.sh
requires_tools: [python3]
---

# arch-index-audit

Run `bash audit.sh` from the project root. The fragment begins with an index
freshness header and may include fan-in hotspots, exposed functions whose
comment quality score is below 40/100, and observed exit/panic call sites.
`value_alias` rows are excluded from caller counts because they are bindings,
not call sites. These sections are evidence for human review, not a reachability
verdict. An empty section does not prove absence.

The shared adapter supports the versioned OCaml CMT main schema (1.15–1.18)
with complete row provenance and `callgraph_contract=v1`. Missing, heuristic,
mixed, or unsupported producer data exits 3. The DB is opened read-only.
