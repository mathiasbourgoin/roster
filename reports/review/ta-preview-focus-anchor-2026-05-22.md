# Review: TA Anchored Preview Focus

## Scope

Reviewed loop 48 changes for MIAOU preview-focus lifetime:
`ta_tui.ml`, headless CLI coverage, roadmap note, and iteration report.

## Findings

- Initial review found key-name-based clearing could drop preview focus for
  no-op keys even when the selected live agent and view had not changed. Fixed:
  page state now reconciles against the post-key anchored live
  workspace/agent/focus instead.
- Initial review found missing coverage for pressing `v` on a detached agent.
  Fixed: headless MIAOU coverage now proves detached `v` does not arm hidden
  focus that later appears when returning to a live agent.
- Re-review found no blocking issues.

## Residual Risks

- There is no separate headless case for a `Missing _` pane. The implementation
  shares the detached no-arm path by refusing to create an anchor unless the
  selected runtime state is `Live`.
- Preview focus remains MIAOU-local and intentionally non-persistent.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux smoke for start, focus refresh, no-op key preservation, move clearing,
  stale-return clearing, detached no-arm, and pipeline clearing
- independent review and re-review

## Decision

Approved for loop 48.
