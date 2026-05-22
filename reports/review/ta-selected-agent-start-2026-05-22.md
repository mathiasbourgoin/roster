# Review: TA Selected Agent Start

## Scope

Reviewed loop 39 selected-agent start changes in the OCaml agent manager:
launch planning/runtime, socket protocol/API, `tactl`, `ta`, MIAOU TUI wiring,
and tests.

## Findings

- Resolved: selected-agent start uses a dedicated `Launch_runtime.run_agent_with`
  path rather than reusing whole-plan launch. This avoids refusing existing
  sessions and keeps cleanup ownership to a single pane/session.
- Resolved: `start-agent` is actor-gated through the same write ACL used for
  socket launch mutations.
- Resolved: `start-agent` no longer trusts a client-supplied config path. The
  socket server owns the trusted launch config via `tactl socket serve
  --config`, and clients can only request workspace/agent.
- Resolved: `start-agent` no longer trusts a client-supplied actor. The socket
  server binds the trusted start actor via `tactl socket serve --actor`, and
  `tactl socket request start-agent` rejects client `--actor`.
- Resolved: state preflight rejects already attached agents before launch and
  rechecks inside `State_file.update` before persisting the new pane.
- Resolved: write authorization is rechecked inside the locked state update
  before attaching the captured pane id.
- Resolved: partial launch cleanup uses `Kill_pane` when splitting into an
  existing session and `Kill_session` when creating a new session.
- Resolved: MIAOU headless idle ticks initially cleared start-action failures
  before the user could see them. The TUI now initializes the runner cadence as
  fresh and preserves cadence when replacing only the interaction state.

## Residual Risks

- `ta` still needs `--socket` for TUI start actions, and the companion socket
  server must be started with trusted `--config` and `--actor`. This is correct
  for the current state model, but the next UX loop should hide those details
  behind the app startup flow.
- Successful selected-agent start is covered by runtime unit tests and an
  isolated tmux smoke, but the CLI test suite does not yet run a full live
  socket-to-tmux success inside Alcotest.
- Status remains `not-started` after pane attachment. A later loop should decide
  whether start actions also transition status to `working`, or whether status
  stays human/agent controlled.
- Start-action failures are still represented through refresh stale state. The
  immediate MIAOU idle tick issue is fixed, but a future UI notification model
  should distinguish action feedback from periodic refresh health.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- MIAOU headless `s` key stale-action exercise
- Isolated tmux `start-agent` smoke through `tactl socket request`

## Decision

Approved for loop 39 after the TUI stale-action cadence issue was fixed and all
checks passed.
