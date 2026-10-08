---
name: arch-index-init
description: Build and validate an OCaml CMT main-schema index for advisory code-intel.
version: 2.0.0
capability: code-intel
provides: init
entry: bash init.sh
requires_tools: [arch-callgraph-ocaml, python3]
---

# arch-index-init

From an OCaml Dune project root, run `dune build`, set
`ARCH_INDEX_SCHEMA_PATH` to arch-index's `architecture-schema.sql`, and run
`bash init.sh`. The script invokes `arch-callgraph-ocaml` on `_build/default`,
validates its temporary output through the shared adapter, then installs
`.arch-index/index.db`. It exits 3 for missing inputs, a failed producer, or an
unsupported schema. The old `arch-index init` invocation was not a command
supported by the installed CLI.

The CMT database is an advisory index. Successful indexing does not itself
prove that every intended source was compiled into the selected build tree.
Heuristic LSP backends are unsupported by this adapter, including negative
reachability gates.
