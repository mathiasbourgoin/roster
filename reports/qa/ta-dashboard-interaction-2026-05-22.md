# TA Dashboard Interaction QA - 2026-05-22

## Verdict

PASS after independent QA.

## Automated Checks

- `dune runtest --no-print-directory`: pass.

## Automated Coverage

- Initial selection chooses the first workspace and first agent.
- Agent navigation wraps through `Down`.
- Workspace navigation works after focus toggles with `Tab`.
- Refresh intent is tracked and refresh preserves selected ids.
- Selected preview rendering uses the selected agent.
- `tactl dashboard render --key Down` selects the QA preview.
- `ta --state ... --key Down` selects the QA preview.
- Explicit `--workspace` and `--agent` selection works in both CLIs.
- Bad workspace and agent ids return exit 2 with validation errors.

## Manual Tmux Evidence

A disposable two-agent workspace was launched with `tactl launch start --state`,
then rendered with key replay:

```text
tactl dashboard render --width 110 --lines 20 --key Down <state.json>
ta --state <state.json> --width 110 --lines 20 --key Down
```

Observed result:

```text
loop19 dashboard interaction tmux QA passed for ta-loop19-interaction-25164-1780100
```

The smoke verified:

- `Down` selected the QA agent.
- The selected row marker moved to the QA row.
- The preview panel changed to `Preview: loop19/qa`.
- The selected preview contained live `qa-interaction-ready` output.
- The `ta --state` launcher rendered the same selected live preview.
- Independent QA repeated static CLI checks, explicit selection, bad id
  handling, live tmux rendering, and cleanup verification with no blockers.
- The disposable tmux session and temporary files were cleaned up.
