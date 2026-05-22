# TA Dashboard Pipeline Topology Review - 2026-05-22

## Verdict

PASS after local and independent review.

## Review Notes

- The topology layer is pure and keeps the package free of a MIAOU dependency.
- `Dashboard_topology.node_id` is private and combines workspace plus agent,
  avoiding ambiguous cross-workspace agent ids.
- Topology edges are declared ACL edges only; `pipeline_role` prose controls
  contract state but does not infer workflow edges.
- Declared ACL edges are filtered to nodes present in the actor-visible
  dashboard model, avoiding hidden-agent leakage in socket renders.
- Initial review found one compatibility issue: `Dashboard_model.selection`
  briefly gained a required `focus` field.
- The issue was fixed by restoring `selection` to `{ workspace; agent }` and
  passing focus as a separate optional `Dashboard_model.render ?focus`
  argument.

## Verification

- `dune exec test/test_dashboard_interaction.exe --no-print-directory`: pass.
- `dune exec test/test_dashboard_model.exe --no-print-directory`: pass.
- `dune exec test/test_dashboard_topology.exe --no-print-directory`: pass.
- `dune runtest --no-print-directory`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Manual current-`tactl.exe` CLI smoke with `dashboard render --key p --key
  Down`: pass, selected `fixture/qa` and rendered `Pipeline overview [focus]`.

## Residual Risks

- Pipeline edge traversal is not implemented yet. `Left`/`Right` still keep
  their existing agent movement behavior, with source/target edge navigation
  left for the next topology iteration.
