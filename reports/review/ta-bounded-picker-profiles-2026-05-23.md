# Review: TA Bounded Picker Profiles

## Scope

Reviewed loop 56 changes that cap launch profile labels in the MIAOU picker.

## Findings And Fixes

- P2: `npm test` regenerated `index.json`, producing a large unrelated catalog
  diff. This file is not part of loop 56 and must not be staged or committed.
  The loop commit excludes it.

## Final Result

Clean for the picker change. The cap is isolated to the table label, while the
selected launch panel, detail panel, footer, and runtime launch behavior still
use the actual configured command.

## Residual Risk

The automated test checks the capped custom label in the picker, while selected
custom-profile full-command visibility is covered by code review and tmux
smoke rather than a direct assertion.

## Verified

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux-backed MIAOU smoke for capped custom picker labels, shell profile
  selection, shell pane execution, and complete `Enter Refresh`

Generated `index.json` remains unstaged.
