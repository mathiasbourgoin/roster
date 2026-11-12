# Roadmap duration estimates — version 1

Planner forecasts live in the optional board-local `estimates.json` sidecar. They are
local assertions, not execution authority, authenticated identities or guarantees.
Accepted `roadmap.json`, execution `state.json`, receipts and attempt budgets are not
modified. Legacy boards without this file have unknown duration and ETA.

## Update input

Use `node .harness/bin/roster-roadmap.cjs estimate BOARD --revision N --update FILE`.
`N` is the **forecast** revision: initially `0`, then the last successful forecast
revision. It is separate from the execution state's revision.

The input file has exactly these fields; a task entry has exactly the fields shown
below, with `remaining` optional. Omitted task durations remain unknown.

```json
{
  "schema_version": 1,
  "contract_digest": "<current accepted contract SHA-256>",
  "based_on_state_revision": 3,
  "writer": "planner",
  "basis": "Revisited implementation scope and integration checks",
  "evidence": ["notes/replanning.md"],
  "updated_at": "2026-12-01T12:00:00.000Z",
  "tasks": {
    "implement": {
      "duration_minutes": {"optimistic": 20, "likely": 30, "pessimistic": 50},
      "remaining": {
        "attempt_id": "<current active assignment ID>",
        "as_of": "2026-12-01T12:00:00.000Z",
        "minutes": {"optimistic": 10, "likely": 20, "pessimistic": 35}
      }
    }
  },
  "global_verification_minutes": {"optimistic": 5, "likely": 10, "pessimistic": 20}
}
```

- All ranges require finite ordered `optimistic <= likely <= pessimistic`, with
  each value between zero and 5,256,000 minutes. A missing estimate is not zero.
- `writer`, `basis` and every evidence reference are nonempty text; evidence is a
  nonempty array. State revision is a nonnegative integer equal to the current
  execution revision when updating. The contract digest must match current acceptance.
- `updated_at` and remaining `as_of` are UTC ISO timestamps. Remaining capture cannot
  be later than `updated_at`; update capture cannot be in the future.
- Task IDs must exist in the accepted contract. An optional remaining override must
  name the current active attempt. A later attempt cannot reuse that override.
- `global_verification_minutes` is required and may be `null`, meaning unknown.
  Task completion alone does not supply global-check duration or global acceptance.

## Persisted history

```json
{
  "schema_version": 1,
  "board_id": "release",
  "revisions": [
    {"revision": 1, "schema_version": 1, "contract_digest": "<sha256>", "based_on_state_revision": 3,
     "writer": "planner", "basis": "Scope revisited", "evidence": ["notes/replanning.md"],
     "updated_at": "2026-12-01T12:00:00.000Z", "tasks": {}, "global_verification_minutes": null}
  ]
}
```

Each successful update appends a complete replacement forecast record; previous records
are preserved. Revisions are contiguous starting at 1 and timestamps nondecreasing.
A backdated capture is rejected before writing; it cannot create an unreadable history.
Revised task estimates do not increment, reset or refund execution attempts. The update
refuses stale forecast revisions, invalid captures or malformed history without replacing
the previous file. The board's exclusive `.lock` serializes estimation with execution
mutations; safe ancestor checks and temporary-file atomic replacement use the core IO.
History is limited to 16 MiB UTF-8, including the complete serialized replacement. Reaching
the limit refuses a new update; preserving and explicitly archiving history is an owner
maintenance decision, not automatic trimming or a budget reset.

## Read-only forecast API

`forecast(ctx, {as_of?: UTC_ISO})` returns the following JSON structure. Production uses
the current time; the optional timestamp supplies deterministic test observations.
`update(board, {revision, update})` reads a file and returns
`{schema_version:1, revision:N, based_on_state_revision:M, updated:true}`.

```text
{
  schema_version: 1,
  as_of: UTC_ISO,
  estimate_revision: integer,              // 0 when no valid history exists
  contract_digest: SHA256,
  based_on_state_revision: integer | null,
  status: "unknown" | "conditional" | "complete", // global_eta.status
  tasks_eta: ETA,
  global_eta: ETA,
  tasks: [{
    id, status,
    duration_minutes: RANGE | null,
    remaining_minutes: RANGE | null,
    source: "completed" | "planner-duration" | "claim-time" | "planner-remaining" | null,
    overdue: boolean,
    reestimate_needed: boolean,
    reasons: [text]
  }],
  assumptions: [text]
}
ETA = {
  status: "unknown" | "conditional" | "complete",
  remaining_minutes: RANGE | null,
  finish_at: {optimistic:UTC_ISO, likely:UTC_ISO, pessimistic:UTC_ISO} | null,
  reasons: [text]
}
```

Completed tasks contribute zero remaining minutes. A completed phase has `finish_at:null`:
the forecast does not invent an actual completion timestamp. Separate global acceptance
is complete only when the execution board has its global receipt.

## Scheduling interpretation and uncertainty

The scheduler simulates optimistic, likely and pessimistic durations with deterministic
contract-order list scheduling. It respects dependencies, maximum active missions, runtime
availability, authorized parallel capability and overlapping write scopes through the core
claim-readiness function. It also observes recovery reframe blockers when the sibling
recovery module is installed. This is capacity-aware scheduling, not merely a critical-path
sum; it does not claim optimality or authorize real dispatch.
Because changed durations can change list-scheduler ordering, the displayed outer bounds
enclose all three simulated makespans; the likely value is the likely-duration run.

Queued work assumes dispatch from this observation time and successful execution without
retries, queueing outside the board, availability changes, working hours or human delays.
These finish dates are explicitly conditional. Global verification follows task completion;
there is no separate global-check start receipt, so that phase assumes dispatch then.

Active duration ages from its current claim event's timestamp, or from an explicit planner
remaining capture bound to the same attempt. Legacy missing timestamps, future starts and
foreign-attempt overrides yield unknown active ETA rather than starting a fresh countdown
on every poll. A likely overrun is marked overdue/reestimate-needed; beyond the pessimistic
bound remaining duration is unknown and the planner must revisit it. Polls do not rewrite
estimates or claim timestamps. Within the forecast range, anchored active-task finish dates
stay fixed as elapsed time increases. Elapsed lower bounds clamp at zero, visibly conditional.

Active assignment capability bindings and the currently observed assigned route must remain
valid; capability drift or unavailable/unauthorized runtime routes make its ETA unknown,
matching receipt applicability rather than predicting acceptance of an inadmissible result.
Unaccepted drafts, including filled drafts without execution task entries, also return unknown
timing and never pretend draft missions are assigned/queued or complete.

Blocked missions, exhausted attempts, unavailable routes, recovery blocks, missing required
task estimates, malformed history and stale contract estimates prevent a fabricated roadmap
finish date. Missing global duration still permits a separate task-finish estimate. Estimates
captured at earlier execution revisions remain usable as duration assertions, while current
task state/attempt identity determines applicability. An estimate captured ahead of the current
state or observation time is unusable. These estimates never weaken child pipeline gates.
