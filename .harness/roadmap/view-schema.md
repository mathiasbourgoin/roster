# Roadmap observation contract v1

`node .harness/bin/roster-roadmap.cjs view <board> [--task ID] [--events N]`
returns one self-contained JSON document. `status <board> --format text` renders the
same observation for humans; default `status` keeps its original JSON contract.
Neither initializes, accepts, claims, verifies or launches work. Drafts are observable.

Use `view.schema.json` alongside this guide for client validation/code generation
(source: `schema/roadmap-view.schema.json`). No runtime-specific UI dependency is needed.
Generate a current sample with the read-only `view` command above; a saved observation
is a snapshot of its source board, not a transferable acceptance or execution identity.
Render imported strings, evidence references and command text as inert text, never HTML,
shell commands or instructions. Observation is local evidence, not authentication.

## Polling and completion

`schema_version: 1`, `kind: roster-roadmap-view` identify this API. `board_id`,
`contract_digest`, execution `revision` and source `version` identify its context.
`version` changes when contract, capability, execution, selected task/event limit,
current progress, recovery or forecast revision changes, including categorical forecast
changes such as overdue/re-estimation and conditional-to-unknown transitions. It excludes the
observation clock: it is a source fingerprint, not an ETag for byte-identical responses.
Recompute countdown displays from `generated_at` and `estimates.as_of`; refresh the
forecast even when source version stays unchanged. Dates are UTC.

`goal`, `phase`, `counts`, `completion`, `next_action` support the roadmap header.
`tasks` carries each task's dependency IDs, objective, intake, inputs/outputs, DoD,
success criteria, topology/model, current assignment, consumed/max attempts, blocker,
checks, last accepted result, recovery state, optional progress and duration estimate.
With `--task`, counts and dependencies remain board-wide; only task detail is filtered.
Do not infer missing dependency detail means an absent dependency.

`completion.tasks_done == tasks_total` is insufficient for completion: check
`global.accepted` / `completion.global_accepted`. Global check acceptance is a separate
receipt. `accepted` concerns the execution contract, not global success. A draft with
`contract_ready: false` is still incomplete specification.

## Evidence and bounded history

Check `accepted_status`/`accepted_evidence` come from the latest accepted local receipt;
`reported_status`/`reported_evidence` are optional worker assertions. A reported `pass`
does not satisfy an acceptance gate. `assurance` labels their source. Receipt files
and labels are not cryptographic attestations.

`recent_events` defaults to the last 10 authoritative events; `--events` permits 0–100.
`events_total` and `events_truncated` disclose omitted history. Historical events can
have `at: null`; never invent their dates. The full authoritative state remains on disk.
The response refuses beyond 2 MiB; use task focus or a smaller event limit.

## Intermediate progress

`progress.status` is `not-active`, `unreported`, `reported`, `invalid` or `unavailable`.
Only the current active assignment is observed. Invalid/stale optional data is visible
without changing authoritative execution state. To publish progress:

```sh
node .harness/bin/roster-roadmap.cjs progress roadmaps/demo --task implement \
  --attempt ATTEMPT --assignee worker --sequence 0 --update update.json
```

The update is `{ "message": "Running checks", "current_step": "Tests", "checks": [] }`.
Check entries have declared `id`, `status` (`pending`, `running`, `pass`, `fail`,
`unknown`) and an array of evidence references. Limits: message 2000 characters,
step 500, at most 30 references/check of 1000 characters each. Sequence is optimistic:
0 means no prior report; a successful write returns 1. Subsequent writes supply the
current sequence. Task/attempt/assignee, contract and capabilities must still match.

Writes serialize with board transitions using the board lock and atomically replace
`progress/TASK-ATTEMPT.json`. They never mutate acceptance, attempts, receipts or checks.
Only latest intermediate progress is retained; authoritative event history is separate.

## Forecasts

`estimates.tasks` and each task's `estimate` expose duration/remaining ranges, provenance,
overrun and re-estimation flags. `tasks_eta` forecasts tasks; `global_eta` additionally
requires an explicit global-verification duration. `conditional` means the declared
assumptions hold, `unknown` supplies reasons, and `complete` has no future finish date.
See `estimates-schema.md` and `estimates.md` for planner revisions and scheduling rules.
