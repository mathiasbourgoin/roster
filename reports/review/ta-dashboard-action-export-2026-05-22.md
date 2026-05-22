# TA Dashboard Action Export Review - 2026-05-22

## Verdict

PASS after local review, independent review, remediation, and re-review.

## Review Notes

- The exporter derives its action list from `Dashboard_interaction` and
  `Dashboard_model.edge_affordance`, so actor redaction and write-intent gating
  stay centralized in the existing model path.
- `Dashboard_edge_affordance` serializes the GADT intent constructors directly,
  avoiding text parsing and preserving read/write capability labels.
- The new CLI commands reuse dashboard selection, key replay, and refresh
  helpers rather than creating a parallel interaction path.
- Socket-backed export uses the existing actor-scoped dashboard snapshot
  request. No new socket protocol command or mutation command was added.
- Independent review found that write-only socket targets were initially
  over-redacted before action export. This was fixed by adding
  `State_store.action_visible_to_actor`, which preserves write-only targets as
  pane-less placeholders for action inspection.
- Independent review also found that state-backed exports needed an optional
  actor to expose write intents and that action JSON needed refresh status.
  Both issues were fixed and covered by regression tests.
- The JSON schema is documented in the module interface and includes version,
  focus, refresh status, selected edge, selected target, endpoint metadata,
  target permissions, and typed action intents.

## Verification

- `dune build @all --no-print-directory`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.

## Residual Risks

- The action-visible socket view intentionally exposes write-only target agent
  ids to the source actor, but redacts pane ids and previews for those targets.
- The export schema is new. Future TUI/MCP consumers should treat version
  `0.1.0` as the compatibility boundary before depending on additional fields.
- The exporter exposes intents only; executing those intents remains future
  work and must keep the same ACL checks.
