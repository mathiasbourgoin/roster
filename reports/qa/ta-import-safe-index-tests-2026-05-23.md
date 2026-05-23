# QA: TA Import-Safe Index Tests

## Scope

Validated loop 57 root test behavior and TA smoke coverage.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `npm run -s build:index -- --output <tmp> --quiet`
- `git diff --check`

## Index Mutation Check

`npm test` was run with a SHA check around `index.json`.

Evidence:

- Before: `812280e92d6b2430d48966af8564b884b7c122c4c53d578f334283f012bb3766`
- After:  `812280e92d6b2430d48966af8564b884b7c122c4c53d578f334283f012bb3766`

The existing dirty generated `index.json` remains unstaged, but this loop
prevents `npm test` from changing it further.

## Tmux Smoke

The manual smoke used a real tmux-backed shell agent.

Evidence:

- Attached footer:
  `Launch fixture/runner | shell | Enter Refresh`
- Direct `tmux capture-pane` showed `loop57-import-safe-ready`.
- `tmux list-sessions` showed the temporary session alive.
- `tmux list-panes` showed the shell pane running `sleep`.

## Result

Passed.
