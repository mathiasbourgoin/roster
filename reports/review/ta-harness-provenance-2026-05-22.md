# Review: TA Harness Provenance

## Scope

Reviewed loop 43 changes for preserving harness provenance in state,
propagating it to dashboard models, and rendering source/privilege information
in the MIAOU TUI.

## Findings

- Approved by independent review.
- `harness_path` is optional in state snapshots, preserving compatibility with
  snapshots created before loop 43.
- The TUI now exposes where the selected workspace came from instead of hiding
  generated harness state behind the action bar.
- The privilege summary reports existing outgoing ACL scope and does not claim
  creation authority that TA has not modeled yet.
- The independent reviewer noted that the first compact privilege label only
  showed write count when writes existed. The label now shows both read and
  write counts together.
- The snapshot roundtrip test now directly asserts restored `harness_path`.

## Residual Risks

- A stale state snapshot can preserve an older `harness_path`; future
  regeneration/update work should compare harness and generated state versions.
- Privilege display is count-based. It should become inspectable with target
  names and typed capabilities once creation/connect flows exist.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`

## Decision

Approved for loop 43.
