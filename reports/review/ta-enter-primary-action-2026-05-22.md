# Review: TA Enter Primary Action

## Scope

Reviewed loop 45 changes for the contextual MIAOU selected-agent primary
action: `Enter` starts detached agents, refreshes attached agents, and keeps
`s` as a guarded detached-start shortcut.

## Findings

- Independent review found no behavioral blocker in the primary action code.
- Review noted stale roadmap language that still named `s` as the normal
  startup key. Fixed: roadmap now says the normal startup path presses
  `Enter`.
- Review noted missing coverage for `Return` and `C-m` aliases. Fixed: MIAOU
  headless tests now exercise both aliases through the same detached-start
  path.
- `index.json` remains a generated unrelated working-tree diff and is not part
  of the loop 45 commit scope.

## Residual Risks

- Attached-but-missing panes currently refresh rather than restart. Restart and
  resume should remain explicit later actions.
- The `s` shortcut is intentionally still visible in key hints as a direct
  start alias; the normal path leads with `Enter`.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux smoke for harness startup, safe Enter start, second-Enter refresh, and
  narrow/short viewport visibility
- independent review of the loop diff

## Decision

Approved for loop 45.
