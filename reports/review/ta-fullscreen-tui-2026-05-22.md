# TA Full-Screen TUI Review - 2026-05-22

## Verdict

PASS after local review, independent review, and follow-up fixes.

## Review Notes

- `ta` now has an explicit `--tui=auto|always|never` mode contract.
- Non-TTY output remains static and scriptable.
- Real terminal execution enters a Notty alternate-screen dashboard loop.
- The TUI reuses the existing `Dashboard_runner` and dashboard refresh source.
- Independent review found two implementation defects:
  - the initial loop recreated a runner per key and blocked indefinitely on
    input, dropping automatic refresh cadence;
  - the footer advertised `? help` without implementing an in-TUI help view.
- Both issues were fixed before commit:
  - the loop now keeps `Dashboard_runner.t` as state and feeds tick events via
    a 250ms `Unix.select` poll;
  - the footer only advertises implemented bindings.

## Verification

- `dune build @all`: pass.
- `dune runtest`: pass.
- `dune build @install`: pass.
- `dune test`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.
- `dune exec ta -- --tui=never --width 80`: pass.
- `dune exec ta -- --tui=always`: pass with expected non-TTY rejection.
- `dune exec ta -- --help=plain`: pass, documents `--tui=MODE`.
- Pseudo-terminal smoke through `script`: pass, captures dashboard text and
  footer, exits after `q`.
- Tmux auto-refresh QA: pass, mutating a state file while TUI runs updates the
  dashboard without pressing `r`.

## Residual Risks

- This is the first full-screen runner, not the final Herdr-grade layout. The
  next loops should replace the text-frame body with richer TUI-native panes,
  sidebar navigation, action footer, and eventual MIAOU integration.
