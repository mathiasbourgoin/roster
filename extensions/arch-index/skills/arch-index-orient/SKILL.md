---
name: arch-index-orient
description: Advisory orientation queries over a provenance-checked CMT call graph.
version: 2.0.0
capability: code-intel
provides: research-orientation
entry: bash orient.sh
requires_tools: [python3]
---

# arch-index-orient

Run `bash orient.sh <callers|callees|fan-in|definition|path> [symbols]` from the
project root. A successful result starts with an index freshness header, then
a JSON array. `callers` and `callees` list observed resolved edges, `fan-in`
counts distinct observed callers, `definition` lists matching function rows,
and `path` shows one observed resolved path of at most 20 edges. Results are
capped at 10 rows; unresolved targets and `MAY_TOP` are not expanded. An empty
array means no observed result, never proof of absence.

The shared adapter supports arch-index CMT main-schema versions 1.15–1.18 only.
It checks `callgraph_contract=v1`, `arch_index_cmt` producer runs with
`sound_with_top`, row-level provenance, and edge kinds. Missing or unsupported
data exits 3 before the freshness header. Heuristic LSP indexes are unsupported.
The DB is opened read-only; this skill does not refresh it.
