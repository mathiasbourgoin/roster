# TA Dashboard Refresh Cadence QA - 2026-05-22

## Verdict

PASS after local QA, remediation, and independent re-QA.

## Automated Checks

- `dune runtest --no-print-directory`: pass.

## Automated Coverage

- Manual refresh overrides interval waits.
- Tick refresh waits until the configured interval.
- Tick refresh fires after the interval elapses.
- Stale dashboards are detected at the configured stale threshold.
- Automatic retries are throttled after failures.
- Cadence status lines include age and failure count.
- Invalid policy values are rejected.
- Dashboard rendering includes relative `Last refresh: 3.0s ago` metadata for
  deterministic test snapshots.

## Manual Tmux Evidence

A disposable two-agent workspace was launched with `tactl launch start --state`.
QA then ran:

```text
tactl socket serve --socket <socket> --state <state>
tactl dashboard render-socket --socket <socket> --actor lead --key r --key Down --width 110 --lines 20
```

Observed result after remediation:

```text
loop22 live tmux QA passed: relative cadence metadata and refreshed socket preview verified
```

The smoke verified:

- The rendered frame includes `Last refresh:`.
- Persistent socket refresh did not render a stale banner.
- `Down` selected the QA agent.
- The selected preview showed `Preview: loop22/qa`.
- The selected preview contained live `qa-cadence-ready` pane output.
- The disposable tmux session, socket server, and temporary files were cleaned
  up.
- Independent re-QA verified relative `Last refresh` labels, focused cadence
  tests, socket CLI behavior, live tmux rendering, redaction, bad actor and bad
  line cases, and cleanup with no findings.
