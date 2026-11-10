# Roadmap artifact contract, version 1

Use this contract to coordinate several Roster intakes without binding execution to a
particular runtime. The executable validator is `scripts/roster-roadmap.cjs`. Its installed
copy is `.harness/bin/roster-roadmap.cjs`; it requires only Node built-ins and remains usable
in an ESM consumer. Commands coordinate artifacts; they never invoke an agent, shell,
network service, or verification command.

## Files and authority

An explicit board directory contains:

| Path | Authority |
|---|---|
| `roadmap.json` | Accepted execution contract; editing it invalidates acceptance |
| `capabilities.json` | Current observed runtime availability and explicit capability authorization |
| `state.json` | Sole execution authority: acceptance, ownership, tasks, receipts and events |
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

All commands return JSON on stdout, exit `0` on success and `1` on refusal/error. Unknown or
duplicate options fail. Run `node scripts/roster-roadmap.cjs --help` for option names.

```text
init BOARD --id ID
lint BOARD
status BOARD
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

`lint` returns `contract_digest` for recording a decision. The decision file is exactly
`{ "by": "owner", "basis": "Explicit owner agreement or precisely scoped delegated authority", "contract_digest": "<digest>" }`.
The agent must not fabricate approval. Accept records that decision, sets the named
coordinator and initializes task states. Acceptance is immutable; changed goals/contracts
require a separately reviewed revised board, preserving prior history. Child intake/spec/plan
gates are not satisfied merely by accepting the roadmap.

Every mutation requires the current `state.json` revision and the designated coordinator
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

`next` returns `ready`, `active`, `blocked`, `global-verification-needed`, or `complete`.
A ready response includes the task and selected route. Blocked branches do not hide unrelated
ready work. All-tasks-done yields global verification needed, never automatic completion.

`prompt` renders a coordinator/mission view in its JSON `prompt` string. It includes the goal,
global criteria, state counts, active assignments, relevant task/dependency contracts, policy,
artifact references and continuation instructions. It never loads notes or receipt history.
Default maximum is 12,000 characters; overflow refuses explicitly. Select a narrower mission
or increase the limit deliberately instead of dropping constraints.

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
pass. Completion freezes further mutations. This structural check does not independently
establish the truth or freshness of the evidence strings: the responsible verifier must
inspect the integrated result and actual outputs before submitting them.
