# TA Dashboard Refresh Loop QA - 2026-05-22

## Verdict

PASS after local and independent QA.

## Automated Checks

- `dune runtest --no-print-directory`: pass.

## Automated Coverage

- Dashboard interaction starts fresh.
- `r` marks refresh as requested and refreshing.
- Successful refresh clears refresh status and preserves selection.
- Failed refresh clears the request and renders `Refresh: STALE - ...`.
- Socket refresh fetcher handles success, socket failure responses, invalid
  JSON, and dashboard snapshot decode errors.
- `tactl dashboard render-socket --key r` renders stale output when a follow-up
  refresh fails after the initial snapshot.

## Manual Tmux Evidence

A disposable two-agent workspace was launched with `tactl launch start --state`.
QA then ran:

```text
tactl socket serve --socket <socket> --state <state>
tactl dashboard render-socket --socket <socket> --actor lead --key r --key Down --width 110 --lines 20
```

Observed result:

```text
loop21 live tmux QA passed: successful socket refresh and stale fallback verified
```

The smoke verified:

- Persistent socket refresh cleared the refresh banner.
- `Down` selected the QA agent after refresh.
- The selected preview showed `Preview: loop21/qa`.
- The selected preview contained live `qa-refresh-ready` pane output.
- A one-shot socket server produced a stale refresh banner while still
  rendering the previous dashboard frame.
- The disposable tmux session, socket server, and temporary files were cleaned
  up.
- Independent QA repeated focused refresh tests, socket CLI tests, live tmux
  refresh and stale smokes, bad actor and bad line cases, redaction checks, and
  cleanup verification with no findings.
