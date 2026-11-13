---
name: roster-spec
type: spec
status: draft
feature: Roadmap derived correction missions
brief: briefs/roadmap-derived-missions-intake.md
date: 2026-11-13
version: 1.4.0
---

# Spec — Roadmap derived correction missions

When a review mission of an accepted roadmap fails because of an implementation it depends on,
the coordinator records a **derived correction mission** in `state.json`. It has its own
topology (runtime, model, role), claims, receipts and attempt budget; the implementation stays
`done` and is annotated; the review is requeued automatically when its corrections are done.
While a correction is open, every task that depends on the corrected implementation is frozen.
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
  B-exhaustion, within its cap) or a revised-roadmap decision. The review's `next_action` names
  what to do. It
  makes D5 precise.
- **OD-4 Fresh context over the review's family (owner decision, Mathias, 13 November 2026)**: an
  assignee cannot take a correction of a review, or the review's next attempt, if it appeared on
  that review, on any mission the review blames, or on any of their corrections (FR-020). It
  widens OD-1 from one parent's chain to the whole family of the review.
- **Precisions of OD-1 and OD-4 (decided by the coordinator in the owner's name after the third
  review, 13 November 2026; to be confirmed on the PR)**. P1: an attempt that left a receipt has a
  known identity, so a claim without `assignment` hides an agent only when its attempt was
  released without a receipt (FR-021). P2: the family holds every correction of the dependencies
  concerned, whichever review caused it, and the rule applies to the claim of every task that
  depends on a corrected task, so the author of a correction cannot validate it in a second review
  (FR-020). P3: only a correction that never started can be withdrawn (FR-022). P4: corrections of
  one dependency for one review receipt are capped by that dependency's `max_attempts` (FR-003).
  P5: `next_action` never advises a derivation that would be refused (FR-007), and a correction on
  its last attempt can always end by a blocked receipt (FR-023).
- **OD-5 Frozen until the correction (owner decision, Mathias, 13 November 2026, after the fourth
  review)**: « Gelées jusqu'à la correction. » A dependency that has an open correction (queued,
  active, or blocked with attempts left) counts as **not satisfied** for **every** task that
  depends on it, not only for the review that blamed it. Such a task cannot be claimed (so `next`
  and `prompt` do not offer it); one that is already active cannot record `done` while the
  correction is open (a `blocked` receipt stays allowed); the fresh-context rule is checked again
  at `record`, not only at `claim`; replay applies the same checks (FR-024). It closes the first
  hole of the fourth review (an agent holding a second review writing the correction then
  validating it) and only partially the second (a second review completed on the implementation
  from before the correction): the freeze starts at `derive`, not at the blaming receipt, so
  "Known limitations" A to D remain, accepted by the owner on 13 November 2026 (merge with the
  limits documented, no further behavior change).
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
| How is derivation bounded? | Each blocked receipt of the review can derive, per blamed dependency, one correction at a time: a new one only after the previous one for that dependency and receipt is exhausted or withdrawn (B-exhaustion, each with a fresh budget capped by the parent's). The corrections of one dependency for one receipt that were not withdrawn are capped by the parent's `policy.max_attempts`; a withdrawn correction never ran (FR-022) and does not count toward that cap, but the withdrawn corrections of one dependency for one receipt are capped by the same number, counted apart, so `derive` and `withdraw-derived` cannot alternate forever (at most twice the parent's `max_attempts` corrections per receipt and dependency; with a parent budget of 1, one withdrawal already ends derivation for that receipt). At either cap the way forward is a revised-roadmap decision. The review's own `max_attempts` bounds its receipts; a review whose budget is exhausted, whose policy is not `retry`, or that needs a recovery reframe cannot cause a derivation. Exhausted and withdrawn corrections stay in the history. |
| Is the derived id caller-chosen? | No: tool-assigned `<parent>-fix-<n>` with the smallest `n ≥ 1` not used by any mission; if that exceeds the 80-character identifier limit, `fix-<n>` with the smallest unused `n`. |
| What does the review requeue wait for? (OD-3) | Every dependency named in the `blames` of the review's latest blocked receipt has a `done` derived mission created from that receipt. A blamed dependency without a correction, or whose corrections are not done (pending, exhausted or withdrawn), keeps the review blocked and its `release` refused. |
| What is a correction chain? (OD-1, OD-4) | The code links a derived mission to its `parent` (a contract task) and its `cause` (`task_id` = the review, `attempt_id`/`assignee` = the blocked receipt). The rule applies to the **family** of a review C: C, every dependency named in the `blames` of any receipt of C, every dependency of C that has a correction, and every correction of those dependencies, whichever review caused it (withdrawn and exhausted ones included). A derived mission is on the family of its cause. A contract task one of whose dependencies has a correction is on its own family: Roster cannot tell a review from another dependent task, so the rule covers every task that depends on a corrected one. A contract task none of whose dependencies has a correction is on no family when claimed. For the claim of a derived mission the family is widened (OD-5) by every contract task that depends on its parent. So one agent cannot correct two dependencies blamed by the same review, nor correct one after implementing another, nor take a second review (`qa`) of a dependency it corrected, nor write the correction of `impl` caused by `review` while it holds, or after it held, an attempt of `qa` that depends on `impl`. The widening applies to corrections only: the family of a contract task is unchanged, so an agent that worked on `qa` may still take the next attempt of `review` unless it is on the family of `review` for another reason. |
| Which identities does OD-1 compare? | Declared identity only: the `assignee` of every receipt, every claim-event `assignment` and every active assignment of a family member, as recorded at the time of the claim, and again when a `done` receipt is recorded (every attempt but the one being recorded, FR-024). Labels are compared exactly, case included: `Fixer` and `fixer` are two agents for the tool. Roster cannot tell agents apart; the coordinator must give each attempt the identifier of a newly launched agent. A claim without `assignment` (written by an older runtime, or the field deleted) whose attempt ended with a receipt is known by that receipt. Only one whose attempt was released without a receipt leaves no identity to compare, so `derive` and its replay refuse a family that holds one (FR-021); claims of contract tasks outside any family keep the legacy exemption. On a board that mixes both claim formats FR-021 has a gap by construction: an older-format attempt that left a receipt is known only by that receipt's `assignee`, and nothing can check that label against the claim it answered. |
| What does the derive digest cover? (OD-2) | `definition_digest` = lowercase hex SHA-256 of the UTF-8 bytes of `JSON.stringify` of `{parent, cause, objective, topology, max_attempts}` with object keys sorted at every depth, array order kept and no whitespace (the same canonical form as `contract_digest`). `revision` is not covered: it is checked against the event revision. It is unkeyed and lives in `state.json`: it detects an accidental or naive edit, not a deliberate forgery by someone who recomputes it. |
| Can an older runtime read a board written by this version? | No, as soon as the board has one `claim` written by this version (contract or derived mission), **even if no `derive` was ever run**: every such claim event carries `assignment`, and the pre-feature runtime refuses the whole state (`state event: unknown field assignment`, observed on `status`, `view` and `next`). The same holds for a `derive` or `withdraw-derived` event, a `withdrawn` task or `state.derived`. A board with only `accept` (or with `record`/`release` events on claims written by the older runtime) stays readable. The new runtime reads older boards unchanged and can derive on them, unless a family member has a claim without `assignment` that was released without a receipt (FR-021). |
| What does a derived mission inherit? | `intake`, `allowed_files`, `checks`, `dod`, `success`, `inputs`, `outputs` from the parent; `depends_on` is empty (the parent is done); `policy.on_failure` is `retry` with the request's `max_attempts`; `workflow` is `none`. |
| Which predicates stay contract-only? | Completion predicates: "every task done" in `verifyHistory`, the stored global receipt check, `transitionComplete`, `next`'s global-verification branch and the forecast `complete` status mean "every contract task done and no derived mission `queued` or `active`". Everything else iterates missions. |
| What is a "mission"? | The mission set is contract tasks followed by derived missions in creation order. Every check that today iterates contract tasks (task-set equality, budget/assignment/receipt checks, history replay, capacity and write-scope overlap, `next`, `status`, `prompt`, `view`, progress reports, operator-request binding, recovery inspection) iterates missions. A derived mission is resolved to a synthesized task object (FR-005) wherever a task is looked up. |
| Can the review be released while its corrections are pending? | No (OD-3, strict). While any dependency blamed by the review's latest blocked receipt has no done correction created from that receipt (never derived, queued, active, blocked, exhausted or withdrawn), `release` of the review is refused, and its `next_action` says what to do, naming only gestures the tool accepts: `derive a correction for <dependency>`; for a pending correction the step of its state (queued: claim it with a newly launched agent, or withdraw it if it was never claimed and cannot be claimed; active: finish the attempt and record its receipt; blocked with attempts left: release it, then claim it with a newly launched agent; blocked after three consecutive failures: record a diagnosed reframe with `roster-recovery reframe`, then release it; started, queued and without a claimable route: restore a claimable route in `capabilities.json` or request a revised-roadmap decision); or, when none succeeded, derive a new correction for the same receipt or request a revised-roadmap decision; it lists the exhausted and withdrawn corrections of that dependency. When that derivation would itself be refused (policy, budgets, caps, reframe, unknown identity), the text says `no correction can be derived for <dependency>` with the reason and the real way forward instead. The `release` refusal promises the automatic requeue only when at least one blamed dependency can still get a correction. The `next_action` of an exhausted correction refers to the `next_action` of the review that caused it. A blocked receipt without `blames` keeps the usual release rules. |
| What if a correction can never be claimed? | `derive` refuses a topology with no claimable route at derivation time (runtime unavailable, or route unsupported or unauthorized with no permitted fallback; checked live only). If it becomes unclaimable later and was never claimed (`attempts` 0), `withdraw-derived` retires it (FR-022); the same receipt can then derive again, within the cap on withdrawals. A correction that already started cannot be withdrawn: it ends by its receipts and its budget. If a started correction is queued and unclaimable, the ways forward are restoring a claimable route in `capabilities.json` or a revised-roadmap decision, and the `next_action` of its cause review says so. |
| What if capabilities change during a correction's last attempt? | For a derived mission only, `record` accepts a `blocked` receipt after `capabilities.json` changed during the assignment (FR-023): the receipt only ends the attempt, and without it the correction could be neither recorded, released (budget), withdrawn (started) nor completed around. A `done` receipt still needs unchanged capabilities, and contract tasks keep the refusal for both results. If the agent is gone, the coordinator records the blocked receipt under the attempt id and assignee of the assignment; the mission's `next_action` says so. Known limit: a contract task (a review, for instance) that is active on its last attempt when `capabilities.json` changed and whose agent is gone has no such exception; `record` refuses both results and `release` is refused at the budget, so its only exit is restoring `capabilities.json` to the content it had at the claim (or a revised roadmap). |
| What does a state.json without signature not protect? | Labels and digests are local assertions. Someone who edits `state.json` can recompute `definition_digest`, add `blames` to a stored blocked receipt before deriving, or remove a `derive` event with its definition, task state, the correction's claims and receipts, renumbering the later events (the board then reads as if the correction never existed). In the same class: renaming the `assignee` of an attempt that was released without a receipt, in its claim event (and in the active assignment while it lasts), passes reads, because no receipt names that agent. Replay detects inconsistent edits, not a consistent rewrite. |
| What is frozen while a correction is open? (OD-5) | A correction is **open** while it is `queued`, `active`, or `blocked` with attempts left; an exhausted or withdrawn one is not. While a dependency has an open correction it is unmet for every task that depends on it, whichever review caused the correction: `claim` refuses with `waiting for dependencies: <dependency> (open correction <id>)`, so `next` and `prompt` do not offer the task, and its `status` reason says the same. A dependent that was already active cannot record `done` (a `blocked` receipt is accepted; its `next_action` says so). When a `done` receipt is recorded the fresh-context rule is checked again against every other attempt of the task's family; a `blocked` receipt is never refused by it. Limits: the freeze starts at `derive`, not at the blaming receipt, so between the two another dependent can still be claimed; an attempt of a dependent that started before the correction can record `done` once the correction is done, if its agent is fresh; an exhausted correction freezes nothing, the review that caused it stays blocked (OD-3) but other dependents are claimable again. |
| How is replay kept independent of external files? | The recovery-reframe precondition of `derive` is checked when the command runs, never during replay; replay only re-checks preconditions derivable from `state.json` and the contract. |
| How are attempt times and identities kept for the timeline? | New `claim` events carry an optional `assignment` = `{id, assignee, runtime, route, model}` copied from the assignment the claim created; replay checks it matches. Legacy claim events without it leave those timeline fields `null` (attempt id still taken from a receipt when one exists). |
| Budget bound? | A derive request's `max_attempts` must be ≤ the parent's `policy.max_attempts`. Per review receipt and blamed dependency: at most the parent's `max_attempts` corrections that ran, each with at most the parent's `max_attempts` attempts, and at most the parent's `max_attempts` withdrawn corrections (which never ran). Review receipts ≤ the review's budget. |
| Forecasts? | While any derived mission is `queued` or `active`, task and global ETAs are `unknown` with a reason naming it, checked before any `complete` status; blocked (exhausted) derived missions are ignored by the schedule simulation, and a blocked correction with attempts left keeps the tasks that depend on its parent unclaimable in it (OD-5); estimates files are unchanged and cannot hold derived ids. |
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
3. **Given** `review` not blocked, `impl` not done, `impl` not a dependency of `review`, `review` with `on_failure: "block"`, `review` attempts exhausted, a second derive of `impl` from the same receipt while `impl-fix-1` is pending or done, as many corrections of `impl` for that receipt as `impl`'s `max_attempts` (withdrawn ones excluded), as many withdrawn corrections of `impl` for that receipt as `impl`'s `max_attempts`, a topology with no claimable route, or an earlier claim of the review's family (widened by the tasks that depend on `impl`) without `assignment` whose attempt was released without a receipt, **When** `derive`, **Then** refused.
4. **Given** `impl-fix-1` exhausted (blocked at its budget) or withdrawn, and the cap not reached, **When** `derive` names `impl` again for the same receipt, **Then** `impl-fix-2` is created with its own budget (capped by the parent's) and `impl-fix-1` stays in the history.
5. **Given** a board whose claims were written by an older runtime (no `assignment`) and whose attempts all ended with a receipt, **When** `derive`, **Then** it succeeds, and the fresh-context rule refuses the assignees named by those receipts.

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
8. **Given** blocked `review` whose latest receipt blames `impl`, **When** `release --task review` with no correction, a pending one, or only exhausted or withdrawn ones, **Then** refused (OD-3), and `status` gives `review` a `next_action` naming the step (`derive a correction for impl`, the step of the pending one according to its state, or derive a new one) and the exhausted and withdrawn corrections; when `derive` would be refused it names the reason and the way forward instead.
9. **Given** queued, never-claimed `impl-fix-1` whose topology is no longer claimable, **When** `withdraw-derived --task impl-fix-1 --withdrawal w.json` (`{reason}`) by the coordinator, **Then** `impl-fix-1` is `withdrawn` with that reason, one `withdraw-derived` event is appended, and a new `derive` from the same receipt is allowed; withdrawal of an active, blocked or done correction, of a queued one that was already claimed, of a contract mission, without a reason file or by another coordinator is refused.
10. **Given** `impl-fix-1` done by `fixer` and a second review `qa` that depends on `impl`, **When** `claim --task qa --assignee fixer` (or `dev`), **Then** refused; and if `qa` blocks blaming `impl`, `fixer` cannot claim `impl-fix-2` either (OD-4, P2).
11. **Given** active `impl-fix-1` on its last attempt and `capabilities.json` changed, **When** a `blocked` receipt is recorded, **Then** accepted and `impl-fix-1` is exhausted; a `done` receipt is refused (FR-023).
12. **Given** `max_active` 2, `qa` (depends on `impl`) active for `xx`, then `review` blocked blaming `impl` and `impl-fix-1` derived, **When** `claim --task impl-fix-1 --assignee xx`, **Then** refused (OD-5); the same holds when `xx` only held `qa` earlier and released it; **When** a `done` receipt of `qa` is recorded while `impl-fix-1` is queued, active or blocked with attempts left, **Then** refused; a `blocked` receipt of `qa` is accepted; once `impl-fix-1` is done the `done` receipt of `qa` is accepted.
13. **Given** `qa` blocked blaming `impl` and `impl-fix-1` derived from it, **When** `claim --task review` (another task that depends on `impl`), **Then** refused with `waiting for dependencies: impl (open correction impl-fix-1)` while `impl-fix-1` is queued, active or blocked with attempts left, and accepted once it is done; an exhausted or withdrawn correction does not freeze `review`.
14. **Given** `dev` (the implementer of `impl`) active on `qa` since before any correction, and `impl-fix-1` then derived and done, **When** `dev` records a `done` receipt of `qa`, **Then** refused (fresh context checked at record); a `blocked` receipt is accepted.

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
6. **Given** a history in which a task was claimed while one of its dependencies had an open correction, a `done` receipt was recorded during it, a correction was claimed by an agent of a task that depends on its parent, or a `done` receipt names an agent already seen on its family in another attempt, **Then** reads fail (OD-5).

### US-4: View and timeline show derived missions and attempts (Priority: P0)
As the operator or a Gantt page reading `view`, I want each derived mission and each attempt with its times.
**Why this priority**: D6.
**Scope**: This story does NOT cover drawing the Gantt.
**Independent Test**: inspect `view` and text status on a fixture board.
**Acceptance Scenarios**:
1. **Given** a derived mission, **When** `view`, **Then** `tasks` contains it with `kind: "derived"` and `derived = {parent, cause, created_at}`, and the parent item has `corrections: ["impl-fix-1"]`.
2. **Given** claims, records and releases, **When** `view`, **Then** each mission item has `timeline` entries `{attempt, attempt_id, assignee, runtime, route, model, claimed_at, ended_at, outcome}` in order, with `outcome` `active|done|blocked|released`, and `null` times for legacy events without `at`.
3. **Given** `status --format text`, **Then** the derived mission appears with its parent and cause, contract tasks and corrections are counted apart, a withdrawal or requeue reason is labelled as such, and each attempt of a correction and of its review has one line.
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
4. **Given** queued `review` and `qa` blocked blaming `impl` with `impl-fix-1` queued, **When** `next` or `prompt`, **Then** the ready mission is `impl-fix-1`, not `review` (OD-5).

## Known limitations

Accepted by the owner on 13 November 2026 after the last review round: the feature merges with
these limits documented and no further behavior change. Two reviewers found no divergence between
command and replay and no way around the attempt caps. Each limit gives the coordinator's conduct.

- **A. The freeze starts at `derive`, not at the blocked receipt that blames.** Between the two,
  `next` and `prompt` can offer a dependent of the blamed parent, and it can be validated on the
  implementation from before the correction. The same holds after a correction is exhausted or
  withdrawn (`withdraw-derived` lifts the freeze). An attempt of a dependent that started before
  the correction can record `done` once the correction is done. Conduct: derive the correction
  immediately after the receipt that blames; claim no dependent of the parent in between; do not
  withdraw or exhaust a correction while a dependent is active unless the dependent is to be
  re-run.
- **B. Circular wait.** `derive` is accepted even when an active dependent of the parent prevents
  claiming the correction (`max_active` reached, overlapping `allowed_files`, no `parallel`). That
  dependent cannot record `done` during the correction, so with budgets of 1 the only way out is a
  `blocked` receipt or a withdrawal. The `next_action` "wait for it" is misleading in that case.
  Conduct: before `derive`, check that the correction can be claimed; on a circular wait, record a
  `blocked` receipt for the dependent or withdraw the correction.
- **C. A dependent held by an agent that later appears on the correction chain** can neither
  record `done` nor be released once its budget is exhausted, and its `next_action` still says
  "Continue the owned attempt". Conduct: give every correction attempt a newly launched agent
  (fresh context) and record a `blocked` receipt for such a dependent.
- **D. Transitive dependencies are not frozen and not in the family.** A task that depends on a
  `done` dependent of the parent is neither frozen nor checked for fresh context. Conduct: treat
  such tasks as dependents by hand and claim them only after the correction is done.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | Unbounded derivation loops | Bounded by distinct blocked review receipts, the review's own budget, and per receipt and dependency by the parent's `max_attempts`, once for the corrections that ran and once for the withdrawn ones; refused when the review cannot retry or needs a reframe. |
| C-2 | US-1 | Who decides the blame | The review receipt itself (`blames`), validated against `depends_on`; the coordinator cannot derive without it. |
| C-3 | US-2 | Same agent fixing as reviewing | Claim refuses the cause receipt's assignee, and (OD-1, OD-4) every assignee already seen on the review's family, at claim and on replay; a second review of a corrected dependency is on a family too (P2), and a correction's family holds every task that depends on its parent (OD-5). Labels are unauthenticated assertions (documented). |
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
| C-23 | US-2 | A correction that can never be claimed freezes the review | `derive` refuses an unclaimable topology (live); `withdraw-derived` retires a never-claimed correction so the receipt can derive again (FR-022). A started one needs its route restored or a revised roadmap (documented, not solved by the tool). |
| C-24 | US-3 | An identity hidden by a claim without `assignment` | `derive` and its replay refuse a family holding one whose attempt left no receipt; a receipt makes the identity known, so older boards still derive (FR-021). |
| C-25 | US-2 | An active correction on its last attempt after a capabilities change has no exit | A blocked receipt of a derived mission is accepted despite the change (FR-023). |
| C-26 | US-2 | `next_action` advising a derivation that will be refused | The advice runs the request-independent preconditions of `derive` and states the reason and way forward (FR-007). |
| C-27 | US-2 | An agent holding a second review writes the correction, then validates it | OD-5: the correction's family holds the tasks that depend on its parent; a `done` receipt is refused while a dependency is under correction and re-checks fresh context; same on replay (FR-024). |
| C-28 | US-5 | A second review completed on the implementation from before the correction | OD-5: a dependency with an open correction is unmet for every dependent, in `claim`, `next`, `prompt` and replay (FR-024). The window between the blaming receipt and `derive` stays open (documented). |
| C-29 | US-1 | `derive` and `withdraw-derived` alternating forever | Withdrawn corrections per receipt and dependency are capped by the parent's `max_attempts` (FR-003). |
| C-16 | US-4 | Past runtime/route/model not reconstructible | Optional `assignment` payload on new claim events; legacy fields `null`. |
| C-17 | US-1 | Unbounded correction work | Derived budget ≤ parent budget; corrections that ran, per receipt and dependency, ≤ parent budget; failures ≤ review budget. |
| C-18 | US-4 | Forecast falsely complete; completion counters | ETA unknown while a correction is open; completion counts contract tasks, derived counted separately. |
| C-19 | US-2 | Progress, operator requests and recovery keyed by contract tasks | Generalized to missions. |
| C-20 | US-1 | Id collisions and length | Smallest unused `n`, `fix-<n>` fallback past 80 characters. |

## Functional Requirements

#### Derivation [US-1]
- **FR-001** [US-1]: A task receipt MAY carry `blames`, a nonempty duplicate-free array of the task's direct dependencies, only when `result` is `blocked`; any other use MUST be refused.
- **FR-002** [US-1]: `derive BOARD --coordinator ID --revision N --request FILE` MUST accept exactly `{parent, cause, objective, topology, max_attempts}` with `objective` nonempty ≤ 2000, `topology` validated like a contract topology, `max_attempts` integer from 1 to the parent's `policy.max_attempts`.
- **FR-003** [US-1]: `derive` MUST be refused unless the board is accepted and not complete, the coordinator is the designated one, `cause` is a contract task in `blocked` status whose latest receipt is `blocked` and blames `parent`, `parent` is a contract task in `done` status, `cause.policy.on_failure` is `retry`, `cause` has attempts left, `cause` needs no recovery reframe (checked live only, FR-010), at least one route of the requested topology is claimable now (checked live only), no derived mission for the same parent and cause receipt is pending or done (an exhausted or withdrawn one allows a new derivation, B-exhaustion), the derived missions for the same parent and cause receipt that are not withdrawn number fewer than the parent's `policy.max_attempts`, the withdrawn ones for the same parent and cause receipt also number fewer than the parent's `policy.max_attempts`, and FR-021 holds.
- **FR-004** [US-1]: `derive` MUST store `state.derived[<id>] = {parent, cause: {task_id, attempt_id, assignee}, objective, topology, max_attempts, revision}` (`revision` = the derive event's revision; id per the Clarifications rule), set `state.tasks[id] = {status: "queued", attempts: 0, assignment: null, reason: null}`, append one `derive` event with `task_id` = id, and leave `roadmap.json`, the parent's state and receipts unchanged; it MUST refuse an id that collides with a contract task or is not a safe identifier.

#### Execution [US-2]
- **FR-005** [US-2]: A derived mission MUST behave as a mission whose `intake`, `objective` (from the request), `inputs`, `outputs`, `allowed_files`, `dod`, `success`, `checks` come from its parent, with `depends_on: []`, its own `topology`, and `policy = {max_attempts, on_failure: "retry"}` plus the parent's `stop_if`, `recovery`, `failure`.
- **FR-006** [US-2]: `claim` of a derived mission MUST refuse the assignee of its cause receipt (and FR-020 applies).
- **FR-007** [US-2]: (OD-3) Recording a `done` receipt for a derived mission MUST, when the cause's latest receipt is still that mission's cause receipt and every dependency named in its `blames` has a `done` derived mission created from that receipt, move the cause task from `blocked` to `queued` with reason `corrections done: <done correction ids in creation order, comma-separated>`, within the same `record` event, and MUST NOT otherwise. `release` of a `blocked` task MUST be refused while any dependency named in the `blames` of its latest blocked receipt has no `done` derived mission created from that receipt, with no exception for exhausted or withdrawn corrections; the task's `next_action` MUST name the step for each such dependency and its exhausted and withdrawn corrections, and MUST NOT advise a derivation that the request-independent conditions of FR-003 would refuse: it then states that reason and its way forward. For a pending correction the step MUST follow its state and name only an accepted gesture: claim (or withdraw when never claimed), finish the active attempt, release when blocked with attempts left, `roster-recovery reframe` when its release needs a diagnosed reframe, and restoring a claimable route in `capabilities.json` or a revised-roadmap decision when it started and has no claimable route. The `release` refusal MUST mention the automatic requeue only when at least one such dependency can still get a correction. The `next_action` of an exhausted derived mission whose cause is still blocked MUST refer to the `next_action` of that cause.
- **FR-008** [US-2]: `release`, attempt counting, write-scope overlap, capacity, recovery inspection, worker progress reports and operator-request binding MUST apply to derived missions as missions, with their own budget.

#### History [US-3]
- **FR-009** [US-3]: State validation MUST accept an optional `derived` object; every key MUST be a safe identifier present in `state.tasks`, and the accepted state task set MUST equal contract ids ∪ derived ids.
- **FR-010** [US-3]: History replay MUST create each derived mission at its `derive` event, re-check the state-internal FR-003 conditions against the replayed state at that point (not the live recovery file), verify claim-event `assignment` payloads (required on claim events of derived missions; the legacy exemption applies only to contract tasks), replay the review freeze on `release` events using the derived missions known at that point, re-check the cause-assignee ban (FR-006) and the fresh-context rule (FR-020) on claim events against the history before each claim, re-check the freeze of FR-024 on claim and record events, recompute the derive digest (FR-019), and independently refuse any stored or live receipt and any active assignment of a derived mission whose assignee equals its cause assignee, and reproduce claims, records (including FR-007), releases and attempt counts for derived missions; any mismatch MUST fail reads.
- **FR-011** [US-3]: A state without `derived` MUST read and behave exactly as before.

- **FR-019** [US-3]: (OD-2) `derive` MUST append `definition_digest` to its event, computed per the Clarifications canonical form over `{parent, cause, objective, topology, max_attempts}`; state validation MUST require it on `derive` events and refuse it on any other event; replay MUST recompute it from `state.derived[<id>]` and refuse a mismatch. The digest detects an accidental or naive edit, not a deliberate forgery of `state.json` (it is unkeyed and stored beside the definition); documentation MUST NOT claim more.
- **FR-020** [US-2, US-3]: (OD-1, OD-4) `claim` of a mission on a review's family (Clarifications) MUST refuse an assignee that appears as the `assignee` of a receipt, a claim-event `assignment` or an active assignment of any family member; replay MUST apply the same rule to each claim event against the history before it, and MUST require the claim `assignment` on every claim of a mission on a family (derived missions, and contract tasks one of whose dependencies has a correction at that point). For the claim of a derived mission the family MUST also hold every contract task that depends on its parent (OD-5). The check is on declared identity, compared exactly (case included); the identifier MUST designate a newly launched agent.
- **FR-021** [US-1, US-3]: `derive` and its replay MUST refuse the derivation when a claim event of a member of the review's family, or of a contract task that depends on the parent, has no `assignment` and its attempt was released without a receipt, with a message saying the fresh-context rule cannot see who worked on that family; a claim without `assignment` whose attempt ended with a receipt MUST NOT refuse it (the receipt names the agent); the board stays readable otherwise.
- **FR-022** [US-2, US-3]: `withdraw-derived BOARD --coordinator ID --revision N --task ID --withdrawal FILE` (FILE exactly `{reason}`, nonempty, ≤ 2000 characters) MUST, for the designated coordinator and a `queued` derived mission with 0 attempts only, set its status to `withdrawn` with that reason and append one `withdraw-derived` event carrying `task_id` and `reason`; replay MUST reproduce it and refuse it on any other mission, status or attempt count. A withdrawn mission is terminal, never claimable or releasable, does not block completion, and counts as settled for FR-003.
- **FR-023** [US-2]: For a derived mission only, `record` MUST accept a `blocked` receipt of the active assignment when `capabilities.json` changed since its claim, and MUST still refuse a `done` receipt in that case; contract tasks keep the refusal for both results. The `next_action` of an active derived mission on its last attempt MUST say that the coordinator records a blocked receipt when the agent is gone.
- **FR-024** [US-2, US-3, US-5]: (OD-5) A derived mission is open while it is `queued`, `active`, or `blocked` with attempts below its `max_attempts`. While a dependency of a task has an open derived mission whose parent it is, `claim` of that task MUST be refused as an unmet dependency naming the correction (so `next` and `prompt` MUST NOT offer it), and `record` of a `done` receipt of that task MUST be refused; a `blocked` receipt MUST stay accepted. `record` of a `done` receipt of a mission on a family MUST refuse an assignee that appears on that family (FR-020) in any attempt other than the one recorded. Replay MUST apply the same three checks to claim and record events against the history before each of them.

#### Observation [US-4]
- **FR-012** [US-4]: `view.tasks` MUST list contract tasks then derived missions; every item MUST carry `kind: "contract"|"derived"`, `derived` (`{parent, cause, created_at}` or `null`), `corrections` (derived ids for a contract task, `[]` otherwise) and `timeline`; the schema declares them without making them required, so earlier saved views still validate.
- **FR-013** [US-4]: `timeline` entries MUST be `{attempt, attempt_id, assignee, runtime, route, model, claimed_at, ended_at, outcome}` in claim order; `outcome ∈ {active, done, blocked, released}`; a released attempt has no receipt, so its `attempt_id` comes from the claim event's `assignment` and is `null` only when that claim has none; attempt `n` of a mission is its `n`-th claim; it ends at the next `record` (outcome = receipt result) or at a `release` of an active assignment (outcome `released`); a later release of a blocked mission is not an attempt; `attempt_id`, `runtime`, `route`, `model` come from the claim event's `assignment` (or the receipt's `attempt_id`), else `null`; times are the events' `at` or `null`.
- **FR-014** [US-4]: `status --format text` MUST show each derived mission with its parent and cause, count contract tasks and corrections apart, label a mission's reason `Withdrawn:` when it is withdrawn, `Requeued:` when it is queued and `Blocker:` otherwise, and list one line per attempt (assignee, outcome, claim and end times) for every derived mission and every mission with a blocked attempt or more than one attempt; `view.schema.json` MUST declare the new fields; view `schema_version` stays 1.
- **FR-015** [US-4]: While any derived mission is `queued` or `active`, `estimates.tasks_eta` and `global_eta` MUST be `unknown` with a reason naming the derived mission(s).

#### Continuation [US-5]
- **FR-016** [US-5]: `next` MUST consider derived missions after contract tasks, in creation order.
- **FR-017** [US-5]: `prompt --task <derived id>` MUST render the mission view with a `derived` block; `complete` MUST be refused while a derived mission is `queued` or `active`; `view --task <derived id>` MUST work; `completion.tasks_done/tasks_total` MUST count contract tasks only, with `completion.derived_done/derived_total` and the optional `completion.derived_active/derived_blocked` alongside.

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
- **AC-13** [FR-003, FR-022]: an unclaimable topology refuses `derive`; `withdraw-derived` retires a never-claimed correction and the same receipt derives again; a started correction refuses withdrawal, live and on replay; an exhausted correction allows `<parent>-fix-<n+1>` until the parent's `max_attempts` corrections ran for that receipt; as many withdrawals as the parent's `max_attempts` for one receipt refuse a further `derive`; forged withdraw history refuses reads.
- **AC-14** [OD-4, FR-021]: a claim reusing an agent of the review's family refuses, including on a second review of a corrected dependency; a family claim without `assignment` released without a receipt refuses `derive` and, after derivation, reads; a board whose legacy claims all have receipts derives.
- **AC-15** [FR-023, FR-007]: a blocked receipt ends a correction's last attempt after a capabilities change, a done one does not, a contract task keeps the refusal; `next_action` names the reason instead of `derive` when the policy, the cap, a reframe or an unknown identity would refuse it; the step of a pending correction follows its state (claim, finish, release, `roster-recovery reframe`, restore a route); an exhausted correction refers to its cause; the `release` refusal omits the automatic requeue when no gap can be closed.
- **AC-16** [FR-014]: text status counts corrections apart, labels withdrawal and requeue reasons, and lists attempts.
- **AC-17** [OD-5, FR-024, C-27, C-28]: an agent holding or having held an attempt of a task that depends on the parent cannot claim its correction; a dependent cannot be claimed, nor offered by `next` or `prompt`, while a correction of its dependency is open, and can once it is done, exhausted or withdrawn; an active dependent cannot record `done` during the correction and can record `blocked`; a `done` receipt by an agent already seen on the family is refused; hand-written histories doing any of these refuse reads.

## Edge Cases

- EC-1 [US-1]: two blamed dependencies in one receipt → one derive per parent, in any order while the review is blocked; the review requeues when both have a done correction (OD-3).
- EC-2 [US-1]: a second blocked review after a first correction → a new derive from the new receipt (`impl-fix-2`), on the same chain as `impl-fix-1`; the requeue gate uses the review's latest blocked receipt only.
- EC-10 [US-2]: one blamed dependency's correction exhausted, the other done → the review stays blocked and its `release` is refused (OD-3); a new correction of the exhausted dependency from the same receipt, once done, requeues it.
- EC-3 [US-2]: derived mission blocked and exhausted → review stays blocked, `release` of the review stays refused (OD-3); `derive` from the same receipt creates `<parent>-fix-<n+1>` (B-exhaustion) until the cap of FR-003.
- EC-4 [US-3]: `derive` event whose definition revision differs → refused on read.
- EC-5 [US-4]: legacy events without `at` → timeline times `null`, never guessed.
- EC-6 [US-2]: capabilities changed during a derived assignment → a `done` receipt is refused as for any mission; a `blocked` receipt is accepted (FR-023).
- EC-14 [US-2]: `qa` active before `review` blames `impl` → `qa` keeps its attempt; it cannot record `done` until the correction is done and can record `blocked` (which, on its last attempt, exhausts it).
- EC-15 [US-5]: a dependency blamed by a blocked receipt but with no correction derived yet → its other dependents are still claimable; the freeze starts at `derive` (OD-5 as decided).
- EC-16 [US-1]: parent `max_attempts` 1 → one withdrawal for a receipt ends derivation for that receipt; revise the roadmap.
- EC-13 [US-2]: a correction released after a first attempt, then unclaimable → not withdrawable; restore a route in `capabilities.json` or revise the roadmap.
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
- **CHECK-7** [AC-13, AC-14, AC-15, AC-16]: (authentic-success-path, fail-closed-path) `node --test scripts/roster-roadmap-derived-liveness.test.js` → exit 0.
- **CHECK-8** [AC-13, AC-15, AC-17]: (authentic-success-path, fail-closed-path) `node --test scripts/roster-roadmap-derived-freeze.test.js` → exit 0.

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
{"record":"requirement","id":"FR-023","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-024","lifecycle":"draft","external_sources":[],"depends_on":[]}
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
{"record":"acceptance-criterion","id":"AC-15","for":["FR-007","FR-023"]}
{"record":"acceptance-criterion","id":"AC-16","for":["FR-014"]}
{"record":"acceptance-criterion","id":"AC-17","for":["FR-020","FR-024"]}
{"record":"check","id":"CHECK-1","for":["AC-1","AC-2","AC-3","AC-4","AC-5","AC-10","AC-11","AC-12"]}
{"record":"check","id":"CHECK-2","for":["AC-6","AC-7","AC-8"]}
{"record":"check","id":"CHECK-3","for":["AC-9"]}
{"record":"check","id":"CHECK-4","for":["AC-9"]}
{"record":"check","id":"CHECK-5","for":["AC-9"]}
{"record":"check","id":"CHECK-6","for":["AC-6","AC-12","AC-13","AC-14"]}
{"record":"check","id":"CHECK-7","for":["AC-13","AC-14","AC-15","AC-16"]}
{"record":"check","id":"CHECK-8","for":["AC-13","AC-15","AC-17"]}
```

## Entities

- `DerivedMission`: a correction mission created in `state.json` from a blocked review receipt that blames a dependency; never part of `roadmap.json`.
- `TimelineEntry`: one attempt of a mission with its claim and end times.
