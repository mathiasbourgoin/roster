# Review: TA Launcher Capability Powers

## Scope

Reviewed loop 51 changes for capability visibility in the pinned MIAOU
launcher footer.

## Findings And Fixes

- Blocker: capability text was initially reused in the `Actions` row, which
  made create/connect powers look like executable actions. Fixed by keeping
  `Actions` to start/refresh and leaving capability details in the existing
  `Capabilities` row plus the pinned footer.
- Blocker: tests originally searched the whole frame, so they could pass if the
  capability text appeared outside the footer. Fixed by asserting against the
  final rendered footer line for both privileged and ordinary agents.
- Wording note: changed `Can create+connect` to `Authority create+connect` so
  the footer reads as permission/status rather than an active keybinding.

## Final Result

Clean. Final reviewer pass found no blocking findings.

## Verified

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux-backed MIAOU smoke for authority footer visibility, Enter start, live
  refresh output, and ordinary-agent footer cleanliness

Generated `index.json` remains unstaged.
