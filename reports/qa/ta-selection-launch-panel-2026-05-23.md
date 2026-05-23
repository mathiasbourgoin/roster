# QA: TA Selection Launch Panel

## Scope

Validated loop 53 detached-agent launch panel behavior in the MIAOU TUI.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- MIAOU headless coverage confirms detached agents show a `Launch` panel with
  workspace, selected agent, roster agent, profile, authority, privileges,
  capabilities, and connections.
- MIAOU headless coverage confirms Right/Down updates the launch panel and
  pinned footer.
- MIAOU headless coverage confirms attached agents keep preview plus
  `Agent detail` and full `Enter Refresh`.

## Tmux Smoke

The manual smoke used a real tmux-backed two-workspace config.

Evidence:

- Initial footer:
  `Launch fixture/lead | shell | Enter Start`
- After Right and Down:
  `Launch docs/editor | shell | 'sh' '-lc' 'printf loop53-editor-ready; sleep 60' | Enter Start`
- Attached footer:
  `Launch docs/editor | shell | Enter Refresh`
- The attached frame contained `loop53-editor-ready`.
- `tmux list-sessions` showed `ta-loop53-launch-...-docs`.
- `tmux list-panes` showed the selected editor pane running.

## Result

Passed.

Generated `index.json` remains unstaged.
