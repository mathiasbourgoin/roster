# Review: TA Selection Launch Panel

## Scope

Reviewed loop 53 changes to the MIAOU first-screen launch panel.

## Findings And Fixes

- Medium: the first pass routed every non-live agent through the detached
  `Launch` panel. That hid pane diagnostics for attached-but-stale agents while
  the footer still showed `Enter Refresh`. Fixed by switching the body choice to
  `pane = None` for launch mode and `pane = Some _` for preview plus
  `Agent detail`.
- Low: a generic `Launch` assertion could match the footer instead of the panel
  title. Fixed by asserting the MIAOU description title marker `★ Launch`.

## Final Result

Clean. Detached agents get the selection-first launch panel; attached agents,
including stale attached panes, keep preview and diagnostics.

## Residual Risk

The `★ Launch` test assertion is tied to the current MIAOU description-list
title marker and should be updated if the widget decoration changes.

## Verified

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux-backed MIAOU smoke for launch panel selection, complete `Enter Start`,
  live output, attached diagnostics, and complete `Enter Refresh`

Generated `index.json` remains unstaged.
