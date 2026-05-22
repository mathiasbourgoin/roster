# TA Socket Launch Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- `launch-start` initially had no actor or authorization boundary. It now
  requires `--actor`, authorizes that actor against every launched agent using
  the existing self-write or `Permission.Write` graph, and records pane
  attachment audit events with that actor.
- Socket launch initially accepted arbitrary client-supplied paths directly in
  the serve loop. Launch config and roster index paths are now required to be
  regular files under a fixed size bound before JSON loading.
- Client-relative launch paths initially depended on the socket server CWD. The
  CLI now absolutizes `--config` and `--roster-index` before encoding launch
  requests.
- Socket client response reads initially used the short request-line timeout.
  Client response reads now use a longer timeout for launch responses while
  server request reads remain bounded.

## Review Notes

- Socket launch requests reuse the same launch planning and runtime modules as
  the CLI launch path, avoiding a divergent tmux execution path.
- `launch-start` preflights the served state snapshot and actor authorization
  before tmux execution, then applies `Launch_state.apply_attachments` after
  native pane ids are captured.
- If state update fails after tmux creation, `Launch_runtime.cleanup_plan` is
  called before returning a socket failure.
- The new CLI command builder rejects launch requests without `--config` before
  attempting a socket connection.
- Tests cover the full `tactl socket request` to socket server dry-run path,
  path absolutization, missing actor, unauthorized actor, and non-regular launch
  config rejection.

## Verification

- `dune build @all --no-print-directory`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check`: pass.
- Root `npm test`: pass.
- Manual authorized `socket serve --once` plus `launch-start` tmux smoke: pass.
- Manual state-update-failure cleanup smoke: pass.

## Residual Risks

- Long-running socket server supervision and concurrent launch requests remain
  future lifecycle hardening work.
- Launch still executes commands from client-provided workspace configs after
  actor authorization. The current boundary is the private owner-only Unix
  socket plus workspace write ACLs; any future remote or multi-user transport
  needs a stronger operator identity model.
