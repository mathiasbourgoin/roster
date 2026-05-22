# TA Native Pane Targeting Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- Dry-run initially omitted startup prompt side effects because prompt targets
  are only known after pane creation. `Launch_runtime.dry_run_lines` now adds an
  explicit placeholder line for each prompted agent, and `tactl launch start
  --dry-run` uses that output.
- Cleanup tests were expanded beyond first-pane parse failure. Split output
  parse failure and prompt send failure now both verify launch-created session
  cleanup.
- The CLI dry-run placeholder test was tightened to assert the exact placeholder
  line rather than a broad character match.

## Verification

- Reviewer recheck: no remaining blockers.
- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Live non-default tmux index QA: pass.

## Residual Risks

- Live QA covered one two-agent workspace with shell commands and prompts. The
  next broader runtime pass should include multi-workspace launch rollback.
