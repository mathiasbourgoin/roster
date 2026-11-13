# Roadmap artifact contract, version 1

Use this contract to coordinate several Roster intakes without binding execution to a
particular runtime. The executable validator is `scripts/roster-roadmap.cjs`. Its installed
copy is `.harness/bin/roster-roadmap.cjs`; its `roster-artifacts.cjs`, `roster-recovery.cjs`,
`roster-roadmap-view.cjs`, `roster-roadmap-estimates.cjs`, `roster-roadmap-requests.cjs` and
`roster-roadmap-requests-view.cjs` siblings form the installed
runtime closure from the same approved revision. It requires only Node built-ins and
remains usable in an ESM consumer. Commands coordinate artifacts; they never invoke an agent, shell,
network service, or verification command.

## Files and authority

An explicit board directory contains:

| Path | Authority |
|---|---|
| `roadmap.json` | Accepted execution contract; editing it invalidates acceptance |
| `capabilities.json` | Current observed runtime availability and explicit capability authorization |
| `state.json` | Sole execution authority: acceptance, ownership, tasks, receipts and events |
| `estimates.json` | Optional contract-bound planner forecasts and revision history; advisory |
| `requests.json` | Optional advisory annex of coordinator asks to the human operator, with its own revision and history; never read by claim/next |
| `progress/` | Optional per-attempt worker-reported progress; advisory |
| `goal.md` | Human-facing observations, assumptions, recommendations, decisions and open questions |
| `notes/` | Longer source-backed research, consulted when relevant |
| `receipts/` | Candidate receipt files; accepted receipt objects live atomically in `state.json` |

The skill defaults to `roadmaps/<id>/` and preserves any owner-selected destination.
Board creation does not stage or publish its contents. Source examples below
`examples/roadmap/` illustrate the shape; adapt them to actual goals, models and checks.

Identity labels and evidence strings are local assertions. The toolkit does not authenticate
the person named by `by`, verify evidence-file contents, run declared commands, enforce
filesystem permissions on agents, or establish independent review. Native runtime tools,
the responsible agent and existing Roster gates retain those duties. A prompt or a receipt
cannot keep a closed runtime alive.

## Execution contract

`roadmap.json` has exactly these fields:

| Field | Type and constraint |
|---|---|
| `schema_version` | Integer `1` |
| `id` | Safe identifier matching `[a-zA-Z][a-zA-Z0-9_-]{0,79}` |
| `goal` | Nonempty original owner outcome |
| `success` | Nonempty array of distinct nonempty global success criteria |
| `global_checks` | Nonempty array of check definitions |
| `execution` | `{ "max_active": 1 }`; integer range 1–64 |
| `tasks` | Nonempty array of task contracts with unique IDs and an acyclic dependency graph |

A task has exactly these fields:

| Field | Meaning |
|---|---|
| `id` | Safe unique task identifier |
| `intake` | Project-relative path to the child intake; a reference, not automatic validation |
| `objective` | Nonempty mission outcome |
| `depends_on` | Array of existing task IDs; no duplicates or cycles |
| `inputs`, `outputs` | Arrays of relevant project-relative artifact paths |
| `allowed_files` | Exact file paths or directory prefixes ending `/`; empty means read-only |
| `dod` | Nonempty array of completion obligations |
| `success` | Nonempty array of observable local success criteria |
| `checks` | Nonempty array of check definitions |
| `topology` | Runtime, role/persona/model and route selection below |
| `policy` | Explicit retry/recovery/stop contract below |
| `workflow` | Workflow proposal or accepted instructions below |

Paths use `/`, cannot be absolute, contain `.`, `..`, empty components, control characters,
backslashes or glob syntax. `src/` covers `src/a.js`; `src` covers only the exact path `src`.
Reported changed files must be files, not directory prefixes. Input/output/intake references
are not loaded automatically. File existence and producer/consumer semantic coherence remain
agent review obligations; structural lint does not prove them.

A check definition is `{ "id": "unit", "description": "Tests pass", "command": "node --test" }`.
`command` is optional; IDs and descriptions are required. IDs must be unique within each
task's checks and within global checks. A manual verification can use a description with
an explicit evidence-producing procedure instead of a command.

`topology` requires all of:

```json
{
  "runtime": "codex",
  "role": "implementer",
  "persona": "Engineer who verifies edge cases before returning a result",
  "model": "project-selected-model",
  "route": "subagent",
  "fallbacks": ["sequential"]
}
```

Runtime labels are `codex`, `claude`, `opencode`, `pi`. Routes are `sequential`, `subagent`,
`parallel`, `multisession`, `workflow`. Fallbacks are ordered, distinct permitted alternatives;
no fallback is invented. All other strings remain explicit project choices. A workflow route
(including a fallback) additionally requires an accepted workflow with nonempty steps.

The shared model-routing policy is installed at `.harness/roadmap/model-routing.md`
(source: `docs/model-routing.md`). Tier/rationale/actual-model observations live in compact
mission briefs and `notes/model-routing.md`; they add no JSON fields or model authorization.
`topology.model` remains part of the immutable accepted contract. A recommended escalation
cannot change it in place, reset attempts, or treat a route fallback as a model fallback.
Reconcile active work and use a separately accepted revised board when that choice changes.

`policy` requires `max_attempts` (integer 1–100), `on_failure` (`retry` or `block`), nonempty
distinct `stop_if` and `recovery` string arrays, and a nonempty `failure` terminal-condition
description. The tool enforces attempt budgets and explicit reconciliation; the agent must
evaluate the described stop/recovery/failure conditions. A blocked task never automatically
returns to the queue.

`workflow` is `{ "recommendation": "none", "reason": "One bounded mission", "steps": [] }`.
Recommendation values are `none`, `proposed`, `accepted`. The reason is always required.
Steps are distinct nonempty strings when present; this is a native-agent runbook, not an
executable workflow language. An accepted workflow is necessary before selecting `workflow`.

## Capability observations and authorization

`capabilities.json` has `schema_version: 1` and a `runtimes` object keyed only by the four
runtime names. Omitted runtimes are unavailable. Each runtime value contains `available`
(boolean), `evidence` (distinct strings; nonempty when available), and `capabilities`.

The capability map accepts `subagent`, `parallel`, `multisession`, `workflow`. Each value
contains boolean `supported`, boolean `authorized`, and an `evidence` string array. Evidence
is required when either flag is true. Both flags and runtime availability must be true to
select a route. Keep tool-observation and permission sources explicit in those strings.

Sequential needs only observed runtime availability. A second concurrent claim always needs
authorized `parallel` capability on every involved runtime, even if the tasks use sequential,
subagent or multisession routes. Active write scopes must be disjoint; read-only scopes may
coexist. `max_active` remains an additional limit. Supporting a session tool is not permission
to create a session or to read another session's messages.

Claimed attempts snapshot the complete capability digest. A profile edit during execution
invalidates receipt acceptance; inspect/reconcile the work before retrying. The profile is
deliberately not frozen by roadmap acceptance, so observations may be corrected between
missions without rewriting the accepted task contracts.

## Commands

Commands return JSON on stdout except `status --format text`, which returns formatted
human-readable status. They exit `0` on success and `1` on refusal/error. Unknown or
duplicate options fail. Run `node scripts/roster-roadmap.cjs --help` for option names.

```text
init BOARD --id ID
lint BOARD
status BOARD [--format json|text]
view BOARD [--task TASK] [--events N]
progress BOARD --task TASK --attempt ATTEMPT --assignee ID --sequence N --update FILE
estimate BOARD --revision N --update FILE
request-open BOARD --coordinator ID --revision N --request FILE
request-answer BOARD --coordinator ID --revision N --id RID --answer FILE
request-withdraw BOARD --coordinator ID --revision N --id RID --withdrawal FILE
request-journal BOARD --coordinator ID --revision N --journal FILE
next BOARD
prompt BOARD [--task TASK] [--max-chars N]
accept BOARD --coordinator ID --revision N --decision FILE
claim BOARD --coordinator ID --revision N --task TASK --assignee ID
record BOARD --coordinator ID --revision N --receipt FILE
release BOARD --coordinator ID --revision N --task TASK --reason TEXT --reconciled-by ID
complete BOARD --coordinator ID --revision N --receipt FILE
```

`init` exclusively creates a new board, including an incomplete non-executable draft and
unavailable runtime defaults. It refuses even an empty existing board directory. Fill the
contract and observed capability profile before lint/accept. `status` can inspect an
unaccepted draft; accepted boards additionally require intact acceptance/state.

`status --format text` and `view` are read-only observations. The skill-level
`/roster-roadmap status [board]` route resolves an explicit or unambiguous existing board,
renders the formatted status and returns without execution or friction writes. `view`
provides versioned JSON including source revision, a resource change token, bounded recent
events, task/assignment/check states, separately labeled reported progress, recovery and
task/global estimates. It supports task focus and `--events` in 0–100. Embedded labels,
commands and paths are inert untrusted data. See [the view schema](roadmap-view-schema.md)
and its installed `.harness/roadmap/view-schema.md` / `view.schema.json` resources.

`progress` updates only the current assignment's advisory report under `progress/`, using
task/attempt/assignee identity and a current progress sequence (`0` initially). It accepts
a message, optional current step and declared check reports. It does not emit a receipt,
increment execution revision or satisfy checks; malformed/stale reports remain unverified.
Exact update bounds and shape are defined in the view schema.

`estimate` appends a planner revision to optional `estimates.json`; `--revision` is the
forecast revision (`0` initially), independent of execution revision. The update binds the
accepted contract and current execution revision and records writer, capture time, basis,
evidence, per-task duration/remaining ranges and global-verification duration or unknown.
It changes no accepted contract, execution state, receipt or retry budget. See
[the estimates schema](roadmap-estimates-schema.md), installed as
`.harness/roadmap/estimates-schema.md` with guide `estimates.md`. Revisit estimates when
planning evidence changes; no timing metadata is inferred for legacy boards. ETA remains
conditional on authorization/capacity/dispatch/check assumptions, and missing timing or
blocking evidence produces unknown values. Active remaining captures must match actual
attempt/time anchors; elapsed pessimistic overruns require re-estimation.

`request-open`, `request-answer`, `request-withdraw` and `request-journal` write the optional
advisory annex `requests.json` (what the coordinator waits for from the human operator) under
the board lock, with the annex's own revision (`0` initially) and `--coordinator` equal to
`state.coordinator` on accepted boards. They change no accepted contract, execution state,
receipt or `claim`/`next` behaviour; an open request is a signal, never a refusal. Requests
never contain secrets. See [the requests schema](roadmap-requests-schema.md), installed as
`.harness/roadmap/requests-schema.md`.

`lint` returns `contract_digest` for recording a decision. The decision file is exactly
`{ "by": "owner", "basis": "Explicit owner agreement or precisely scoped delegated authority", "contract_digest": "<digest>" }`.
The agent must not fabricate approval. Accept records that decision, sets the named
coordinator and initializes task states. Acceptance is immutable; changed goals/contracts
require a separately reviewed revised board, preserving prior history. Child intake/spec/plan
gates are not satisfied merely by accepting the roadmap.

Every execution-state mutation requires the current `state.json` revision and the designated coordinator
label. Mutations lock the board using exclusive `.lock` directory creation and replace the
state with a synced temporary-file rename. Do not delete `.lock` until the owning process
has been inspected/stopped. The tool never infers that a stale-looking lock or silent session
is abandoned. Managed-path symlinks are refused; this is not adversarial filesystem-race
containment against another local process with write access.

`claim` creates an attempt UUID, increments its conserved attempt count, selects a supported
authorized route and returns an assignment containing `contract_digest`, `capabilities_digest`,
`runtime`, `route`, and `assignee`. The caller dispatches with actual native runtime tools.
`release` requires an explicit reconciliation actor/reason; it can requeue only active or
blocked work with a permitted retry and remaining attempts. It never resets attempt budgets.
Inspection of the old process/worktree and handling partial changes remain agent duties.
Every accepted-state read replays the contiguous claim/record/release history, requiring
task statuses, attempt counts, recorded receipt order and reconciliation reasons to agree.
Lowering a persisted attempt counter cannot authorize a new attempt. These consistency
checks detect malformed local state; they do not authenticate the history against a local owner.

New execution events additionally record their actual emission time as optional `at`, a
UTC ISO timestamp with milliseconds. Legacy events without `at` remain valid; views expose
their timestamp as unknown/null. Do not backfill a guessed start or treat event order as a
measured duration. Active forecasts may use the latest real claim timestamp, or require an
explicit remaining estimate bound to the current attempt when its start is unknown.

Three consecutive blocked receipt attempts on the unchanged accepted task trigger the
separate recovery reframe requirement before another release/claim. The recovery resource
retains exact source identity, failure evidence, diagnosis, changed strategy, discriminating
check and append-only reframe history. It cannot edit acceptance, refund attempts, stop an
old worker or bypass child gates. Review's novel-finding strikes and review/QA caps remain
distinct. See [the recovery guide](../docs/failure-recovery.md) and installed
`.harness/roadmap/failure-recovery.md` / `recovery-schema.md`.

JSON reads and writes share a 16 MiB UTF-8 byte limit. A transition that would make the
aggregate state unreadable refuses before replacing `state.json`, preserving the previous
revision and receipts. Keep large evidence in referenced files rather than embedding logs.

`next` returns `ready`, `active`, `blocked`, `global-verification-needed`, or `complete`.
A ready response includes the task and selected route. Blocked branches do not hide unrelated
ready work. All-tasks-done yields global verification needed, never automatic completion.
`status.tasks` and `next.blocked` expose attempts, maximum attempts, exhaustion, the original
failure reason, declared recovery/failure policy and a next action. Exhaustion does not erase
the failing check evidence retained in the receipt, and further attempts require an explicit
revised-roadmap decision.

`prompt` renders a coordinator/mission view in its JSON `prompt` string. It includes the goal,
global criteria, state counts, active assignments, relevant task/dependency contracts, policy,
artifact references and continuation instructions. It never loads notes or receipt history.
Default maximum is 12,000 characters; overflow refuses explicitly. Select a narrower mission
or increase the limit deliberately instead of dropping constraints.
Without `--task`, the coordinator view selects the next global action and continues through
global verification and acceptance. With `--task`, the bounded worker view directs only that
mission and returning its candidate receipt to the coordinator; it never instructs that worker
to claim an unrelated ready task or mutate the global state. Unclaimed/blocked/done missions
receive status-specific handoff instructions rather than a new global execution assignment.

## Receipts

The local candidate receipt is exactly:

```json
{
  "task_id": "implement",
  "attempt_id": "<UUID returned by claim>",
  "assignee": "worker",
  "contract_digest": "<accepted digest>",
  "result": "done",
  "summary": "Delivered the assigned behavior",
  "evidence": ["reports/implementation.txt"],
  "changed_files": ["src/example.js"],
  "checks": [{"id": "unit", "status": "pass", "evidence": ["reports/test-output.txt"]}]
}
```

Result is `done` or `blocked`. Identity/attempt/digest must match the active assignment;
the current capability digest must still match its snapshot. `done` requires one passing
result for every declared check, nonempty evidence and only in-scope reported writes.
`blocked` preserves any checks that ran, including failures; its summary explains why it
cannot finish. An unrun check is omitted, never invented as passing. Unknown/duplicate checks,
failed checks hidden inside a done receipt, duplicate receipts and stale attempts refuse.
Record appends the accepted receipt and updates task state in one atomic `state.json` write.

The separate global candidate is exactly:

```json
{
  "contract_digest": "<accepted digest>",
  "state_revision": 5,
  "summary": "Original integrated outcome demonstrated",
  "evidence": ["reports/integrated-demo.txt"],
  "checks": [{"id": "integrated", "status": "pass", "evidence": ["reports/integrated-demo.txt"]}]
}
```

`state_revision` must equal the current revision before `complete`, binding the audit to
the latest recorded execution state. All tasks must be done and every global check must
pass. Completion freezes further execution-state mutations. This structural check does not independently
establish the truth or freshness of the evidence strings: the responsible verifier must
inspect the integrated result and actual outputs before submitting them.
