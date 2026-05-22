# TA State Mutations Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- Native tmux pane ids such as `%77` were rejected by the generic pane id
  parser. `Id.Pane` now allows `%` while keeping other id types unchanged.
- Runtime mutations originally performed an unlocked load-mutate-save cycle.
  `State_file.update` now locks a sidecar lock file around the full mutation.
- Mutation tests originally checked only summary event counts. They now assert
  persisted status, pane, and last audit kind in the saved snapshot.
- Semantic mutation failure coverage now verifies an unknown actor returns an
  error and leaves the snapshot unchanged.
- A forked regression test verifies overlapping `State_file.update` calls keep
  both mutations and all audit events.

## Verification

- Reviewer rerun: no remaining findings.
- `dune build @all`: pass.
- `dune runtest`: pass.
- `ocamlformat --check`: pass.
- `opam lint`: pass.
- `git diff --check`: pass.

## Residual Risks

- File locking is sufficient for CLI mutation commands. The future daemon/socket
  layer should centralize mutation ownership instead of treating files as the
  long-term coordination protocol.
