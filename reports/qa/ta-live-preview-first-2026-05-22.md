# QA: TA Live Preview First

## Result

Pass.

## Automated Checks

- `opam exec -- dune build @all @runtest` passed in
  `ocaml/agent-manager`.
- `opam exec -- dune build @fmt` passed.
- `opam exec -- dune build @doc` passed.
- `npm test` passed from the repository root: 32 node tests passed and 26
  source agent files passed.
- `git diff --check` passed.

## Coverage Added

- MIAOU headless live-preview test creates a real tmux pane, persists its pane
  id and identity into TA state, opens the TUI at `80x10`, and asserts:
  - frame height remains bounded;
  - `Enter Refresh | attached` is visible;
  - pane output `direct-start-ready` is visible.
  - live layout order is `Enter Refresh`, `Preview`, pane output, then
    `Agent detail`.

## Tmux Smoke

A disposable safe-command workspace ran inside an `80x10` tmux session:

```bash
sh -lc 'printf direct-start-ready; sleep 60'
```

Initial capture:

```text
TA Dashboard | 1 workspace | 1 agents | live 0 | blocked 0 | failed 0
Workspaces               Enter Start lead
Agent         smoke/lead
```

After pressing `Enter`:

```text
TA Dashboard | 1 workspace | 1 agents | live 1 | blocked 0 | failed 0
Workspaces               Enter Refresh | attached %37
Preview
direct-start-ready
managed panes: 1
```

## Notes

This loop only changes live-agent ordering in the MIAOU main panel. Detached
agents remain detail-first.
