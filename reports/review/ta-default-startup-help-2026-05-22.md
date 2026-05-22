# TA Default Startup And Help Review - 2026-05-22

## Verdict

PASS after local review, independent review, and follow-up fixes.

## Review Notes

- `ta` no longer dead-ends on missing explicit flags. It resolves default
  workspace state and config paths before falling back to quickstart guidance.
- Saved state wins over config, preserving live dashboard startup when both are
  present.
- Config-only startup now renders the dashboard with detached panes, so the UI
  opens before tmux launch.
- `tactl quickstart`, `ta --help`, and `tactl --help` expose the startup path.
- Independent review found two low issues:
  - the quickstart mixed real-workspace `.harness/ta.json` and bundled-example
    `ta.json` flows;
  - the source-tree fallback lacked automated coverage.
- Both issues were fixed before commit:
  - quickstart/help now split real workspace and bundled example flows;
  - `test_ta_cli` covers the `examples/ta.example.json` default fallback.

## Verification

- `dune build @all`: pass.
- `dune runtest`: pass.
- `dune build @install`: pass.
- `dune test`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.
- `dune exec ta -- --width 92 --height 12`: pass, renders dashboard from the
  package root.
- `dune exec tactl -- quickstart`: pass, shows real workspace and bundled
  example flows separately.
- `dune exec tactl -- tmux smoke --session ta-loop34-final-smoke`: pass.
- Bundled example copy/save/launch dry-run: pass, launch cwd remains `.` after
  copying `examples/ta.example.json` to `ta.json`.

## Residual Risks

- The current `ta` dashboard is still a terminal renderer, not the concrete
  MIAOU adapter. The next loop should focus on the full interactive TUI.
