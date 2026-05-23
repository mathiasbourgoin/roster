# QA: TA Anchored Preview Focus

## Scope

Validated loop 48 preview-focus anchoring in the MIAOU TUI with automated
headless coverage and a manual tmux-backed smoke.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`

## Tmux Smoke

The manual smoke used a generated two-agent workspace backed by a real tmux
session. It started `smoke/lead` through `Enter`, waited for pane output, and
then drove MIAOU headless frames.

Covered cases:

- `Enter` starts and attaches the selected live agent.
- `v` plus `r` keeps focused preview for the same live agent.
- `v` plus no-op `a` keeps focused preview.
- `v` plus `Down` clears focus when selecting detached `smoke/qa`.
- `v`, `Down`, `Up` returns to normal detail instead of restoring stale focus.
- `Down`, `v`, `Up` proves detached-agent `v` does not arm hidden focus.
- `v` plus `p` clears preview focus and shows the pipeline view.

## Result

Passed.

Generated `index.json` remains unstaged.
