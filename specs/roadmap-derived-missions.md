---
name: roster-spec
type: spec
status: draft
feature: Roadmap derived correction missions
brief: briefs/roadmap-derived-missions-intake.md
date: 2026-11-13
version: 1.2.0
---

# Spec — Roadmap derived correction missions

When a review mission of an accepted roadmap fails because of an implementation it depends on,
the coordinator records a **derived correction mission** in `state.json`. It has its own
topology (runtime, model, role), claims, receipts and attempt budget; the implementation stays
`done` and is annotated; the review is requeued automatically when its corrections are done.
`view` shows derived missions and the time of every attempt.

## Owner decisions

- **D1 (Mathias, 2026-11-13)** Option B: derived correction mission, no reopening.
- **OD-1 Fresh context (owner decision, Mathias, 13 November 2026)**: « L'important c'est surtout
  d'utiliser un agent au contexte frais. » The assignee of every attempt of a derived mission, and
  of every attempt of the review after a correction, must not have appeared as assignee on any
  attempt of the same correction chain (FR-020). It strengthens D2.
- **OD-2 Verified digest (owner decision, Mathias, 13 November 2026)**: the `derive` event records
  a SHA-256 digest of the derived mission's definition; replay recomputes it and refuses a
  definition modified afterwards (FR-019). The digest is unkeyed and stored in the same file: it
  detects an accidental or naive edit of a definition, not a deliberate forgery of `state.json`
  (whoever edits the definition can recompute the digest), exactly like `contract_digest`.
- **OD-3 Strict re-queue, no exception (owner decision, Mathias, 13 November 2026, amended the
  same day after the second review)**: a failed review returns to the queue only when every
  dependency its latest blocked receipt blames has a done derived mission created from that
  receipt (FR-007). `release` of that review is refused while any blamed dependency has no done
  correction: never derived, in progress, exhausted or withdrawn. There is no exception for an
  exhausted correction: the way forward is a new derivation for the same receipt (FR-003,
  B-exhaustion) or a revised-roadmap decision. The review's `next_action` names what to do. It
  makes D5 precise.
- **OD-4 Fresh context over the review's family (owner decision, Mathias, 13 November 2026)**: an
  assignee cannot take a correction of a review, or the review's next attempt, if it appeared on
  that review, on any mission the review blames, or on any of their corrections (FR-020). It
  widens OD-1 from one parent's chain to the whole family of the review.
- **D2–D6 (deduced from B and the owner's escalation rule; to be confirmed on the PR)**:
  D2 own model, agent, receipts and attempt budget, never the agent of the failed review;
  D3 created only after a blocked review receipt that blames the implementation it depends on;
  D4 the implementation stays `done`, annotated; D5 the review is requeued automatically when
  the derived mission is done; D6 `view` (and a Gantt) can show every derived mission and every
  attempt at its time.

## Clarifications

| Q | A |
|---|---|
| Where is a derived mission stored? | Its immutable definition in a new optional `state.derived` map; its runtime state (`status`, `attempts`, `assignment`, `reason`) in `state.tasks[<id>]` like any mission. `roadmap.json` and the acceptance digest never change. |
| How does a receipt "blame" the implementation (D3)? | Optional receipt field `blames`: a nonempty array of the task's direct dependencies, allowed only on `result: "blocked"`. |
| Who chooses the model? | The coordinator, in the derive request (`topology`), following the escalation ladder; the tool validates the topology shape and the agent rule, not the ladder. |
| How is derivation bounded? | Each blocked receipt of the review can derive, per blamed dependency, one correction at a time: a new one only after the previous one for that dependency and receipt is exhausted or withdrawn (B-exhaustion, each with a fresh budget capped by the parent's). The review's own `max_attempts` bounds its receipts; a review whose budget is exhausted, whose policy is not `retry`, or that needs a recovery reframe cannot cause a derivation. Exhausted and withdrawn attempts stay in the history. |
| Is the derived id caller-chosen? | No: tool-assigned `<parent>-fix-<n>` with the smallest `n ≥ 1` not used by any mission; if that exceeds the 80-character identifier limit, `fix-<n>` with the smallest unused `n`. |
| What does the review requeue wait for? (OD-3) | Every dependency named in the `blames` of the review's latest blocked receipt has a `done` derived mission created from that receipt. A blamed dependency without a correction, or whose corrections are not done (pending, exhausted or withdrawn), keeps the review blocked and its `release` refused. |
| What is a correction chain? (OD-1, OD-4) | The code links a derived mission to its `parent` (a contract task) and its `cause` (`task_id` = the review, `attempt_id`/`assignee` = the blocked receipt). The rule applies to the **family** of a review C: C, every dependency named in the `blames` of any receipt of C, every derived mission whose `cause.task_id` is C (across every receipt, withdrawn and exhausted ones included) and their parents. A derived mission is on the family of its cause; a review with at least one derived mission is on its own family. A contract task with no derived mission naming it as cause is on no family when claimed. So one agent cannot correct two dependencies blamed by the same review, nor correct one after implementing another. |
| Which identities does OD-1 compare? | Declared identity only: the `assignee` of every receipt, every claim-event `assignment` and every active assignment of a family member, as recorded at the time of the claim. Roster cannot tell agents apart; the coordinator must give each attempt the identifier of a newly launched agent. A claim without `assignment` (written by an older runtime, or the field deleted) whose attempt was released leaves no identity to compare, so `derive` and its replay refuse a family that holds one (FR-021); claims of contract tasks outside any family keep the legacy exemption. |
| What does the derive digest cover? (OD-2) | `definition_digest` = lowercase hex SHA-256 of the UTF-8 bytes of `JSON.stringify` of `{parent, cause, objective, topology, max_attempts}` with object keys sorted at every depth, array order kept and no whitespace (the same canonical form as `contract_digest`). `revision` is not covered: it is checked against the event revision. It is unkeyed and lives in `state.json`: it detects an accidental or naive edit, not a deliberate forgery by someone who recomputes it. |
| Can an older runtime read a board written by this version? | No, as soon as the board has one `claim` written by this version (contract or derived mission), **even if no `derive` was ever run**: every such claim event carries `assignment`, and the pre-feature runtime refuses the whole state (`state event: unknown field assignment`, observed on `status`, `view` and `next`). The same holds for a `derive` or `withdraw-derived` event, a `withdrawn` task or `state.derived`. A board with only `accept` (or with `record`/`release` events on claims written by the older runtime) stays readable. The new runtime reads older boards unchanged. |
| What does a derived mission inherit? | `intake`, `allowed_files`, `checks`, `dod`, `success`, `inputs`, `outputs` from the parent; `depends_on` is empty (the parent is done); `policy.on_failure` is `retry` with the request's `max_attempts`; `workflow` is `none`. |
| Which predicates stay contract-only? | Completion predicates: "every task done" in `verifyHistory`, the stored global receipt check, `transitionComplete`, `next`'s global-verification branch and the forecast `complete` status mean "every contract task done and no derived mission `queued` or `active`". Everything else iterates missions. |
| What is a "mission"? | The mission set is contract tasks followed by derived missions in creation order. Every check that today iterates contract tasks (task-set equality, budget/assignment/receipt checks, history replay, capacity and write-scope overlap, `next`, `status`, `prompt`, `view`, progress reports, operator-request binding, recovery inspection) iterates missions. A derived mission is resolved to a synthesized task object (FR-005) wherever a task is looked up. |
| Can the review be released while its corrections are pending? | No (OD-3, strict). While any dependency blamed by the review's latest blocked receipt has no done correction created from that receipt (never derived, queued, active, blocked, exhausted or withdrawn), `release` of the review is refused, and its `next_action` says what to do: `derive a correction for <dependency>`, finish the pending correction, or, for an exhausted one, derive a new correction for the same receipt or request a revised-roadmap decision. A blocked receipt without `blames` keeps the usual release rules. |
| What if a correction can never be claimed? | `derive` refuses a topology with no claimable route at derivation time (runtime unavailable, or route unsupported or unauthorized with no permitted fallback; checked live only). If it becomes unclaimable later, `withdraw-derived` retires it while it is `queued` (FR-022); the same receipt can then derive again. |
| What does a state.json without signature not protect? | Labels and digests are local assertions. Someone who edits `state.json` can recompute `definition_digest`, add `blames` to a stored blocked receipt before deriving, or remove a `derive` event with its definition, task state, the correction's claims and receipts, renumbering the later events (the board then reads as if the correction never existed). Replay detects inconsistent edits, not a consistent rewrite. |
| How is replay kept independent of external files? | The recovery-reframe precondition of `derive` is checked when the command runs, never during replay; replay only re-checks preconditions derivable from `state.json` and the contract. |
| How are attempt times and identities kept for the timeline? | New `claim` events carry an optional `assignment` = `{id, assignee, runtime, route, model}` copied from the assignment the claim created; replay checks it matches. Legacy claim events without it leave those timeline fields `null` (attempt id still taken from a receipt when one exists). |
| Budget bound? | A derive request's `max_attempts` must be ≤ the parent's `policy.max_attempts`. Corrections per review failure ≤ the blamed dependencies; review failures ≤ the review's budget. |
| Forecasts? | While any derived mission is `queued` or `active`, task and global ETAs are `unknown` with a reason naming it, checked before any `complete` status; blocked (exhausted) derived missions are ignored by the schedule simulation; estimates files are unchanged and cannot hold derived ids. |
| When can the roadmap complete? | Every contract task `done` and no derived mission `queued` or `active` (an exhausted blocked correction whose review later succeeded does not block completion). `next` reports global verification under the same condition. |

## User Stories

### US-1: Coordinator derives a correction after a failed review (Priority: P0)
As the coordinator, I want to create a correction mission from a blocked review receipt that
blames the implementation, with the model and role I choose, so the fix is part of the board.
**Why this priority**: the feature's purpose.
**Scope**: This story does NOT cover choosing the model automatically.
**Independent Test**: on a fixture board, record a blocked review receipt with `blames`, run `derive`, read `state.json`.
**Acceptance Scenarios**:
1. **Given** accepted board B with `impl` done and `review` (depends on `impl`) blocked by receipt R (`blames: ["impl"]`, assignee `rev1`), **When** `derive B --coordinator lead --revision N --request d.json` with `{parent:"impl", cause:"review", objective:"Fix the null check", topology:{runtime:"codex", model:"opus", role:"implementer", persona:"Engineer", route:"sequential", fallbacks:[]}, max_attempts:2}`, **Then** `state.derived["impl-fix-1"]` holds the definition with `cause = {task_id:"review", attempt_id:R.attempt_id, assignee:"rev1"}`, `state.tasks["impl-fix-1"]` is `queued` with 0 attempts, one `derive` event is appended, `impl` stays `done`, and `roadmap.json` is byte-identical.
2. **Given** R without `blames`, or blaming another dependency, **When** `derive` names `impl`, **Then** it is refused and nothing changes.
3. **Given** `review` not blocked, `impl` not done, `impl` not a dependency of `review`, `review` with `on_failure: "block"`, `review` attempts exhausted, a second derive of `impl` from the same receipt while `impl-fix-1` is pending or done, a topology with no claimable route, or an earlier claim of the review's family without `assignment`, **When** `derive`, **Then** refused.
4. **Given** `impl-fix-1` exhausted (blocked at its budget) or withdrawn, **When** `derive` names `impl` again for the same receipt, **Then** `impl-fix-2` is created with its own budget (capped by the parent's) and `impl-fix-1` stays in the history.

### US-2: The derived mission runs as its own mission (Priority: P0)
As the coordinator, I want to claim, record and release the derived mission with its own
budget and agent rules.
**Why this priority**: without it the definition is inert.
**Scope**: This story does NOT cover running the agent.
**Independent Test**: claim/record/release `impl-fix-1` on a fixture board.
**Acceptance Scenarios**:
1. **Given** queued `impl-fix-1`, **When** `claim --task impl-fix-1 --assignee rev1` (the failed reviewer) or `--assignee dev` (the implementer of `impl`), **Then** refused (D2, OD-1); with `--assignee fixer` it succeeds, attempts 1, assignment runtime/route from the derived topology.
2. **Given** active `impl-fix-1`, **When** a done receipt with `task_id: "impl-fix-1"` covering the parent's checks and only the parent's `allowed_files` is recorded, **Then** `impl-fix-1` is `done`, and `review` goes `blocked → queued` with a reason naming the correction (D5); `impl` stays `done`.
3. **Given** a blocked receipt for `impl-fix-1`, **When** `release`, **Then** it is requeued while its own attempts remain; at `max_attempts` it is refused.
4. **Given** `impl-fix-1` blocked by `fixer` and released, **When** `claim --task impl-fix-1 --assignee fixer`, **Then** refused (OD-1); `fixer2` succeeds.
5. **Given** `review` requeued after `impl-fix-1` was done by `fixer2`, **When** `claim --task review` with `dev`, `rev1`, `fixer` or `fixer2`, **Then** refused (OD-1); `rev2` succeeds.
6. **Given** R blames `impl` and `lib` and only `impl-fix-1` exists, **When** `impl-fix-1` is recorded `done`, **Then** `review` stays `blocked`; after `lib-fix-1` is derived and recorded `done`, `review` is `queued` (OD-3).
7. **Given** R blames `impl` (done by `dev`) and `lib` (done by `libdev`), **When** `libdev` claims `impl-fix-1`, or the agent that did `impl-fix-1` claims `lib-fix-1`, **Then** refused (OD-4, family of the review).
8. **Given** blocked `review` whose latest receipt blames `impl`, **When** `release --task review` with no correction, a pending one, or only exhausted or withdrawn ones, **Then** refused (OD-3), and `status` gives `review` a `next_action` naming the step (`derive a correction for impl`, finish the pending one, or derive a new one).
9. **Given** queued `impl-fix-1` whose topology is no longer claimable, **When** `withdraw-derived --task impl-fix-1 --withdrawal w.json` (`{reason}`) by the coordinator, **Then** `impl-fix-1` is `withdrawn` with that reason, one `withdraw-derived` event is appended, and a new `derive` from the same receipt is allowed; withdrawal of an active, blocked, done or contract mission, without a reason file or by another coordinator is refused.

### US-3: History stays verified (Priority: P0)
As anyone reading the board, I want derived missions replayed and verified like other events.
**Why this priority**: trust boundary; history verification must not weaken.
**Scope**: This story does NOT cover authenticating labels.
**Independent Test**: tamper with a fixture `state.json` and read it.
**Acceptance Scenarios**:
1. **Given** a board with a derived mission, **When** any command reads it, **Then** replay reproduces every derived mission's status, attempts and reason and the review requeue.
2. **Given** a `derive` event without its definition, a definition without its event, an edited cause attempt, a derived id in `state.tasks` without definition, or a lowered derived attempt counter, **Then** reads fail with a history error.
3. **Given** a legacy `state.json` without `derived`, **Then** it reads unchanged.
4. **Given** a definition whose `objective`, `topology` or `max_attempts` was edited after its `derive` event, a `derive` event without `definition_digest`, or a digest on another event, **Then** reads fail (OD-2).
5. **Given** a hand-written history whose claim on a chain names an assignee already seen on that chain, or a claim of the review after a derivation without its `assignment`, **Then** reads fail (OD-1).

### US-4: View and timeline show derived missions and attempts (Priority: P0)
As the operator or a Gantt page reading `view`, I want each derived mission and each attempt with its times.
**Why this priority**: D6.
**Scope**: This story does NOT cover drawing the Gantt.
**Independent Test**: inspect `view` and text status on a fixture board.
**Acceptance Scenarios**:
1. **Given** a derived mission, **When** `view`, **Then** `tasks` contains it with `kind: "derived"` and `derived = {parent, cause, created_at}`, and the parent item has `corrections: ["impl-fix-1"]`.
2. **Given** claims, records and releases, **When** `view`, **Then** each mission item has `timeline` entries `{attempt, attempt_id, assignee, runtime, route, model, claimed_at, ended_at, outcome}` in order, with `outcome` `active|done|blocked|released`, and `null` times for legacy events without `at`.
3. **Given** `status --format text`, **Then** the derived mission appears with its parent and cause.
4. **Given** a derived mission not done, **Then** `estimates.tasks_eta.status` is `unknown` with a reason naming it.

### US-5: Completion and prompts account for corrections (Priority: P1)
As the coordinator, I want `next`, `prompt` and `complete` to treat derived missions as missions.
**Why this priority**: continuation must reach the correction.
**Scope**: This story does NOT cover child-pipeline gates.
**Independent Test**: run `next`, `prompt --task impl-fix-1` and `complete` on fixture boards.
**Acceptance Scenarios**:
1. **Given** queued `impl-fix-1` and nothing else claimable, **When** `next`, **Then** it is the ready mission.
2. **Given** `prompt --task impl-fix-1`, **Then** the mission view carries its objective, inherited scope and checks, its topology and a `derived` block.
3. **Given** a derived mission not done, **When** `complete`, **Then** refused.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | Unbounded derivation loops | Bounded by distinct blocked review receipts and the review's own budget; refused when the review cannot retry or needs a reframe. |
| C-2 | US-1 | Who decides the blame | The review receipt itself (`blames`), validated against `depends_on`; the coordinator cannot derive without it. |
| C-3 | US-2 | Same agent fixing as reviewing | Claim refuses the cause receipt's assignee, and (OD-1) every assignee already seen on the correction chain, at claim and on replay. Labels are unauthenticated assertions (documented). |
| C-21 | US-3 | Definition edited after derivation | OD-2: `definition_digest` on the `derive` event, recomputed on replay. |
| C-22 | US-2 | Review requeued with a blamed dependency left uncorrected | OD-3: requeue needs a done correction for every blamed dependency. |
| C-4 | US-2 | Write scope | Inherited from the parent; receipt changed files must stay inside it; overlap rules apply as for any mission. |
| C-5 | US-3 | State shape change | `derived` is optional; absent means none; `schema_version` stays 1; older tools reading a board that has derived missions, or any claim written by this version, refuse it (verified on the pre-feature runtime; documented; the closure is installed together). |
| C-6 | US-3 | Event payload | The `derive` event carries the derived id in `task_id`; the definition (incl. creation revision) lives in `state.derived` and must match the event. The event key set gains two keys: `assignment`, optional and on claim events only (C-16), and `definition_digest`, required on `derive` events only (OD-2). Like `derived`, older tools refuse boards that use them (documented; the runtime closure is installed together). |
| C-7 | US-4 | Attempt identity for released attempts | Released attempts have no receipt; their `attempt_id` comes from the claim event's `assignment` when present, else `null`; times come from the claim and release events. |
| C-8 | US-4 | Strict view schema | New item fields declared; `kind` and `timeline` on every task item; `derived`/`corrections` nullable. |
| C-9 | US-4 | ETA honesty | Unknown while a derived mission is open; no invented range. |
| C-10 | US-5 | Ordering in `next` | Contract tasks first in contract order, then derived missions in creation order. |
| C-11 | US-2 | Recovery streaks | `roster-recovery` inspects a derived mission like any board mission; the review's streak keeps counting its own blocked receipts. |
| C-12 | all | Core size | Logic in a sibling module; core stays ≤ 500 lines. |
| C-13 | US-3 | Contract-only loops (task set, budgets, assignment/topology, done-has-receipt, replay) | All iterate the mission set; assignment topology checked against the synthesized mission. |
| C-14 | US-3 | Replay depending on the recovery file | Reframe precondition checked live only. |
| C-15 | US-2 | Requeue bypassing release guards; review released during corrections | Review release refused while any blamed dependency lacks a done correction (OD-3, strict); policy and budget checked at derive and cannot change while blocked; reason deterministic. |
| C-23 | US-2 | A correction that can never be claimed freezes the review | `derive` refuses an unclaimable topology (live); `withdraw-derived` retires a queued correction so the receipt can derive again (FR-022). |
| C-24 | US-3 | An identity hidden by a claim without `assignment` | `derive` and its replay refuse a family holding one (FR-021). |
| C-16 | US-4 | Past runtime/route/model not reconstructible | Optional `assignment` payload on new claim events; legacy fields `null`. |
| C-17 | US-1 | Unbounded correction work | Derived budget ≤ parent budget; corrections per failure ≤ blamed dependencies; failures ≤ review budget. |
| C-18 | US-4 | Forecast falsely complete; completion counters | ETA unknown while a correction is open; completion counts contract tasks, derived counted separately. |
| C-19 | US-2 | Progress, operator requests and recovery keyed by contract tasks | Generalized to missions. |
| C-20 | US-1 | Id collisions and length | Smallest unused `n`, `fix-<n>` fallback past 80 characters. |

## Functional Requirements

#### Derivation [US-1]
- **FR-001** [US-1]: A task receipt MAY carry `blames`, a nonempty duplicate-free array of the task's direct dependencies, only when `result` is `blocked`; any other use MUST be refused.
- **FR-002** [US-1]: `derive BOARD --coordinator ID --revision N --request FILE` MUST accept exactly `{parent, cause, objective, topology, max_attempts}` with `objective` nonempty ≤ 2000, `topology` validated like a contract topology, `max_attempts` integer from 1 to the parent's `policy.max_attempts`.
- **FR-003** [US-1]: `derive` MUST be refused unless the board is accepted and not complete, the coordinator is the designated one, `cause` is a contract task in `blocked` status whose latest receipt is `blocked` and blames `parent`, `parent` is a contract task in `done` status, `cause.policy.on_failure` is `retry`, `cause` has attempts left, `cause` needs no recovery reframe (checked live only, FR-010), at least one route of the requested topology is claimable now (checked live only), no derived mission for the same parent and cause receipt is pending or done (an exhausted or withdrawn one allows a new derivation, B-exhaustion), and FR-021 holds.
- **FR-004** [US-1]: `derive` MUST store `state.derived[<id>] = {parent, cause: {task_id, attempt_id, assignee}, objective, topology, max_attempts, revision}` (`revision` = the derive event's revision; id per the Clarifications rule), set `state.tasks[id] = {status: "queued", attempts: 0, assignment: null, reason: null}`, append one `derive` event with `task_id` = id, and leave `roadmap.json`, the parent's state and receipts unchanged; it MUST refuse an id that collides with a contract task or is not a safe identifier.

#### Execution [US-2]
- **FR-005** [US-2]: A derived mission MUST behave as a mission whose `intake`, `objective` (from the request), `inputs`, `outputs`, `allowed_files`, `dod`, `success`, `checks` come from its parent, with `depends_on: []`, its own `topology`, and `policy = {max_attempts, on_failure: "retry"}` plus the parent's `stop_if`, `recovery`, `failure`.
- **FR-006** [US-2]: `claim` of a derived mission MUST refuse the assignee of its cause receipt (and FR-020 applies).
- **FR-007** [US-2]: (OD-3) Recording a `done` receipt for a derived mission MUST, when the cause's latest receipt is still that mission's cause receipt and every dependency named in its `blames` has a `done` derived mission created from that receipt, move the cause task from `blocked` to `queued` with reason `corrections done: <done correction ids in creation order, comma-separated>`, within the same `record` event, and MUST NOT otherwise. `release` of a `blocked` task MUST be refused while any dependency named in the `blames` of its latest blocked receipt has no `done` derived mission created from that receipt, with no exception for exhausted or withdrawn corrections; the task's `next_action` MUST name the step for each such dependency.
- **FR-008** [US-2]: `release`, attempt counting, write-scope overlap, capacity, recovery inspection, worker progress reports and operator-request binding MUST apply to derived missions as missions, with their own budget.

#### History [US-3]
- **FR-009** [US-3]: State validation MUST accept an optional `derived` object; every key MUST be a safe identifier present in `state.tasks`, and the accepted state task set MUST equal contract ids ∪ derived ids.
- **FR-010** [US-3]: History replay MUST create each derived mission at its `derive` event, re-check the state-internal FR-003 conditions against the replayed state at that point (not the live recovery file), verify claim-event `assignment` payloads (required on claim events of derived missions; the legacy exemption applies only to contract tasks), replay the review freeze on `release` events using the derived missions known at that point, re-check the cause-assignee ban (FR-006) and the fresh-context rule (FR-020) on claim events against the history before each claim, recompute the derive digest (FR-019), and independently refuse any stored or live receipt and any active assignment of a derived mission whose assignee equals its cause assignee, and reproduce claims, records (including FR-007), releases and attempt counts for derived missions; any mismatch MUST fail reads.
- **FR-011** [US-3]: A state without `derived` MUST read and behave exactly as before.

- **FR-019** [US-3]: (OD-2) `derive` MUST append `definition_digest` to its event, computed per the Clarifications canonical form over `{parent, cause, objective, topology, max_attempts}`; state validation MUST require it on `derive` events and refuse it on any other event; replay MUST recompute it from `state.derived[<id>]` and refuse a mismatch. The digest detects an accidental or naive edit, not a deliberate forgery of `state.json` (it is unkeyed and stored beside the definition); documentation MUST NOT claim more.
- **FR-020** [US-2, US-3]: (OD-1, OD-4) `claim` of a mission on a review's family (Clarifications) MUST refuse an assignee that appears as the `assignee` of a receipt, a claim-event `assignment` or an active assignment of any family member; replay MUST apply the same rule to each claim event against the history before it, and MUST require the claim `assignment` on every claim of a mission on a family (derived missions and reviews with a derived mission). The check is on declared identity; the identifier MUST designate a newly launched agent.
- **FR-021** [US-1, US-3]: `derive` and its replay MUST refuse the derivation when an earlier claim event of a member of the review's family has no `assignment`, with a message saying the fresh-context rule cannot see who worked on that family; the board stays readable otherwise.
- **FR-022** [US-2, US-3]: `withdraw-derived BOARD --coordinator ID --revision N --task ID --withdrawal FILE` (FILE exactly `{reason}`, nonempty, ≤ 2000 characters) MUST, for the designated coordinator and a `queued` derived mission only, set its status to `withdrawn` with that reason and append one `withdraw-derived` event carrying `task_id` and `reason`; replay MUST reproduce it and refuse it on any other mission or status. A withdrawn mission is terminal, never claimable or releasable, does not block completion, and counts as settled for FR-003.

#### Observation [US-4]
- **FR-012** [US-4]: `view.tasks` MUST list contract tasks then derived missions; every item MUST carry `kind: "contract"|"derived"`, `derived` (`{parent, cause, created_at}` or `null`), `corrections` (derived ids for a contract task, `[]` otherwise) and `timeline`; the schema declares them without making them required, so earlier saved views still validate.
- **FR-013** [US-4]: `timeline` entries MUST be `{attempt, attempt_id, assignee, runtime, route, model, claimed_at, ended_at, outcome}` in claim order; `outcome ∈ {active, done, blocked, released}`; a released attempt has no receipt, so its `attempt_id` comes from the claim event's `assignment` and is `null` only when that claim has none; attempt `n` of a mission is its `n`-th claim; it ends at the next `record` (outcome = receipt result) or at a `release` of an active assignment (outcome `released`); a later release of a blocked mission is not an attempt; `attempt_id`, `runtime`, `route`, `model` come from the claim event's `assignment` (or the receipt's `attempt_id`), else `null`; times are the events' `at` or `null`.
- **FR-014** [US-4]: `status --format text` MUST show each derived mission with its parent and cause; `view.schema.json` MUST declare the new fields; view `schema_version` stays 1.
- **FR-015** [US-4]: While any derived mission is `queued` or `active`, `estimates.tasks_eta` and `global_eta` MUST be `unknown` with a reason naming the derived mission(s).

#### Continuation [US-5]
- **FR-016** [US-5]: `next` MUST consider derived missions after contract tasks, in creation order.
- **FR-017** [US-5]: `prompt --task <derived id>` MUST render the mission view with a `derived` block; `complete` MUST be refused while a derived mission is `queued` or `active`; `view --task <derived id>` MUST work; `completion.tasks_done/tasks_total` MUST count contract tasks only, with `completion.derived_done/derived_total` alongside.

#### Distribution
- **FR-018** [US-1]: The new sibling module MUST join the runtime closure (sync, install tests, docs); `scripts/roster-roadmap.cjs` MUST stay ≤ 500 lines; schema docs and the `/roster-roadmap` skill MUST document derivation, D2–D6 and that labels are unauthenticated.

## Acceptance Criteria

- **AC-1** [US-1 happy path]: derive from a blaming blocked review receipt → definition, queued state, one event, parent unchanged, contract bytes unchanged.
- **AC-2** [US-1, C-1, C-2]: every FR-003 refusal and FR-001 misuse → refused, files unchanged.
- **AC-3** [US-2 happy path]: claim by another agent, record done → derived done, review queued with reason, parent done.
- **AC-4** [US-2, C-3]: claim by the failed reviewer refused; release bounded by the derived budget.
- **AC-5** [US-3]: tampered derived history refused; legacy state unchanged.
- **AC-6** [US-4]: view items, corrections, timeline entries with times and outcomes; schema validates.
- **AC-7** [US-4]: text status shows derived missions; ETA unknown while open.
- **AC-8** [US-5]: `next`, `prompt --task`, `complete` behave per FR-016/FR-017.
- **AC-9** [C-12]: closure contains the module; core ≤ 500 lines; full suite green.
- **AC-10** [OD-2, C-21]: the derive event's digest equals the canonical SHA-256; edited objective/topology/budget, a missing digest or a misplaced digest refuse reads.
- **AC-11** [OD-1, C-3]: claims reusing a chain assignee refuse (derived mission and review); a hand-written history doing so refuses reads.
- **AC-12** [OD-3, C-22]: a review blaming two dependencies stays blocked until both have a done correction; a forged early requeue refuses reads; `release` of the review is refused while a blamed dependency lacks a done correction, including after exhaustion.
- **AC-13** [FR-003, FR-022]: an unclaimable topology refuses `derive`; `withdraw-derived` retires a queued correction and the same receipt derives again; an exhausted correction allows `<parent>-fix-<n+1>`; forged withdraw history refuses reads.
- **AC-14** [OD-4, FR-021]: a claim reusing an agent of the review's family refuses; a family claim without `assignment` refuses `derive` and, after derivation, reads.

## Edge Cases

- EC-1 [US-1]: two blamed dependencies in one receipt → one derive per parent, in any order while the review is blocked; the review requeues when both have a done correction (OD-3).
- EC-2 [US-1]: a second blocked review after a first correction → a new derive from the new receipt (`impl-fix-2`), on the same chain as `impl-fix-1`; the requeue gate uses the review's latest blocked receipt only.
- EC-10 [US-2]: one blamed dependency's correction exhausted, the other done → the review stays blocked and its `release` is refused (OD-3); a new correction of the exhausted dependency from the same receipt, once done, requeues it.
- EC-3 [US-2]: derived mission blocked and exhausted → review stays blocked, `release` of the review stays refused (OD-3); `derive` from the same receipt creates `<parent>-fix-<n+1>` (B-exhaustion).
- EC-4 [US-3]: `derive` event whose definition revision differs → refused on read.
- EC-5 [US-4]: legacy events without `at` → timeline times `null`, never guessed.
- EC-6 [US-2]: capabilities changed during a derived assignment → same refusal as for any mission.
- EC-7 [US-3]: replay after a later recovery reframe file appears → derive events stay valid (live-only precondition).
- EC-8 [US-1]: `blames` on a derived mission's own receipt → refused (no dependencies).
- EC-9 [US-4]: `view --task impl-fix-1` → item for the derived mission; counts board-wide.
- EC-11 [US-4]: a task named `constructor`, `toString`, `valueOf` or `hasOwnProperty` → `view` and `status --format text` work and its `timeline` is `[]` before its first claim.
- EC-12 [US-2]: an active derived mission counts toward `execution.max_active` and its inherited `allowed_files` block an overlapping concurrent claim (FR-008).

## Runnable Checks

- **CHECK-1** [AC-1, AC-2, AC-3, AC-4, AC-5, AC-10, AC-11, AC-12]: (authentic-success-path, fail-closed-path) `node --test scripts/roster-roadmap-derived.test.js` → exit 0.
- **CHECK-2** [AC-6, AC-7, AC-8]: `node --test scripts/roster-roadmap-derived-view.test.js` → exit 0.
- **CHECK-3** [AC-9]: `npm run test:roadmap` → exit 0.
- **CHECK-4** [AC-9]: `test $(wc -l < scripts/roster-roadmap.cjs) -le 500` → exit 0.
- **CHECK-5** [AC-9]: `bash scripts/sync-harness.sh --check && node scripts/check-pipeline-install.js` → exit 0.
- **CHECK-6** [AC-6, AC-12, AC-13, AC-14]: (authentic-success-path, fail-closed-path) `node --test scripts/roster-roadmap-derived-recovery.test.js` → exit 0.

## Claims Metadata

```claims
{"record":"claims-header","schema_version":1,"namespace":"roadmap-derived-missions","spec_lifecycle":"draft"}
{"record":"requirement","id":"FR-001","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-002","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-003","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-004","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-005","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-006","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-007","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-008","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-009","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-010","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-011","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-012","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-013","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-014","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-015","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-016","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-017","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-018","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-019","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-020","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-021","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-022","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-002","FR-004"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-001","FR-003"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-005","FR-007"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-006","FR-008"]}
{"record":"acceptance-criterion","id":"AC-5","for":["FR-009","FR-010","FR-011"]}
{"record":"acceptance-criterion","id":"AC-6","for":["FR-012","FR-013","FR-014"]}
{"record":"acceptance-criterion","id":"AC-7","for":["FR-014","FR-015"]}
{"record":"acceptance-criterion","id":"AC-8","for":["FR-016","FR-017"]}
{"record":"acceptance-criterion","id":"AC-9","for":["FR-018"]}
{"record":"acceptance-criterion","id":"AC-10","for":["FR-019"]}
{"record":"acceptance-criterion","id":"AC-11","for":["FR-006","FR-020"]}
{"record":"acceptance-criterion","id":"AC-12","for":["FR-007"]}
{"record":"acceptance-criterion","id":"AC-13","for":["FR-003","FR-022"]}
{"record":"acceptance-criterion","id":"AC-14","for":["FR-020","FR-021"]}
{"record":"check","id":"CHECK-1","for":["AC-1","AC-2","AC-3","AC-4","AC-5","AC-10","AC-11","AC-12"]}
{"record":"check","id":"CHECK-2","for":["AC-6","AC-7","AC-8"]}
{"record":"check","id":"CHECK-3","for":["AC-9"]}
{"record":"check","id":"CHECK-4","for":["AC-9"]}
{"record":"check","id":"CHECK-5","for":["AC-9"]}
{"record":"check","id":"CHECK-6","for":["AC-6","AC-12","AC-13","AC-14"]}
```

## Entities

- `DerivedMission`: a correction mission created in `state.json` from a blocked review receipt that blames a dependency; never part of `roadmap.json`.
- `TimelineEntry`: one attempt of a mission with its claim and end times.
