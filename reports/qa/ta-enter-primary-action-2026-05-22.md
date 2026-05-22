# QA: TA Enter Primary Action

## Result

Pass.

## Automated Checks

- `opam exec -- dune build @all @runtest` passed in
  `ocaml/agent-manager`.
- `opam exec -- dune build @fmt` passed with the existing ocamlformat
  outside-project warning behavior.
- `opam exec -- dune build @doc` passed.
- `npm test` passed from the repository root: 32 node tests passed and 26
  source agent files passed.
- `git diff --check` passed.

## Coverage Added

- MIAOU headless detached state displays `Enter Start <agent>`.
- MIAOU headless collapsed-width state keeps `Enter Start <agent>` visible.
- MIAOU headless `Enter` with direct config starts the selected agent and flips
  to `Enter Refresh | attached <pane>`.
- MIAOU headless `Enter` on an already attached selected agent refreshes and
  does not try to start without config/socket.
- MIAOU headless `s` on an already attached selected agent shows an attached
  guard and does not try to start without config/socket.
- Help and quickstart tests now assert the Enter-first startup path.

## Tmux Smoke

### Harness Startup

From the repository root, after removing ignored generated TA runtime files, an
isolated tmux session ran:

```bash
ta --tui always
```

Captured evidence:

```text
Agent         agent-roster/tech-lead
Source        harness .harness/harness.json
Privileges    reads 11 | writes 11
Capabilities  create-agent,connect-agents
Actions       Enter Start tech-lead
Enter: start/refresh
```

### Safe Enter Start

A disposable workspace used a safe command:

```bash
sh -lc 'printf direct-start-ready; sleep 60'
```

Captured after first `Enter`:

```text
Agent         smoke/lead
Status        running
Runtime       LIVE
Pane          %27
Actions       Enter Refresh | attached %27
direct-start-ready
managed panes after first Enter: 1
```

Captured after second `Enter`:

```text
Actions       Enter Refresh | attached %27
direct-start-ready
managed panes after second Enter: 1
```

### Viewport Matrix

Real tmux captures showed the primary action remains visible at:

- `80x10`: `Enter Start tech-lead` in the split dashboard.
- `39x18`: collapsed/narrow view still showed `Actions       Enter Start tech-lead`
  and the footer hint `Enter: start/refresh`.

## Notes

`index.json` is still a generated unrelated working-tree change and must not be
staged for this loop.
