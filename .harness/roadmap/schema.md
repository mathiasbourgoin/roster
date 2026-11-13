# Roadmap artifact contract, version 1

Use this contract to coordinate several Roster intakes without binding execution to a
particular runtime. The executable validator is `scripts/roster-roadmap.cjs`. Its installed
copy is `.harness/bin/roster-roadmap.cjs`; its `roster-artifacts.cjs`, `roster-recovery.cjs`,
`roster-roadmap-view.cjs`, `roster-roadmap-estimates.cjs`, `roster-roadmap-requests.cjs`,
`roster-roadmap-requests-view.cjs`, `roster-roadmap-validate.cjs`, `roster-roadmap-history.cjs`,
`roster-roadmap-missions.cjs`, `roster-roadmap-prompt.cjs` and `roster-roadmap-derived.cjs`
siblings form the installed
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
derive BOARD --coordinator ID --revision N --request FILE
withdraw-derived BOARD --coordinator ID --revision N --task TASK --withdrawal FILE
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

A blocked receipt MAY carry `"blames": ["<dependency id>", ...]`: a nonempty, duplicate-free
array of the task's direct `depends_on` entries naming the implementation(s) the failure is
attributed to. `blames` on a `done` receipt, an empty or duplicated array, or an entry that is not a
direct dependency refuses; a derived mission has no dependencies, so its receipts cannot blame.

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
the latest recorded execution state. Every contract task must be done, no derived correction
mission may be `queued` or `active`, and every global check must pass. Completion freezes further execution-state mutations. This structural check does not independently
establish the truth or freshness of the evidence strings: the responsible verifier must
inspect the integrated result and actual outputs before submitting them.

## Derived correction missions

When a review mission fails because of an implementation it depends on, the coordinator records
a derived correction mission in `state.json` instead of reopening the implementation.
`roadmap.json` and the acceptance digest never change.

Owner decision D1 (2026-11-13): a derived correction mission, no reopening. Points D2 to D6 are
**deduced from D1 and the owner's escalation rule, to be confirmed on the PR**:
D2 a derived mission has its own model, agent, receipts and attempt budget and is never claimed
by the agent of the failed review; D3 it is created only from a blocked review receipt that blames
the implementation it depends on; D4 the implementation stays `done` and is annotated; D5 the
review is requeued automatically when its corrections are done; D6 `view` shows every derived
mission and every attempt at its time.

Four owner decisions (Mathias, 13 November 2026) sharpen D2 and D5 and are enforced:
**fresh context** (« L'important c'est surtout d'utiliser un agent au contexte frais »), over the
**family of the review**: no assignee may take a correction of a review, or the next attempt of
any task that depends on a corrected mission, after appearing on that task, on a dependency it
blames or that has a correction, or on one of their corrections;
**verified digest**: the `derive` event carries a digest of the definition, recomputed on replay
(it detects accidental or naive edits only, see below); **strict re-queue**: a failed review
returns to the queue only when every dependency its latest blocked receipt blames has a done
correction, and its `release` is refused until then, with no exception for an exhausted
correction.

`derive` reads a request that is exactly:

```json
{ "parent": "impl", "cause": "review", "objective": "Fix the null check",
  "topology": { "runtime": "codex", "role": "implementer", "persona": "Engineer", "model": "opus", "route": "sequential", "fallbacks": [] },
  "max_attempts": 2 }
```

`objective` is nonempty text of at most 2000 characters; `topology` is validated like a contract
topology (the workflow route is refused because a derived mission has no workflow);
`max_attempts` is an integer from 1 to the parent's `policy.max_attempts`. The coordinator
chooses the topology following its escalation ladder; the tool checks its shape, not the ladder.
`derive` refuses unless the board is accepted and not complete, the coordinator is the designated
one, `cause` is a contract task in `blocked` status whose latest receipt is blocked and blames
`parent`, `parent` is a done contract task, the cause policy is `retry` with attempts left, the
cause needs no recovery reframe and at least one route of the requested topology (route or
permitted fallback, on an available runtime) is claimable now (both checked when the command runs,
never during replay), and no correction for the same parent and cause receipt is pending
(`queued`, `active`, or `blocked` with attempts left) or `done`. When every earlier correction
for that parent and receipt is exhausted (blocked at its budget) or withdrawn, `derive` creates
`<parent>-fix-<n+1>` with a new budget, still capped by the parent's; the exhausted or withdrawn
attempts stay in the history. That repetition is bounded: for one cause receipt and one parent,
`derive` refuses, live and on replay, once the corrections that were not withdrawn number the
parent's `policy.max_attempts` (a withdrawn correction never ran and does not count); the way
forward is then a revised-roadmap decision. So one receipt and dependency get at most parent
`max_attempts` corrections of at most parent `max_attempts` attempts each. `derive` also refuses,
live and on replay, when a member of the review's family has a claim event without `assignment`
(written by an older runtime, or the field removed) whose attempt was released without a receipt:
the fresh-context rule cannot know that attempt's agent, so the board needs a revision instead.
Such a claim whose attempt ended with a receipt does not block `derive`, because the receipt names
the agent.

`withdraw-derived` retires a correction that is still `queued` and was never claimed (`attempts`
is 0), for example one whose topology became unclaimable right after derivation. Only the
designated coordinator may run it, and the withdrawal file is exactly
`{ "reason": "<nonempty, at most 2000 characters>" }`. The task
state becomes `{ "status": "withdrawn", "reason": "<reason>" }` (attempts stay 0) and one
`withdraw-derived` event is appended with `task_id` and `reason`. A withdrawn correction is
terminal: it cannot be claimed or released, it does not block completion, and it settles its
parent and receipt so the same receipt can derive again. `withdrawn` is valid only for a derived
mission; replay refuses it anywhere else, and refuses a `withdraw-derived` event on a contract
task or on a correction that was not `queued` or was already claimed. A correction that started
ends by its receipts and its budget (exhaustion), after which a new derivation is possible. If a
started, queued correction becomes unclaimable, restore a claimable route in `capabilities.json`
or request a revised-roadmap decision.

Last attempt after a capabilities change: for a derived mission only, `record` accepts a
`blocked` receipt even when `capabilities.json` changed during the assignment (a `done` receipt
is still refused, and contract tasks are unchanged). This is the exit for an active correction on
its last attempt, which can be neither released (budget) nor withdrawn (started): if its agent is
gone, the coordinator records the blocked receipt under the attempt id and assignee of the
assignment. The `next_action` of such a mission says so.

The tool assigns the id `<parent>-fix-<n>` with the smallest `n >= 1` not used by any mission, or
`fix-<n>` when that would exceed 80 characters. It stores the immutable definition in the optional
map `state.derived`:

```json
"derived": { "impl-fix-1": { "parent": "impl", "cause": { "task_id": "review", "attempt_id": "<receipt attempt>", "assignee": "rev1" },
  "objective": "Fix the null check", "topology": { "...": "..." }, "max_attempts": 2, "revision": 7 } }
```

`revision` is the revision of the single `derive` event, whose `task_id` is the derived id. That
event also carries `"definition_digest"`: the lowercase hex SHA-256 of the UTF-8 bytes of
`JSON.stringify` of `{parent, cause, objective, topology, max_attempts}` taken from the
definition, with object keys sorted at every depth, array order kept and no whitespace (the
canonical form of `contract_digest`). It is required on `derive` events and refused on any other
event; replay recomputes it and refuses a definition modified after its event. `revision` is not
covered by the digest: replay compares it with the event revision. Like `contract_digest`, the
digest is unkeyed and stored in the file it protects: it detects an accidental or naive edit of a
definition, not a deliberate forgery of `state.json` by someone who recomputes it. Its
runtime state lives in `state.tasks[<id>]` like any mission, starting `queued` with 0 attempts.
The mission set is the contract tasks followed by derived missions in creation order. A derived
mission inherits `intake`, `inputs`, `outputs`, `allowed_files`, `dod`, `success`, `checks` and
the policy's `stop_if`, `recovery` and `failure` from its parent; it has `depends_on: []`, its own
topology, `policy.on_failure: "retry"` with its own `max_attempts`, and workflow `none`. Claim,
record, release, write-scope overlap, capacity, progress reports, recovery inspection and
operator-request binding treat it as a mission with its own budget.

The **family of a review** C is defined by the links the board records: C, every dependency named
in the `blames` of any receipt of C, every dependency of C that has a correction, and every
correction of those dependencies, whichever review caused it (exhausted and withdrawn corrections
included). A derived mission is on the family of its cause; a contract task one of whose
dependencies has a correction is on its own family (Roster cannot tell a review from another
dependent task, so the rule covers every dependent task); a contract task none of whose
dependencies has a correction is on no family when claimed. So `impl-fix-2`, derived after a
second failed review, is on the family of `impl-fix-1`, `lib-fix-1` derived from the same review
is on it too, and the author of `impl-fix-1` cannot claim a second review `qa` that depends on
`impl`, even if `qa` never blamed `impl`.

`claim` of a mission on a family refuses any assignee already seen on that family: the
`assignee` of a receipt, of a claim-event `assignment` or of an active assignment of any family
member, including earlier attempts of the same derived mission. So a correction is never claimed
by the implementer of its parent or of another blamed dependency, by the failed reviewer or by an
earlier fixer of any dependency of that review, and **the next attempt of a task that depends on
a corrected mission also needs an agent new to its family**. Roster compares declared identifiers only: the
coordinator must give each attempt the identifier of a newly launched agent. Replay applies the
same rule to every claim event against the history before it, and a claim of a mission on a family
must carry its `assignment`.

Legacy claims: a claim event without `assignment` (written by the runtime before derived
missions) stays valid for a contract task that is on no family at that point, because older
boards must keep reading. When its attempt ended with a receipt, the receipt names the agent, so
the identity is known and `derive` proceeds: a board started with an older runtime and continued
with this one can derive. `derive` and its replay refuse only when a family member has a claim
without `assignment` whose attempt was released without a receipt, since that attempt leaves no
identity to compare; the way forward is then a revised board.

A done receipt of a derived mission, when that mission's cause receipt is still the cause's latest
and every dependency named in its `blames` has a done derived mission created from it, moves the
cause from `blocked` to `queued` with reason `corrections done: <done ids in creation order>` in
the same `record` event. `release` of a `blocked` task is refused while any dependency named in
the `blames` of its latest blocked receipt has no done correction created from that receipt:
never derived, `queued`, `active`, `blocked`, exhausted or withdrawn alike. There is no
exception for an exhausted correction. The task's `next_action` names the step for each such
dependency: `derive a correction for <dependency>`; finish the pending correction (release it if
blocked with attempts left, withdraw it if queued and never claimed); or, when no correction
succeeded, derive a new correction for the same receipt or request a revised-roadmap decision.
The text lists the exhausted and withdrawn corrections of that dependency, for example
`(impl-fix-1 exhausted, impl-fix-2 withdrawn)`. On a live board `next_action` and the `release`
refusal follow the real preconditions of `derive`: when a derivation would be refused (the
review's policy is not `retry`, its budget is exhausted, it needs a recovery reframe, the limit
on corrections per receipt and dependency is reached, or an identity is unknown because of a
legacy claim) the text says `no correction can be derived for <dependency>: <reason and way
forward>` instead of advising `derive`. A blocked
receipt without `blames` keeps the usual release rules. Derive one correction per blamed
dependency, in any order, while the review is blocked; once the review is requeued, a further
derive from that receipt refuses (the review is no longer blocked). The review's own budget bounds
its blocked receipts, each parent's budget bounds every correction, and the parent's
`max_attempts` bounds the corrections derived for one receipt and dependency.

New `claim` events carry an optional `assignment` = `{id, assignee, runtime, route, model}`
copied from the assignment the claim created; no other event may carry it, and a claim of a
derived mission must carry it. A receipt or an active assignment of a derived mission whose
assignee equals its cause assignee is refused. Replay creates each derived mission at its `derive`
event and re-checks the state-derivable preconditions (including the legacy-claim refusal), the id
allocation, the cause receipt and the definition digest, verifies claim payloads against the
topology, the following receipt and the active assignment, re-checks the cause-assignee ban and the
fresh-context rule on claims, replays withdrawals, the requeue and the release refusal, and refuses
a definition without its event or the reverse. Boards without `derived` and claim events without
`assignment` outside any family read exactly as before.

Limits of an unsigned `state.json`: replay detects inconsistent edits, not a consistent rewrite.
Whoever can write the file can recompute `definition_digest` after editing a definition, add
`blames` to a stored blocked receipt before deriving, or remove a `derive` event together with
its definition, task state, the correction's claims and receipts while renumbering the later
events; the board then reads as if that history were genuine. Protect the board directory like
any other local authority file.

Compatibility: the runtime before derived missions refuses a whole board (every command that reads
it, observed on `status`, `view` and `next`: `state event: unknown field assignment`) as soon as
it holds one `claim` written by this version, **even when no `derive` was ever run**, because
every new claim event, of a contract task or a derived mission, carries `assignment`; the same
holds for a `derive` or `withdraw-derived` event, a `withdrawn` task or `state.derived`. A board
that only has `accept`, or `record`/`release` events on claims written by the older runtime,
stays readable. Install the runtime closure together and do not downgrade a board in use.

Completion means every contract task `done` and no derived mission `queued` or `active`
(withdrawn and exhausted corrections do not block it; `next`, `complete`, the stored global
receipt and completion history). Identity labels (`assignee`, coordinator, cause assignee) are
unauthenticated local assertions: the assignee ban compares labels and cannot prove that two
labels are different agents.
