# QA: TA Launcher Capability Powers

## Scope

Validated loop 51 capability visibility in the MIAOU launcher footer.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- MIAOU headless coverage confirms the final pinned footer line for
  `tech-lead` shows `Authority create+connect`.
- MIAOU headless coverage confirms ordinary `qa` does not show capability
  powers.

## Tmux Smoke

The manual smoke used a real tmux-backed workspace with a capability-enabled
`lead` and ordinary `qa`.

Covered cases:

- `lead` footer showed `Authority create+connect` before start.
- Enter started `lead` and the footer remained visible after attachment.
- Refresh captured `loop51-cap-ready` from the running pane.
- `qa` did not show `Authority create+connect`.

## Result

Passed.

Generated `index.json` remains unstaged.
