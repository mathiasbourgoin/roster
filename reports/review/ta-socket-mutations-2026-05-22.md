# TA Socket Mutations Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- Socket mutations originally trusted any local client that could reach the
  socket and only checked that the optional actor existed. Mutations now require
  an actor and authorize writes through either self-write or an explicit
  workspace `write` edge.
- Socket serving now rejects group/other-accessible parent directories and
  chmods the socket path to `0600`.
- Tests now cover missing actor, unauthorized actor, regular-file socket path
  refusal, shared-directory refusal, and final socket mode.

## Verification

- Reviewer recheck: no blockers.
- `dune test`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.

## Residual Risks

- Concurrent socket clients and long-running daemon lifecycle remain future
  hardening work.
- Supervised launch requests are not exposed over the socket yet.
