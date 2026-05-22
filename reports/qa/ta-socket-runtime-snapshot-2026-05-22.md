# TA Socket Runtime Snapshot QA - 2026-05-22

## Verdict

PASS after authorization remediation.

## Automated Checks

- `dune runtest --no-print-directory`: pass for `test_tactl_socket_cli`.
- Runtime snapshot unit tests cover preview long-line truncation and total
  preview byte caps.

## Automated Socket Coverage

- `runtime-snapshot` returns JSON through `tactl socket request`.
- Authorized self-read returns one workspace, one requested agent, and
  unattached pane state for a freshly saved fixture state.
- Missing `--actor` is rejected before socket connection.
- Unauthorized read (`qa` reading `lead`) is rejected by the socket API.
- `--lines 0` is rejected before socket connection.
- `--lines 201` is rejected before socket connection.
- Preview payloads are byte-capped before they are embedded in socket JSON
  responses.

## Manual Tmux Evidence

A disposable two-agent workspace was launched, served over a private Unix socket,
and queried with:

```text
tactl socket request --socket <socket> --workspace loop17 --agent lead --actor lead --lines 10 runtime-snapshot
tactl socket request --socket <socket> --workspace loop17 --agent qa --actor lead --lines 10 runtime-snapshot
```

Observed result:

```text
socket runtime snapshot tmux QA passed for ta-loop17-runtime-socket-1722993
socket runtime snapshot scoped tmux QA passed for ta-loop17-auth-588-1736477
socket runtime snapshot final tmux QA passed for ta-loop17-final-26740-1748899
loop17 scoped socket runtime snapshot cap QA passed for ta-loop17-cap-1749729
```

The smoke verified:

- Self-read returned a scoped live `lead` snapshot with `lead-ready`.
- A `lead -> qa` read edge returned a scoped live `qa` snapshot with `qa-ready`.
- `qa` reading `lead` was denied with an authorization error.
- Responses contained persisted `pane_identity` objects.
- Responses contained `live` pane-state entries.
- Independent QA verified missing actor, bad line bounds, preview byte caps, and
  no leftover loop 17 tmux sessions.
- The disposable tmux session and socket directory were cleaned up.
