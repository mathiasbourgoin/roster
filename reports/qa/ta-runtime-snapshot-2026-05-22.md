# TA Runtime Snapshot QA - 2026-05-22

## Verdict

PASS.

## Automated Checks

- Independent QA recheck: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check`: pass.
- Root `npm test`: pass.

## Automated Runtime Coverage

- Live pane capture with injected tmux runner.
- Missing pane capture after tmux failure.
- Stale pane identity mismatch rejection before preview capture.
- Unattached agent snapshots.
- Exact JSON fields for `captured_at`, `expected_session`, pane id, pane-state
  kind/message, preview lines, and unattached `pane = null`.
- CLI stdout JSON.
- CLI output-file JSON and mode `0600`.
- CLI rejection for `--lines 0` and values above the cap.

## Manual Tmux Evidence

A disposable two-agent workspace was launched with `tactl launch start --state`,
then observed with:

```text
tactl runtime snapshot --lines 10 --output <runtime.json> <state.json>
```

Observed result:

```text
runtime snapshot pane-identity tmux QA passed for ta-loop16-identity-1711474
manual tmux smoke: loop16 final tmux QA passed for ta-loop16-final-1716792
```

The smoke verified:

- The runtime summary reported `1 workspace(s), 2 agent(s), 2 live pane(s)`.
- The JSON cache contained both `lead-ready` and `qa-ready` pane previews.
- The JSON cache contained live pane-state entries.
- The state snapshot and runtime cache contained native tmux pane identities.
- The output cache file mode was `0600`.
- The disposable tmux session and temporary files were cleaned up.

## Notes

The tmux smoke polls briefly before asserting preview text, because a launch can
produce live panes before shell startup output has appeared.
