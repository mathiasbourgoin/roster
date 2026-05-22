# TA Launch Plan Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- CLI launch planning originally ignored the config file directory when
  resolving relative workspace roots. `tactl launch plan` now passes
  `Filename.dirname config_path` into `Launch_plan.of_config`.
- Multi-workspace tmux targets originally used the global workspace index.
  Targets are now per workspace session as `session:0.N`.
- Planned pane IDs originally used `workspace.agent`, which could collide when
  IDs contained dots. The planner now uses `%`, which workspace and agent IDs
  cannot contain.
- Tests now cover multi-workspace metadata, dot IDs, env, startup prompts,
  config-dir cwd resolution, and roster-index failure through the CLI.

## Verification

- Reviewer rerun: no remaining code blockers.
- `dune build @all`: pass.
- `dune runtest`: pass.
- `ocamlformat --check`: pass.
- `opam lint`: pass.
- Plain and roster-aware `tactl launch plan`: pass.
- tmux smoke: pass.

## Residual Risks

- This loop plans launch metadata only. Actual supervised tmux session creation
  remains a later loop and should consume this plan rather than duplicate it.
