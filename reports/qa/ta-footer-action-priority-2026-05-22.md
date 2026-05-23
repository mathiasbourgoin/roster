# QA: TA Footer Action Priority

## Scope

Validated loop 52 footer priority for the MIAOU launcher.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- MIAOU headless coverage confirms full `Enter Start` in the launcher footer.
- MIAOU headless coverage confirms full `Enter Refresh` in the attached footer.
- MIAOU headless coverage confirms `Authority create+connect` remains visible
  for privileged harness agents and absent for ordinary QA agents.

## Tmux Smoke

The manual smoke used a real tmux-backed workspace with a capability-enabled
`lead` agent.

Evidence:

- Pre-start footer:
  `Launch smoke/lead | Authority create+connect | shell | Enter Start`
- Attached footer:
  `Launch smoke/lead | Authority create+connect | shell | Enter Refresh`
- Captured live output contained `loop52-footer-ready`.
- `tmux list-sessions` showed the temporary session alive.
- `tmux list-panes` showed the pane running `sleep`.

## Result

Passed.

Generated `index.json` remains unstaged.
