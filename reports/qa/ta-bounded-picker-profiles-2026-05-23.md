# QA: TA Bounded Picker Profiles

## Scope

Validated loop 56 profile label bounds in the MIAOU agent picker.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- Headless coverage confirms `Codex` and `shell` remain visible in the picker.
- Headless coverage confirms a long custom profile appears as `very-long...`.
- Headless coverage confirms the picker does not reintroduce a `Status` column.

## Tmux Smoke

The manual smoke used a real tmux-backed workspace with Codex, shell, and long
custom-command agents.

Evidence:

- Selected shell-backed footer:
  `Launch fixture/runner | shell | Enter Start`
- Attached footer:
  `Launch fixture/runner | shell | Enter Refresh`
- The selected frame showed `very-long...` for the custom agent and did not show
  `very-long-custom-runtime-name` in the picker.
- Direct `tmux capture-pane` showed `loop56-profile-cap-ready`.
- `tmux list-sessions` showed the temporary session alive.
- `tmux list-panes` showed the shell pane running.

## Result

Passed.

Generated `index.json` remains unstaged.
