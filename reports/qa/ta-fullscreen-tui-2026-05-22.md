# TA Full-Screen TUI QA - 2026-05-22

## Verdict

PASS after automated checks, pseudo-terminal smoke, independent QA, and
auto-refresh verification.

## Automated Checks

- `dune build @all`: pass.
- `dune runtest`: pass.
- `dune build @install`: pass.
- `dune test`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.

## Automated Coverage

- Non-TTY `ta` keeps rendering a static dashboard under `--tui=auto`.
- `ta --tui=never` forces a static dashboard.
- `ta --tui=always` rejects non-terminal execution with a clear error.
- `ta --help=plain` documents `--tui=MODE`.

## Manual TTY Evidence

Pseudo-terminal smoke with `script`:

```text
dune exec ta -- --tui always --width 80
```

Observed:

- alternate-screen TUI emitted `TA Dashboard | workspaces 1 | agents 2`;
- footer showed `q quit | arrows move | p pipeline | [ ] targets | r refresh`;
- footer did not advertise unimplemented `? help`;
- sending `q` exited cleanly.

Auto-refresh QA:

- Started `ta --state <temp-state> --tui always` in a tmux PTY.
- Mutated the served state file while the TUI was running without pressing
  `r`.
- Waited more than the 2s default refresh interval.
- Captured output showed the agent status changed to `running`.
- Sent `q` and verified the tmux session exited and no `ta-loop35-*` sessions
  remained.
