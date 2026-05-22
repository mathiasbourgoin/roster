# TA Dashboard Socket Refresh QA - 2026-05-22

## Verdict

PASS after local QA, reviewer blocker remediation, and independent re-QA.

## Automated Checks

- `dune runtest --no-print-directory`: pass.

## Automated Coverage

- `Dashboard_snapshot` returns runtime previews scoped to the requesting actor.
- `lead` can see self plus `qa` through a read link.
- `qa` can see only self in both saved state and runtime when no reverse read
  link exists.
- Redacted dashboard snapshots omit audit events.
- Oversized dashboard preview payloads are capped before socket serialization.
- Snapshot JSON round-trips through `of_yojson`.
- Unknown actors are rejected.
- `tactl socket request dashboard-snapshot` requires `--actor`.
- Unknown actor requests fail through the socket API.
- `tactl dashboard render-socket --key Down` renders the QA preview.

## Manual Tmux Evidence

A disposable two-agent workspace was launched with `tactl launch start --state`,
served through `tactl socket serve --once`, and rendered with:

```text
tactl dashboard render-socket --socket <socket> --actor lead --key Down --width 110 --lines 20
```

Observed result after remediation:

```text
loop20 live tmux QA passed: render-socket preview plus state/runtime redaction verified
```

The smoke verified:

- The socket-backed dashboard rendered `TA Dashboard`.
- `Down` selected the QA agent.
- The selected preview panel changed to `Preview: loop20/qa`.
- The selected preview contained live `qa-socket-dashboard-ready` output.
- The QA actor `dashboard-snapshot` response contained only the QA state agent
  and only the QA runtime agent.
- The QA actor `dashboard-snapshot` response contained no audit events.
- The disposable tmux session and socket directory were cleaned up.
- Independent re-QA repeated focused tests and live tmux smoke, including bad
  actor and bad line cases, and found no leftover loop 20 sessions.
