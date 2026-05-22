# TA Dashboard Foundation QA - 2026-05-22

## Verdict

PASS after independent QA.

## Automated Checks

- `dune runtest --no-print-directory`: pass.

## Automated Coverage

- Dashboard model totals for workspaces, agents, live panes, and blocked agents.
- Dashboard renderer includes title, workspace row, agent row, ACL summary, and
  preview panel.
- `tactl dashboard render` prints a frame from a state snapshot.
- `tactl dashboard render --width 0` is rejected.
- `ta --state STATE` prints the dashboard frame.
- `ta --state STATE --width 0` is rejected.
- Long workspace/agent ids keep every rendered line within the requested frame
  width.

## Manual Tmux Evidence

A disposable two-agent workspace was launched with `tactl launch start --state`,
then rendered with:

```text
tactl dashboard render --width 110 --lines 20 <state.json>
ta --state <state.json> --width 110 --lines 20
```

Observed result:

```text
loop18 dashboard tmux QA passed for ta-loop18-dashboard-14129-1760294
```

The smoke verified:

- The dashboard reported `live 2/2`.
- Agent rows contained `LIVE` runtime state.
- The workspace row contained `Loop 18 Dashboard`.
- The lead row exposed `R:qa W:qa`.
- The preview panel selected `loop18/lead` and contained
  `lead-dashboard-ready`.
- The `ta --state` launcher rendered the same live dashboard frame.
- Independent QA repeated the CLI checks, bad line/width validation, live tmux
  rendering, and cleanup verification with no blockers.
- The disposable tmux session and temporary files were cleaned up.
