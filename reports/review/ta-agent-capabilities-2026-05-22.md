# Review: TA Agent Capabilities

## Scope

Reviewed loop 44 changes for typed TA capability metadata: parsing,
configuration, state persistence, harness projection, dashboard propagation,
MIAOU display, schema documentation, and preservation of existing ACL/start
behavior.

## Findings

- Independent review found one blocking issue in the raw working tree:
  `index.json` is modified with a lossy catalog refresh and is unrelated to
  TA capability metadata.
- Disposition: the TA loop will not stage or commit `index.json`. The file was
  already dirty/generated in the workspace and remains outside the loop 44
  commit scope.
- No blocking issues were found in the typed capability implementation.
- The reviewer confirmed that parsing/serialization, optional config support,
  legacy snapshot defaulting, state/dashboard/MIAOU propagation, and unchanged
  ACL/start behavior are covered by focused tests.

## Residual Risks

- Capability display is metadata only. Future create/connect flows must enforce
  authority through actor-aware mutation paths, not through selected-agent UI
  labels alone.
- The harness projection policy is currently hard-coded to `tech-lead` and
  `recruiter`; future harness schema work should make that policy explicit if
  it becomes user-configurable.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux smoke over the MIAOU terminal backend
- independent review of the loop diff

## Decision

Approved for loop 44 once the commit excludes `index.json`.
