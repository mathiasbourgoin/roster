# TA State Store Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- `State_store.of_config` originally accepted any parsed config. It now returns
  `result` and rejects configs with `Workspace_config.validate` errors.
- Audit actors were originally recorded without membership checks. State
  transitions now reject unknown `Some actor`; `None` remains the system actor.
- Audit tests originally checked only event counts. They now verify event order,
  sequence numbers, actors, and payload variants.

## Verification

- `dune build @all`: pass.
- `dune runtest`: pass, 18 core tests and 3 command tests.
- `git diff --check`: pass.

## Residual Risks

- The store is in-memory only. Persistence and replay are intentionally left for
  the next loop.
