# TA Launch State Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- State update failure after successful launch originally left live sessions
  without an updated snapshot. `tactl launch start --state` now cleans up the
  launch-created plan sessions on state update failure and reports that cleanup.
- The new pane-id query path originally had only live QA coverage. The runtime
  now exposes an injectable runner for deterministic tests, covering attachment
  return values and cleanup after pane query failure.
- Touched OCaml files now pass `ocamlformat --check
  --enable-outside-detected-project`.
- New `launch_state` implementation and tests are tracked for the loop commit.

## Verification

- Reviewer rerun: no remaining blockers after remediation.
- `dune test`: pass.
- `dune build @all --no-print-directory`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Live tmux QA: pass.
- Root `npm test`: pass.

## Residual Risks

- Positional tmux targets still assume default `base-index` and
  `pane-base-index` settings. The next loop should discover targets from tmux
  instead of relying on those defaults.
