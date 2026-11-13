---
name: roster-spec
type: spec
status: live
feature: Roadmap derived correction missions
brief: briefs/roadmap-derived-missions-intake.md
date: 2026-11-13
version: 1.1.0
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
  definition modified afterwards (FR-019).
- **OD-3 Re-queue (owner decision, Mathias, 13 November 2026)**: a failed review returns to the
  queue only when every dependency its receipt blames has a done derived mission (FR-007). It
  makes D5 precise.
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
| How is derivation bounded? | Each derivation needs a distinct blocked receipt of the review; the review's own `max_attempts` bounds those receipts; a review whose budget is exhausted, whose policy is not `retry`, or that needs a recovery reframe cannot cause a derivation. |
| Is the derived id caller-chosen? | No: tool-assigned `<parent>-fix-<n>` with the smallest `n ≥ 1` not used by any mission; if that exceeds the 80-character identifier limit, `fix-<n>` with the smallest unused `n`. |
| What does the review requeue wait for? (OD-3) | Every dependency named in the `blames` of the review's latest blocked receipt has a `done` derived mission created from that receipt. A blamed dependency without a correction, or whose correction is not done (including exhausted), keeps the review blocked. |
| What is a correction chain? (OD-1) | The code links a derived mission to its `parent` (a contract task) and its `cause` (`task_id` = the review, `attempt_id`/`assignee` = the blocked receipt). The chain of a derived mission with parent P and cause task C is the set {P, C} ∪ {every derived mission whose `parent` is P and whose `cause.task_id` is C}, across every receipt of C (so `impl-fix-2` derived from a second failed review is on the chain of `impl-fix-1`). A review C with at least one derived mission is on the union of its chains (C, every derived mission with `cause.task_id` C, and their parents). A contract task with no derived mission naming it as cause is on no chain when claimed. Deduced, to confirm on the PR: two derived missions with different parents from the same review are on different chains, so one agent may correct both. |
| Which identities does OD-1 compare? | Declared identity only: the `assignee` of every receipt, every claim-event `assignment` and every active assignment of a chain member, as recorded at the time of the claim. Roster cannot tell agents apart; the coordinator must give each attempt the identifier of a newly launched agent. A legacy claim without `assignment` whose attempt was released leaves no identity to compare. |
| What does the derive digest cover? (OD-2) | `definition_digest` = lowercase hex SHA-256 of the UTF-8 bytes of `JSON.stringify` of `{parent, cause, objective, topology, max_attempts}` with object keys sorted at every depth, array order kept and no whitespace (the same canonical form as `contract_digest`). `revision` is not covered: it is checked against the event revision. |
| Can an older runtime read a board written by this version? | No, as soon as the board has one `claim` written by this version (contract or derived mission): every such claim event carries `assignment`, and the pre-feature runtime refuses the whole state (`state event: unknown field assignment`, observed on `status`, `view` and `next`). The same holds for a `derive` event or `state.derived`. A board with only `accept` (or with `record`/`release` events on claims written by the older runtime) stays readable. The new runtime reads older boards unchanged. |
| What does a derived mission inherit? | `intake`, `allowed_files`, `checks`, `dod`, `success`, `inputs`, `outputs` from the parent; `depends_on` is empty (the parent is done); `policy.on_failure` is `retry` with the request's `max_attempts`; `workflow` is `none`. |
| Which predicates stay contract-only? | Completion predicates: "every task done" in `verifyHistory`, the stored global receipt check, `transitionComplete`, `next`'s global-verification branch and the forecast `complete` status mean "every contract task done and no derived mission `queued` or `active`". Everything else iterates missions. |
| What is a "mission"? | The mission set is contract tasks followed by derived missions in creation order. Every check that today iterates contract tasks (task-set equality, budget/assignment/receipt checks, history replay, capacity and write-scope overlap, `next`, `status`, `prompt`, `view`, progress reports, operator-request binding, recovery inspection) iterates missions. A derived mission is resolved to a synthesized task object (FR-005) wherever a task is looked up. |
| Can the review be released while its corrections are pending? | No. While any derived mission created from the review's latest blocked receipt is `queued`, `active`, or `blocked` with attempts left, `release` of the review is refused; the correction path replaces it. When every such correction is exhausted (blocked at its budget), `release` of the review is allowed again under its usual rules. |
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
3. **Given** `review` not blocked, `impl` not done, `impl` not a dependency of `review`, `review` with `on_failure: "block"`, `review` attempts exhausted, or a second derive of `impl` from the same receipt, **When** `derive`, **Then** refused.

### US-2: The derived mission runs as its own mission (Priority: P0)
As the coordinator, I want to claim, record and release the derived mission with its own
budget and agent rules.
**Why this priority**: without it the definition is inert.
**Scope**: This story does NOT cover running the agent.
**Independent Test**: claim/record/release `impl-fix-1` on a fixture board.
**Acceptance Scenarios**:
1. **Given** queued `impl-fix-1`, **When** `claim --task impl-fix-1 --assignee rev1` (the failed reviewer) or `--assignee dev` (the implementer of `impl`), **Then** refused (D2, OD-1); with `--assignee fixer` it succeeds, attempts 1, assignment runtime/route from the derived topology.
4. **Given** `impl-fix-1` blocked by `fixer` and released, **When** `claim --task impl-fix-1 --assignee fixer`, **Then** refused (OD-1); `fixer2` succeeds.
5. **Given** `review` requeued after `impl-fix-1` was done by `fixer2`, **When** `claim --task review` with `dev`, `rev1`, `fixer` or `fixer2`, **Then** refused (OD-1); `rev2` succeeds.
6. **Given** R blames `impl` and `lib` and only `impl-fix-1` exists, **When** `impl-fix-1` is recorded `done`, **Then** `review` stays `blocked`; after `lib-fix-1` is derived and recorded `done`, `review` is `queued` (OD-3).
2. **Given** active `impl-fix-1`, **When** a done receipt with `task_id: "impl-fix-1"` covering the parent's checks and only the parent's `allowed_files` is recorded, **Then** `impl-fix-1` is `done`, and `review` goes `blocked → queued` with a reason naming the correction (D5); `impl` stays `done`.
3. **Given** a blocked receipt for `impl-fix-1`, **When** `release`, **Then** it is requeued while its own attempts remain; at `max_attempts` it is refused.

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
| C-15 | US-2 | Requeue bypassing release guards; review released during corrections | Review frozen (release refused) while corrections are pending; policy and budget checked at derive and cannot change while blocked; reason deterministic. |
| C-16 | US-4 | Past runtime/route/model not reconstructible | Optional `assignment` payload on new claim events; legacy fields `null`. |
| C-17 | US-1 | Unbounded correction work | Derived budget ≤ parent budget; corrections per failure ≤ blamed dependencies; failures ≤ review budget. |
| C-18 | US-4 | Forecast falsely complete; completion counters | ETA unknown while a correction is open; completion counts contract tasks, derived counted separately. |
| C-19 | US-2 | Progress, operator requests and recovery keyed by contract tasks | Generalized to missions. |
| C-20 | US-1 | Id collisions and length | Smallest unused `n`, `fix-<n>` fallback past 80 characters. |

## Functional Requirements

#### Derivation [US-1]
- **FR-001** [US-1]: A task receipt MAY carry `blames`, a nonempty duplicate-free array of the task's direct dependencies, only when `result` is `blocked`; any other use MUST be refused.
- **FR-002** [US-1]: `derive BOARD --coordinator ID --revision N --request FILE` MUST accept exactly `{parent, cause, objective, topology, max_attempts}` with `objective` nonempty ≤ 2000, `topology` validated like a contract topology, `max_attempts` integer from 1 to the parent's `policy.max_attempts`.
- **FR-003** [US-1]: `derive` MUST be refused unless the board is accepted and not complete, the coordinator is the designated one, `cause` is a contract task in `blocked` status whose latest receipt is `blocked` and blames `parent`, `parent` is a contract task in `done` status, `cause.policy.on_failure` is `retry`, `cause` has attempts left, `cause` needs no recovery reframe (checked live only, FR-010), and no derived mission already exists for the same parent and cause receipt.
- **FR-004** [US-1]: `derive` MUST store `state.derived[<id>] = {parent, cause: {task_id, attempt_id, assignee}, objective, topology, max_attempts, revision}` (`revision` = the derive event's revision; id per the Clarifications rule), set `state.tasks[id] = {status: "queued", attempts: 0, assignment: null, reason: null}`, append one `derive` event with `task_id` = id, and leave `roadmap.json`, the parent's state and receipts unchanged; it MUST refuse an id that collides with a contract task or is not a safe identifier.

#### Execution [US-2]
- **FR-005** [US-2]: A derived mission MUST behave as a mission whose `intake`, `objective` (from the request), `inputs`, `outputs`, `allowed_files`, `dod`, `success`, `checks` come from its parent, with `depends_on: []`, its own `topology`, and `policy = {max_attempts, on_failure: "retry"}` plus the parent's `stop_if`, `recovery`, `failure`.
- **FR-006** [US-2]: `claim` of a derived mission MUST refuse the assignee of its cause receipt (and FR-020 applies).
- **FR-007** [US-2]: (OD-3) Recording a `done` receipt for a derived mission MUST, when the cause's latest receipt is still that mission's cause receipt and every dependency named in its `blames` has a `done` derived mission created from that receipt, move the cause task from `blocked` to `queued` with reason `corrections done: <done correction ids in creation order, comma-separated>`, within the same `record` event, and MUST NOT otherwise; while such corrections are pending, `release` of the cause task MUST be refused unless every one of them is blocked with no attempts left.
- **FR-008** [US-2]: `release`, attempt counting, write-scope overlap, capacity, recovery inspection, worker progress reports and operator-request binding MUST apply to derived missions as missions, with their own budget.

#### History [US-3]
- **FR-009** [US-3]: State validation MUST accept an optional `derived` object; every key MUST be a safe identifier present in `state.tasks`, and the accepted state task set MUST equal contract ids ∪ derived ids.
- **FR-010** [US-3]: History replay MUST create each derived mission at its `derive` event, re-check the state-internal FR-003 conditions against the replayed state at that point (not the live recovery file), verify claim-event `assignment` payloads (required on claim events of derived missions; the legacy exemption applies only to contract tasks), replay the review freeze on `release` events using the derived missions known at that point, re-check the cause-assignee ban (FR-006) and the fresh-context rule (FR-020) on claim events against the history before each claim, recompute the derive digest (FR-019), and independently refuse any stored or live receipt and any active assignment of a derived mission whose assignee equals its cause assignee, and reproduce claims, records (including FR-007), releases and attempt counts for derived missions; any mismatch MUST fail reads.
- **FR-011** [US-3]: A state without `derived` MUST read and behave exactly as before.

- **FR-019** [US-3]: (OD-2) `derive` MUST append `definition_digest` to its event, computed per the Clarifications canonical form over `{parent, cause, objective, topology, max_attempts}`; state validation MUST require it on `derive` events and refuse it on any other event; replay MUST recompute it from `state.derived[<id>]` and refuse a mismatch.
- **FR-020** [US-2, US-3]: (OD-1) `claim` of a mission on a correction chain (Clarifications) MUST refuse an assignee that appears as the `assignee` of a receipt, a claim-event `assignment` or an active assignment of any chain member; replay MUST apply the same rule to each claim event against the history before it, and MUST require the claim `assignment` on every claim of a mission on a chain (derived missions and reviews with a derived mission). The check is on declared identity; the identifier MUST designate a newly launched agent.

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
- **AC-12** [OD-3, C-22]: a review blaming two dependencies stays blocked until both have a done correction; a forged early requeue refuses reads.

## Edge Cases

- EC-1 [US-1]: two blamed dependencies in one receipt → one derive per parent, in any order while the review is blocked; the review requeues when both have a done correction (OD-3).
- EC-2 [US-1]: a second blocked review after a first correction → a new derive from the new receipt (`impl-fix-2`), on the same chain as `impl-fix-1`; the requeue gate uses the review's latest blocked receipt only.
- EC-10 [US-2]: one blamed dependency's correction exhausted, the other done → the review stays blocked; its correction freeze is lifted, so `release` of the review is allowed again under its usual rules.
- EC-3 [US-2]: derived mission blocked and exhausted → review stays blocked but `release` of the review becomes allowed again under its usual rules.
- EC-4 [US-3]: `derive` event whose definition revision differs → refused on read.
- EC-5 [US-4]: legacy events without `at` → timeline times `null`, never guessed.
- EC-6 [US-2]: capabilities changed during a derived assignment → same refusal as for any mission.
- EC-7 [US-3]: replay after a later recovery reframe file appears → derive events stay valid (live-only precondition).
- EC-8 [US-1]: `blames` on a derived mission's own receipt → refused (no dependencies).
- EC-9 [US-4]: `view --task impl-fix-1` → item for the derived mission; counts board-wide.

## Runnable Checks

- **CHECK-1** [AC-1, AC-2, AC-3, AC-4, AC-5, AC-10, AC-11, AC-12]: (authentic-success-path, fail-closed-path) `node --test scripts/roster-roadmap-derived.test.js` → exit 0.
- **CHECK-2** [AC-6, AC-7, AC-8]: `node --test scripts/roster-roadmap-derived-view.test.js` → exit 0.
- **CHECK-3** [AC-9]: `npm run test:roadmap` → exit 0.
- **CHECK-4** [AC-9]: `test $(wc -l < scripts/roster-roadmap.cjs) -le 500` → exit 0.
- **CHECK-5** [AC-9]: `bash scripts/sync-harness.sh --check && node scripts/check-pipeline-install.js` → exit 0.

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
{"record":"check","id":"CHECK-1","for":["AC-1","AC-2","AC-3","AC-4","AC-5","AC-10","AC-11","AC-12"]}
{"record":"check","id":"CHECK-2","for":["AC-6","AC-7","AC-8"]}
{"record":"check","id":"CHECK-3","for":["AC-9"]}
{"record":"check","id":"CHECK-4","for":["AC-9"]}
{"record":"check","id":"CHECK-5","for":["AC-9"]}
```

## Entities

- `DerivedMission`: a correction mission created in `state.json` from a blocked review receipt that blames a dependency; never part of `roadmap.json`.
- `TimelineEntry`: one attempt of a mission with its claim and end times.
