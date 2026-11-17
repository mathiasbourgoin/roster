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

## Operator requests

`operator_requests` (top level, optional for older saved views) exposes the advisory annex
`requests.json`; each task carries `requests`, the IDs of its open requests. The contract is
in `requests-schema.md` (source: `schema/roadmap-requests-schema.md`). The block is board-wide:
`--task` does not filter it.

- `status` is `absent` (no file, revision 0), `valid` or `invalid`. An invalid annex (corrupt,
  symlinked, foreign board, bad revision, over a count or length limit) never makes `view`,
  `status` or `prompt` fail:
  `reason` says why and every request command refuses until the file is repaired by hand. A
  programming error while building the block also renders as `invalid`, with a reason
  starting `internal error:`, so it is not mistaken for a damaged file.
- `counts = {open, now, later, unscheduled, answered, withdrawn, archived}`; `open` is the sum
  of the three due buckets, `answered` and `withdrawn` are file totals, `archived` counts
  closed requests bound to a done task (FR-015); closed items dropped only to fit the size
  budget are not archived and are signalled by `truncated: true`.
- `items` lists every open request first, ordered by due (`now`, `later`, `unscheduled`), then
  `created_at`, `id`; then closed requests by `closed_at` descending. Closed requests bound to
  a done task are archived (an answered request stays visible until its mission is done; an
  unbound one stays). Each item is the stored record plus `due`, `task_state` (`unknown` when
  the task left a draft contract, `draft` on drafts), `closed_at` and `superseded_by`. If the
  block exceeds 512 KiB, closed items are dropped oldest first and `truncated` is `true`; open
  items are never dropped while they fit (writes keep them within the budget). Only a
  hand-edited annex can carry more open items than fit: the leading open items that fit are
  kept, `truncated` is `true` and counts stay exact.
- `journal` is an inert reference to the project logbook; the tool never opens it.
- When valid with requests due now, `next_action` starts with
  `Waiting on <label> (<n>)[, ...]: <total> request(s) due now.`; `version` includes the annex
  status, revision and the open `[id, due]` list.
- `status --format text` prints a `Waiting on:` block right after `Goal:` (open items with
  their due, then closed items with answer or reason), or
  `Waiting on: requests annex invalid — <reason>`. Strings are cleaned of control,
  bidirectional and invisible characters; render them as inert text. Labels are
  unauthenticated assertions; answers must never carry secrets.

## Derived missions and attempt timeline

`tasks` lists the contract tasks, then derived correction missions in creation order (see
`schema.md`, "Derived correction missions"). Every item carries the fields below; the schema
declares them without requiring them, so earlier saved views still validate.

- `kind` is `contract` or `derived`.
- `derived` is `{parent, cause: {task_id, attempt_id, assignee}, created_at}` for a derived
  mission (`created_at` is the `derive` event time or `null`) and `null` for a contract task.
- `corrections` lists the derived mission IDs created for a contract task; it is `[]` on a
  derived mission. A corrected implementation stays `done`.
- `timeline` lists one entry per attempt in claim order:
  `{attempt, attempt_id, assignee, runtime, route, model, claimed_at, ended_at, outcome}`.
  Attempt `n` is the mission's `n`-th claim. It ends at the next record (`outcome` is the
  receipt result, `done` or `blocked`) or at a release of the active assignment (`released`);
  a later release of a blocked mission is not an attempt. An open attempt is `active` with
  `ended_at: null`. `attempt_id`, `assignee`, `runtime`, `route` and `model` come from the claim
  event's optional `assignment` (the receipt supplies `attempt_id` and `assignee` when the claim
  event has none); a released attempt takes its `attempt_id` from the claim event, else `null`.
  Times are the events' `at`, else `null`; never infer them.
  A mission that was never claimed has `timeline: []`, whatever its ID (IDs such as
  `constructor` are ordinary keys).

`completion.tasks_done/tasks_total` count contract tasks only; `completion.derived_done` and
`derived_total` count derived missions, and the optional `completion.derived_active` and
`derived_blocked` count the derived missions in those states (absent from earlier saved views).
`counts` covers every mission; a `withdrawn` key appears
only when a correction was retired with `withdraw-derived` (its item `state` is `withdrawn`). While a derived mission
is `queued` or `active`, `estimates.tasks_eta` and `global_eta` are `unknown` with a reason
naming it; estimates files never hold derived IDs. `status --format text` prints each derived
mission with its parent and cause and a `Corrections:` row on the corrected task. Its header
counts contract tasks and corrections apart:
`Tasks: a/b done; x active; y blocked. Corrections: c/d done; e active; f blocked` (the
`Corrections:` part appears only when the board has a derived mission). The reason line of a
mission is labelled `Withdrawn:` for a withdrawn correction, `Requeued:` for a queued mission and
`Blocker:` otherwise. A derived mission, and any mission with a blocked attempt or more than one
attempt, lists one line per attempt:
`Attempt n: <assignee>, <outcome>, <claimed_at> to <ended_at or now>`. View `schema_version`
stays 1.
