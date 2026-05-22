# TA Dashboard Focused Edge Affordances Review - 2026-05-22

## Verdict

PASS after independent review and remediation.

## Review Notes

- The new `Dashboard_edge_affordance` module is pure and keeps socket-safe
  future UI actions as typed intents, not raw tmux commands.
- Edge affordances are derived from the actor-visible `Dashboard_model.t`, so
  hidden targets are filtered before source/target metadata and action lines are
  built.
- `Dashboard_topology.render ~selected` remains source-compatible with the
  loop 28/29 public API.
- Initial review found one Medium issue: write affordances were visible for any
  writable edge in the redacted model, even when the requesting actor was not
  the edge source.
- Initial review found two Low issues: affordances remained visible after
  leaving Pipeline focus, and rendered read intents used the default line count
  instead of the dashboard `--lines` value.
- The issues were fixed by passing optional actor and line-count context through
  `Dashboard_model.render`, `Dashboard_interaction.render`, `ta`, and `tactl`;
  suppressing write actions unless `actor = edge source`; and gating focused
  edge affordances to Pipeline focus.
- Independent re-review reported no blocking findings.

## Verification

- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `ocamlformat --check ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Reviewer CLI smoke verified requested `--lines` intent rendering and hidden
  affordance/action lines after `Tab`.

## Residual Risks

- `Future_agent_message` is still an intent description only; the actual
  mutation/socket write endpoint remains future work.
