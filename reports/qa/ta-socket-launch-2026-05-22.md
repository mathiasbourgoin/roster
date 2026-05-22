# TA Socket Launch QA - 2026-05-22

## Verdict

PASS.

## Automated Checks

- `dune build @all --no-print-directory`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check`: pass.
- Root `npm test`: pass.

## Automated Socket Coverage

- `launch-dry-run` through `socket serve --once`.
- Client-relative `--config` path with the server running from `/`.
- Missing `--config` rejected before socket connection.
- Missing `--actor` for `launch-start` rejected before socket connection.
- Unauthorized `launch-start --actor lead` rejected before tmux execution.
- FIFO launch config rejected as a non-regular file.

## Manual Tmux Evidence

A disposable config with two shell agents and a `lead -> qa [write]` edge was
saved to state, served through a private Unix socket, and launched with:

```text
tactl socket serve --once --socket <private>/ta.sock --state <state.json>
tactl socket request --socket <private>/ta.sock --config <config.json> --actor lead launch-start
```

Observed result:

```text
authorized socket launch-start QA passed for ta-loop15-auth-1682076
```

The smoke verified:

- `launch-start` returned `launched: 1 workspace(s), 2 agent(s)`.
- `tmux has-session -t <session>` succeeded before cleanup.
- `state show` contained native pane ids for both agents.
- The audit log contained `actor=lead pane lead: %...` and `actor=lead pane
  qa: %...` attachment events.
- The disposable tmux session and socket directory were cleaned up.

## Cleanup Failure Evidence

QA removed write permission from the state directory after socket bind and
before requesting `launch-start`. The request failed during state persistence,
returned the cleanup message, and `tmux has-session` failed afterward.

```text
socket launch cleanup QA passed for ta-loop15-cleanup-1683407
```

## Notes

Real tmux launch remains in manual QA rather than the unit suite so automated
tests stay fast and do not depend on a long-lived tmux server.
