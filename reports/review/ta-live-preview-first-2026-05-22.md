# Review: TA Live Preview First

## Scope

Reviewed loop 46 changes for the MIAOU selected-agent main panel ordering:
detached agents remain detail-first, while live agents show pane preview before
metadata so session output is visible sooner.

## Findings

- Independent review found no behavioral blocker.
- Review requested stronger coverage that live agents render action, preview,
  output, and detail in order. Fixed: the headless live-preview test now asserts
  that ordering.
- Review noted an accepted UI tradeoff: noisy live previews can push metadata
  below the fold because preview uses the existing `--lines` budget before the
  whole main panel is clipped.

## Residual Risks

- Live metadata is below preview by design. A future preview focus/resize mode
  should make the split explicit instead of relying only on ordering.
- Attached-but-missing panes are not treated as live by this loop; they keep
  the detail-first view until a later explicit restart/resume flow exists.
- `index.json` remains a generated unrelated working-tree diff and is not part
  of the loop 46 commit scope.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux smoke for short live preview visibility
- independent review of the loop diff

## Decision

Approved for loop 46.
