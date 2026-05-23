# QA: TA Navigation Sidebar

## Scope

Validated loop 54 MIAOU sidebar simplification.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- Headless coverage confirms the harness start action is owned by the final
  footer line and `Enter Start tech-lead` is no longer duplicated in the body.
- Headless coverage confirms attached stale agents keep preview plus
  `Agent detail`.

## Tmux Smoke

The manual smoke used a real tmux-backed workspace with one shell agent.

Evidence:

- Detached footer:
  `Launch fixture/lead | shell | Enter Start`
- Detached launch frame did not contain duplicate `Enter Start lead`.
- Attached footer:
  `Launch fixture/lead | shell | Enter Refresh`
- Attached frame showed `Runtime LIVE`, pane id, and `Agent detail`.
- Captured live output included `loop54-sidebar-ready`.
- `tmux list-sessions` showed the temporary session alive.
- `tmux list-panes` showed the pane running `sleep`.

## Result

Passed.

Generated `index.json` remains unstaged.
