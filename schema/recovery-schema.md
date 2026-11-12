# Consecutive-failure recovery artifact — version 1

`scripts/roster-recovery.cjs` reads authoritative history and writes a separate local
recovery artifact. The fixed threshold is **three consecutive unsuccessful missions**.
This is independent of review's novel-finding strikes, review/QA caps, and roadmap
attempt budgets. It does not edit any of those counters.

## Sources and identity

Roadmap sources are accepted boards validated by `roster-roadmap.cjs.readBoard()`.
Identity is `{kind:"board", source:<absolute board path>, board_id,
contract_digest, task_id}`. Each source entry is `{event}` from the complete ordered
`state.events` array, with `receipt` attached to each record event in receipt order.
Selected-task blocked receipt `attempt_id`s are failures; done receipts reset the
streak. Claims and releases consume no additional failure observations. Duplicate
stored attempt IDs fail validation. Acceptance, consumed attempts, receipts and
event replay remain authoritative in the roadmap core.

Pipeline sources are the canonical append-only `briefs/<task>-state.json` ledger,
with `{task, mode, current_phase, events}` as defined in the pipeline preamble.
Identity is `{kind:"pipeline", source:<absolute ledger path>, task_id, phase,
mode}`; phase is `review` or `qa`. Each source entry is the original ledger event.
Only matching-phase `NO-GO` increments and matching-phase `GO` resets. Other phases
do neither. The observation ID is `event:<zero-based ledger index>`: rereading the
ledger does not create an observation. The ledger has no canonical attempt ID or
immutable mission digest. An operator-appended duplicate verdict is indistinguishable
from another legitimate emitted verdict; the tool cannot authenticate it or prove
that the mission definition stayed unchanged.

The source path and task/phase cannot be replaced with an arbitrary mission label.
Moving/copying a source changes identity; it is not an authorized reset of the old
mission. A revised roadmap still requires its own explicit acceptance and preserved
predecessor/budget evidence through the existing workflow.

## Artifact and decision

Default files are `<board>/recovery-<task>.json` and
`<ledger>.recovery-<phase>.json`. There is no output-path override.

```json
{
  "schema_version": 1,
  "identity": { "kind": "pipeline", "source": "/project/briefs/demo-state.json", "task_id": "demo", "phase": "review", "mode": "full" },
  "records": [
    {
      "decision": {
        "identity": { "kind": "pipeline", "source": "/project/briefs/demo-state.json", "task_id": "demo", "phase": "review", "mode": "full" },
        "source_count": 3,
        "source_digest": "<SHA-256 from current status>",
        "failure_ids": ["event:0", "event:1", "event:2"],
        "actor": "owner",
        "basis": "Reviewed the three failure reports",
        "diagnosis": "All failures share invalid fixture state",
        "changed_strategy": "Isolate the fixture before changing application code",
        "next_discriminating_check": "Run the isolated regression against the unchanged implementation",
        "evidence": ["reports/failure.txt"]
      },
      "previous_digest": null,
      "at": "2026-11-12T10:00:00.000Z",
      "record_digest": "<computed SHA-256>"
    }
  ]
}
```

The decision file contains exactly the ten `decision` fields above. Copy identity,
source_count, source_digest and failure_ids from fresh status. All narrative fields
must be nonempty, evidence and failure_ids nonempty arrays of distinct strings.
Unknown/missing decision, record or artifact fields are rejected.

`source_count` is the number of source entries. `source_digest` is SHA-256 over
canonical sorted-key JSON `{identity, entries:<complete prefix through source_count>}`,
not a digest of formatting/whitespace. `record_digest` hashes canonical
`{decision, previous_digest, at}`. The first previous digest is null; later records
point at their predecessor. Every anchor is checked against the current source
prefix and requires at least three failures since the prior anchor or matching
success. Anchor positions strictly increase. Deleted/edited source prefixes,
identity mismatches, stale decisions, broken chains and fabricated subthreshold
resets fail. Source events and old records remain present after a valid reframe.

The record is a local assertion, not a signature or authorization credential.
An operator with write access can replace both artifacts. In particular, removal
of the entire recovery file cannot be proven by this independent file; absent
reframes conservatively expose the full original failure streak again. Preserve
artifacts through the project's normal history/backup policy.

## Read shape and integration

Exports: `THRESHOLD` (3), `main(argv)`, `analyzeBoard(ctx, taskId, artifact = null)`,
and `inspectBoard(ctx, taskId)`. Obtain `ctx` from `core.readBoard(board)` first.
`analyzeBoard` is pure and accepts the complete artifact, not just its records;
`inspectBoard` additionally reads the default recovery file and validates it.
It calls only `core.canClaimBasic`, never the recovery-aware claim wrapper.

Both functions and CLI reporting return:

`status` exits 0 on valid data; `check` exits 2 for `reframe_needed`, otherwise 0.
Invalid artifacts/options/setup exit 1. Exported `main(argv)` only returns data or
throws and does not change the embedding process's exit status.

| Field | Meaning |
| --- | --- |
| `status`, `threshold` | `needs-reframe` or `within-budget`; threshold always 3 |
| `identity`, `source_count`, `source_digest` | Current identity and complete current prefix fingerprint |
| `recovery_file` | Absolute default recovery file path |
| `observations` | Ordered `{id, outcome, source_index, evidence}`; evidence is original receipt/event |
| `failure_ids`, `consecutive_failures` | Current streak since last valid reframe or matching success |
| `historical_consecutive_failures` | Streak since last matching success, disregarding reframes |
| `total_failures` | All selected-source failures, including before successes/reframes |
| `reframe_needed`, `recovery_allows_retry` | Threshold reached; its inverse (only this recovery requirement) |
| `retry_allowed`, `retry_blockers` | Board: recovery and current core claim admissibility combined; pipeline: null and external-gate reminder |
| `exhausted`, `attempts`, `max_attempts` | Board original attempt bound/count; pipeline null |
| `reconciliation_required` | Board active/blocked worker requires core reconciliation; pipeline null |
| `reframes` | All validated prior records, unchanged |
| `assurance` | Scope/authorization limitation |

`within-budget` describes only the three-failure requirement. It is not a GO
verdict, a budget refund, or permission to launch a worker. A valid reframe can be
recorded even when the attempt budget is exhausted; retry_allowed remains false.
An active or blocked roadmap worker must be reconciled through the existing core.
External child review/QA caps, stop conditions and acceptance gates still apply.

## Filesystem behavior

Status/check write nothing, including when the recovery file is absent. Reframe
uses an exclusive sibling `.lock` directory, rereads source and prior records
inside it, verifies the current decision and source again, and appends through
the core's bounded, exclusive-temporary-file, fsync/atomic-rename writer. Locks
are released on ordinary success/failure. A stale lock requires explicit owner
inspection; no automatic lock deletion is attempted. Managed symlinks and
symlink ancestors are refused, and JSON reads/writes have the core's 16 MiB bound.
Filesystem checks are local integrity checks, not an adversarial filesystem sandbox.
