# Review: TA Preview Focus Toggle

## Scope

Reviewed loop 47 changes for the MIAOU-only preview focus toggle. The review
covered `v` key handling, focused preview layout, interaction with pipeline
focus, Enter behavior, and commit scope.

## Findings

- Initial review found that `p` then `v` hid the sidebar while still rendering
  pipeline content. Fixed: preview focus now wins before the focus-specific
  branch renders.
- Initial review found that focused preview still subtracted split-layout border
  rows. Fixed: focused preview bypasses the sidebar wrapper and uses the full
  body height below the header.
- Re-review found no remaining issues.
- `index.json` remains a generated unrelated working-tree diff and is not part
  of the loop 47 commit scope.

## Residual Risks

- Preview focus is local MIAOU state and is not persisted. This is intentional
  for now; future behavior should decide whether focus survives refresh or
  selection changes.
- Focused preview hides metadata by design. The normal view remains available
  by pressing `v` again.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux smoke for Enter start, `v` focus, and `p` then `v`
- independent review and re-review

## Decision

Approved for loop 47.
