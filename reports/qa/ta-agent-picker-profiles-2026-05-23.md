# QA: TA Agent Picker Profiles

## Scope

Validated loop 55 profile visibility in the MIAOU agent picker.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- Headless coverage confirms the agent table shows `Codex` for Codex-backed
  agents.
- Headless coverage confirms selecting a shell-backed agent shows `shell` in
  the table and the footer.

## Tmux Smoke

The manual smoke used a real tmux-backed workspace with one Codex-backed agent
and one shell-backed agent.

Evidence:

- Selected shell-backed footer:
  `Launch fixture/runner | shell | Enter Start`
- Attached footer:
  `Launch fixture/runner | shell | Enter Refresh`
- The selected frame showed `runner` with profile `shell` in the agent table.
- Captured live output included `loop55-profile-ready`.
- `tmux list-sessions` showed the temporary session alive.
- `tmux list-panes` showed the shell pane running.

## Result

Passed.

Generated `index.json` remains unstaged.
