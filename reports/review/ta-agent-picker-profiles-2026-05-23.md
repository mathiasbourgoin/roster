# Review: TA Agent Picker Profiles

## Scope

Reviewed loop 55 changes that expose configured launch profiles in the MIAOU
agent picker.

## Findings And Fixes

- Medium: the first pass added `Profile` as a third table column while keeping
  `Status`, which clipped the table into the launch panel at normal terminal
  widths. Fixed by making the picker a compact `Agent` plus `Profile` table;
  selected status remains in the launch/detail panel.

## Final Result

Clean. The picker shows the launch profile that Enter will actually run without
pretending to offer a runtime selector.

## Residual Risk

Long custom executable names can still widen the profile column because the
MIAOU table does not have profile-specific column caps.

## Verified

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux-backed MIAOU smoke for shell profile selection, complete `Enter Start`,
  live output, and complete `Enter Refresh`

Generated `index.json` remains unstaged.
