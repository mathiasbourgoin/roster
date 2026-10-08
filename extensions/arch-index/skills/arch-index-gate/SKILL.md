---
name: arch-index-gate
description: Fail-closed code-intel gate for arch-index reachability declarations.
version: 2.0.0
capability: code-intel
provides: gate
entry: bash gate.sh
requires_tools: [python3]
---

# arch-index-gate

Run `bash gate.sh <invariants.jsonl>` from the project root. The script accepts
the existing reachability declaration envelope but returns exit 3 for every
nonempty block. SQL row counts do not prove negative reachability: an empty
result may mean an incomplete producer, an unresolved `MAY_TOP` edge, or an
unindexed source. Exit 0 is reserved for an empty block; malformed JSON or an
unsupported declaration type exits 2. No reachability verdict is emitted.

The index preflight requires arch-index's versioned main-schema OCaml CMT
producer, `callgraph_contract=v1`, `sound_with_top` provenance on every function
and edge, and valid edge kinds. A heuristic LSP database exits 3. A future gate
needs a typed reachability contract and a producer-completeness witness before
it may emit PASS for a negative claim. See
`https://gitlab.com/nomadic-labs/ai-harness/arch-index/-/work_items/1` and
`https://gitlab.com/nomadic-labs/ai-harness/arch-index/-/work_items/2`.
