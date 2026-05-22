# Review: TA Simple Local Start

## Scope

Reviewed loop 40 changes for direct local TUI start, automatic state bootstrap,
shared start execution, and preservation of the loop 39 socket trust model.

## Findings

- Approved by independent reviewer.
- The local direct path calls the same `Socket_api.start_agent` implementation
  used by the socket server, avoiding a split authorization/state mutation path.
- `start-agent` socket requests still carry only workspace and agent. Client
  `--config`, `--roster-index`, and `--actor` are rejected before request
  construction.
- `ta` creates `.ta-state.json` only when a config source is selected and the
  default state path does not exist.
- Successful starts now attach the pane and transition the agent status to
  `running`.

## Residual Risks

- The local direct path treats the selected agent as the actor. That is the
  right simple human-default behavior for this slice, but future multi-agent
  mediated local starts should have explicit actor selection or capability
  binding.
- Automatic state bootstrap currently writes the default `.ta-state.json` path.
  Future UX should surface that in the TUI status line rather than only making
  the file appear.
- Bootstrap uses an existence check before save, so concurrent first starts
  could race. This is not a blocker for the local human workflow but should be
  hardened later.
- The `ta` help still includes older manual `tactl state save` and
  `launch start` flows. They remain useful escape hatches, but the next UX loop
  should demote them behind the simple TUI path.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `git diff --check`
- MIAOU headless direct-start test in `ta-cli`

## Decision

Approved for loop 40.
