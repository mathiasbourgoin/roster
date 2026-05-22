# TA State Snapshot Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- Initial review found that `State_snapshot.of_yojson` accepted future
  `next_seq` gaps. Restore now requires `next_seq = last_audit_seq + 1`.
- The split `State_model` and `State_snapshot` modules were public after the
  refactor. They are now private Dune modules; `State_store` remains the public
  API.
- Tests now cover future `next_seq` rejection and malformed audit event
  references in addition to stale sequence and graph corruption cases.

## Verification

- Reviewer rerun: `dune build @all`, `dune runtest`, and `ocamlformat --check`
  passed.
- Reviewer result: no remaining findings or blockers.

## Residual Risks

- Snapshots are currently pure JSON values only. Filesystem save/load commands
  and daemon integration are intentionally left for a follow-up loop.
