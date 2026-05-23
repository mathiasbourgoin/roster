# QA: TA Preview Focus Toggle

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

- MIAOU headless live-preview test now presses `v` on a real attached pane and
  asserts:
  - `Preview smoke/lead` is visible;
  - `direct-start-ready` is visible;
  - `Workspaces` is hidden;
  - `Agent detail` is hidden;
  - frame height stays within the terminal rows.
  - pressing `p` then `v` still renders the focused preview instead of pipeline
    content;
  - focused preview can consume the full terminal height when pane output has
    enough lines.

## Tmux Smoke

A disposable safe-command workspace ran inside an `80x12` tmux session:

```bash
sh -lc 'printf direct-start-ready; sleep 60'
```

Normal live capture after `Enter`:

```text
Workspaces               Enter Refresh | attached %57
Preview
direct-start-ready
Agent detail
Enter: start/refresh    v: preview
```

Preview focus capture after `v`:

```text
Enter Refresh | attached %57

Preview smoke/lead
direct-start-ready
Enter: start/refresh    v: preview
managed panes: 1
```

Preview focus capture after `p` then `v`:

```text
focus pipeline | refresh fresh
Enter Refresh | attached %67

Preview smoke/lead
direct-start-ready
focus-line-2
focus-line-3
focus-line-4
focus-line-5
managed panes: 1
```

## Notes

The focus toggle is MIAOU-local. Static dashboard rendering and socket protocol
payloads are unchanged.
