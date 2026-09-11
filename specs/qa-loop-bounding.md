---
name: qa-loop-bounding
type: spec
status: draft
feature: QA loop bounding (round counter, qualifying cap, qa-not-converging escalation)
brief: briefs/qa-loop-bounding-intake.md
date: 2026-07-13
version: 1.1.0
---

# Spec — QA Loop Bounding

> A-1 (re-validation 2026-07-14, post lib-split c0123a0): review-lifecycle.js + finding-schema.js are at scripts/lib/review/ — FR-261/FR-264/AC-1/AC-2/CHECK-6/Entity/US-4/FR-281 corrected (CHECK-6 was actively broken pre-patch). roster-qa base v1.8.1 (delta to 1.7.0 carries NO round/state/counter mechanics — greenfield premise holds). New helpers still go in scripts/lib/qa/ (C-10). FR-260..286 no collision with r5 (FR-160..181). All FR logic, reuse premise, exit-contract, FR-032 supersession verified intact.

> **Provenance:** produced under explicit full-autonomy delegation (2026-07-13). Open Questions in
> the intake brief were resolved by binding gate decisions passed with the phase dispatch; each is
> recorded in Clarifications and challenged where a concrete defect was found. Status is DRAFT —
> human validation (quiz per human-validation.md) is still pending before VALIDATED.
>
> **FR numbering:** the highest FR across all repo artifacts at spec time is FR-158
> (`specs/review-bundle` family). The concurrent `r5-trace-enforcement` spec reserves the next
> block starting at FR-160 (N rounded up to the next 10). This spec therefore starts **100 above
> that reservation, at FR-260**, to make cross-spec collision impossible while both specs are
> in flight.
>
> **Supersession clause:** this spec **supersedes `specs/pipeline-loop-convergence.md` FR-032**
> ("the review-GO → QA-NO-GO → implement loop remains unbounded (roster-qa out of scope); the gate
> MUST NOT attempt to bound it"). FR-032's residual is lifted by the QA-side mechanism specified
> here; the review-side gate (`scripts/check-review-convergence.js`) still MUST NOT attempt to
> bound the QA loop — bounding is owned by the QA-side gate (FR-278). The implementation MUST add
> a one-line amendment to `specs/pipeline-loop-convergence.md` marking FR-032 as
> `superseded-by: specs/qa-loop-bounding.md` (FR-285) so the two specs never contradict each other.

## Clarifications

| Q | A |
|---|---|
| Where does QA round state persist? (OQ1, binding) | New `briefs/<task>-qa-state.json`, machine-read JSON surviving the `briefs/<task>-qa.md` overwrite. **Not** fields added to `briefs/<task>-review.json` — that artifact is owned by the review phase; a second writer breaks the single-writer invariant its gate and normalizer assume (INV risk). Shape documented in `schema/qa-state-schema.md` (FR-263), JSON Schema + zero-dep validator if cheap (FR-264). |
| Instrumentation-first or enforce-now? (OQ2, binding) | Ship counter + cap **together**. The physical counter is itself the missing instrument (existing friction/brief data cannot distinguish loop-back rounds from re-invocations); no runaway has ever been observed, so the cap is a backstop, not a tuning exercise. Cap is a tunable `max_qa_rounds` defaulting to 5, mirroring review's `max_no_go_rounds`. |
| Which NO-GOs qualify for the cap? (OQ3, binding, mirrors C-16 of pipeline-loop-convergence) | Only **deterministic gate failures driving a loop-back to implement**: step 2 quality-gate failure, step 3 spec runnable-check FAIL, step 3.5 exit 1 (invariant violated), step 4 TUI failure. Cross-runtime-discrepancy NO-GOs (step 4.5) and code-intel malformed-block NO-GOs (step 3.5 exit 2) do NOT qualify — they have their own handling. The physical `round` counter increments on EVERY verdict emission regardless. See C-4 for the interpretation flag on 3.5-exit-1/TUI. |
| Escalation target on cap hit? (OQ4, binding) | `qa-not-converging` → **human decision point**, not auto-routing to `/roster-spec` or `/roster-review`. A QA cap-hit means the implement↔QA pair is thrashing; a human must pick the exit. Non-overridable, exactly like the review round-cap (no `streak_override` analogue). |
| Brief cites roster-qa v1.6.0; file is v1.8.1 — is the brief stale? (C-1) | Verified: the 1.6.0→1.8.1 diff is xruntime wrapper transport only (`--prompt-file`, `-f` vs `-x` test). No round mechanics landed. Brief substance holds. |
| Reuse `scripts/lib/review/review-lifecycle.js` or fork? (C-2) | Reuse **as-is**. `deriveRoundState(prior)` keys only on `status`/`round`/`cycle`/`rounds_audit`/`cross_runtime`; a QA state artifact adopting those field names is valid `--prior` input. The carried `cross_runtime` field is inert for QA ({} on fresh cycle) and MUST simply be ignored, not stripped. No rename/move here — that is the concurrent scripts-lib-split task's business (C-10). |
| Does the QA report format change? | No. `briefs/<task>-qa.md` keeps its exact `**Status:** GO ✅` / `**Status:** NO-GO ❌` grep contract (ship-gate hook). The report gains one additive `**Round:**` line (FR-266); the JSON state artifact is a sibling, invisible to the hook grep (C-12). |
| Naming: `max_qa_rounds` vs mirroring review's `max_no_go_rounds`? (C-13) | `max_qa_rounds` (binding). Deliberate divergence: tunables are namespaced per skill, but a distinct name makes cross-skill grep and human config unambiguous. Documented here so nobody "fixes" it back. |

## User Stories

### US-1: Physical QA round instrumentation (Priority: P0)
As the pipeline, I want every QA verdict emission recorded in a durable machine-readable round
counter, so that QA loop depth becomes observable at all (today `briefs/<task>-qa.md` is
overwritten each run and round history is destroyed by design).
**Why this priority**: the counter is the missing instrument — every other story reads it.
**Scope**: This story does NOT cover enforcement (no cap, no escalation) and does NOT change the
markdown report's status-line contract.
**Independent Test**: run QA twice on a task (NO-GO then GO); `briefs/<task>-qa-state.json` shows
`round: 2` with a two-entry `rounds_audit`, while `briefs/<task>-qa.md` still contains exactly one
`**Status:**` line.
**Acceptance Scenarios**:
1. **Given** a fresh task with no `briefs/<task>-qa-state.json`, **When** roster-qa emits its first
   verdict (GO or NO-GO), **Then** the state file is created with `round: 1`, `cycle: 1`, and one
   `rounds_audit` entry, and `round`/`cycle` were derived via
   `node scripts/lib/review/review-lifecycle.js --prior briefs/<task>-qa-state.json` (absent prior =
   legitimate fresh input).
2. **Given** a persisted NO-GO state with `round: 2`, **When** QA runs again on the fixed
   implementation and emits GO, **Then** the state persists `round: 3`, `status: "GO"`, retains the
   full `rounds_audit` (cycle-final, auditable), and the next QA cycle after that GO initializes
   fresh (`round: 1`, `cycle` incremented).
3. **Given** a legacy task whose `briefs/<task>-qa.md` exists but no state file, **When** QA runs,
   **Then** the state file starts at round 1 with no warning (absent prior is legitimate — mirrors
   the lifecycle CLI contract), and the markdown report is written as today.

### US-2: Qualifying-round cap (Priority: P0)
As the pipeline, I want a separate qualifying counter compared against a tunable cap, so that
deterministic-failure thrash is bounded while non-qualifying NO-GOs (cross-runtime discrepancy,
malformed code-intel block) can never burn the budget.
**Why this priority**: this is the actual bound — the residual FR-032 documented.
**Scope**: This story does NOT define what happens at the cap (US-3) and does NOT add
finding-level check encoding to QA (out of scope per brief).
**Independent Test**: emit five qualifying NO-GOs from fixtures; `qa_no_go_round` reaches 5; emit a
cross-runtime-discrepancy NO-GO from a fixture; `qa_no_go_round` is unchanged while `round` bumped.
**Acceptance Scenarios**:
1. **Given** state with `qa_no_go_round: 1`, **When** QA emits NO-GO because Gate 2 (tests) failed
   (step 2), **Then** `qa_no_go_round` becomes 2 and the `rounds_audit` entry records
   `qualifying: true` with cause `gate-failure`.
2. **Given** state with `qa_no_go_round: 2`, **When** QA emits NO-GO solely because the second
   runtime reported a CRITICAL/HIGH discrepancy (step 4.5), **Then** `qa_no_go_round` stays 2,
   `round` still increments, and the audit entry records `qualifying: false` with cause
   `cross-runtime-discrepancy`.
3. **Given** state with `qa_no_go_round: 4` and roster-qa's `tunables.max_qa_rounds: 5`, **When**
   QA emits a GO verdict, **Then** `qa_no_go_round` resets to 0 — a later regression starts a fresh
   budget, mirroring review's reset-on-GO.
4. **Given** a NO-GO round with BOTH a qualifying step 2 failure and a step 4.5 discrepancy,
   **When** the verdict is emitted, **Then** the round qualifies (any qualifying cause qualifies
   the round) and the audit entry's `causes` array records both (EC-4).

### US-3: qa-not-converging escalation to a human decision point (Priority: P0)
As the human owner, I want the pipeline to stop at a decision point when QA hits its cap, so that
an implement↔QA thrash is ended by a person choosing the exit — not by the loop, and not by an
auto-route guessing between spec and review.
**Why this priority**: an unbounded loop with a counter is still unbounded; the stop is the point.
**Scope**: This story does NOT auto-route anywhere and does NOT introduce any override mechanism.
**Independent Test**: fixture state at `qa_no_go_round: 5` with `--max-rounds 5` → gate exits 1
with cause `qa-round-cap`; roster-run's verdict table has a `qa-not-converging` row that stops
with human instructions instead of routing to `/roster-implement`.
**Acceptance Scenarios**:
1. **Given** `qa_no_go_round` reaching `max_qa_rounds` at NO-GO emission, **When** the QA gate
   runs, **Then** it exits 1 with `cause: "qa-round-cap"`, the loop-back to `/roster-implement` is
   blocked, and the verdict records escalation `qa-not-converging`.
2. **Given** a `qa-not-converging` verdict, **When** roster-run (fresh detection or Step 3 resume)
   reaches the qa verdict rows, **Then** it stops and presents the human with the `rounds_audit`
   trail, the recorded causes, and the exit options (revise spec via `/roster-spec`, re-review via
   `/roster-review`, split/abandon the task) — it MUST NOT pick one automatically.
3. **Given** a human asking to "override and run one more implement round" at the cap, **When**
   the request is made, **Then** it is refused — the QA round-cap is non-overridable, exactly like
   the review round-cap (only review's novel-finding-streak has an override, and QA has no streak
   mechanism).
4. **Given** a resume after a crash with a violating `qa-state.json` on disk, **When** roster-run
   resumes at the qa verdict edge, **Then** the gate is invoked before applying the row table, so
   the resume path cannot bypass the cap (mirror of pipeline-loop-convergence C-14).

### US-4: Mechanical QA convergence gate (Priority: P1)
As the pipeline, I want the cap enforced by a read-only script with the proven exit contract, so
that enforcement is mechanical (a skill cannot talk itself past prose) and testable.
**Why this priority**: P1 only relative to US-1..3 — prose + counter without the gate would still
be an improvement, but the review work showed prose-only convergence rules get skipped.
**Scope**: This story does NOT modify `scripts/check-review-convergence.js` or any
`scripts/lib/review/*` behavior — reuse must be behavior-preserving for the review path (existing
tests stay green untouched).
**Independent Test**: run the new gate against fixtures for each exit code; run
`git status --porcelain` after each — empty; run the untouched review-gate test files — green.
**Acceptance Scenarios**:
1. **Given** a well-formed draft state below the cap, **When**
   `node scripts/check-qa-convergence.js briefs/<task>-qa-state.json.draft --max-rounds 5` runs,
   **Then** it exits 0 with a JSON report on stdout.
2. **Given** an absent or malformed state path, **When** the gate runs, **Then** it exits 2
   (degraded input, fail-closed — the route-back is blocked and the condition surfaced to the
   human; the gate is always invoked on a composed draft, so "absent" is never legitimate input
   *to the gate*, unlike the lifecycle CLI's `--prior`).
3. **Given** a draft whose `rounds_audit` lacks the current round's entry, **When** the gate runs,
   **Then** it exits 3 (process-incomplete-only) and roster-qa repairs the draft and re-gates,
   bounded to 2 attempts, without bumping `round` — exit 3 never reaches routing.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | The intake brief pins roster-qa at v1.6.0; the file on `next` is v1.8.1 — did the ground shift? | Verified via `git log`/diff: 1.8.1 changed only xruntime wrapper transport (`--prompt-file`, `-f` presence test). No round mechanics exist. Brief holds; spec cites v1.8.1 as the base. |
| C-2 | US-1 | Reusing `review-lifecycle.js` drags review-shaped baggage (`cross_runtime` carry-forward) into QA state | Accepted as inert: `deriveRoundState` returns `crossRuntime: {}` on fresh cycles and carries it verbatim otherwise; QA writes what it got and ignores it. Forking a 113-line pure helper to shave one unused key would duplicate the executable witness — the exact anti-pattern the brief forbids. |
| C-3 | US-1 | roster-qa's rule is "never write code — observe and measure"; is writing a state JSON a violation? | No — the state artifact is measurement output, same class as `briefs/<task>-qa.md`. But single-writer ownership must be explicit: the QA phase owns `qa-state.json`; roster-review and the review gate MUST NOT read or write it (FR-263) — the same INV that kept OQ1 from extending `review.json`. |
| C-4 | US-2 | The OQ3 binding decision says "quality-gate/test failures"; it names neither step 3.5 exit 1 (code-intel invariant violated) nor step 4 TUI failures. Are they qualifying? | **Interpretation, flagged for human ratification:** both are deterministic failures whose documented handling is an immediate NO-GO looping back to implement — excluding them would let a code-intel-violation thrash run unbounded, recreating FR-032 one layer down. Spec includes them as qualifying (FR-268). The decision's explicit exclusions (cross-runtime discrepancy, malformed block) are honored verbatim. **[NEEDS-HUMAN]** |
| C-5 | US-2 | Crash between state write and report write corrupts the count | Mirror pipeline-loop-convergence C-18: fixed write order (gate draft → persist `qa-state.json` → write `qa.md` last), gate pure read-only and idempotent, resume re-invokes the gate. A crash before state persist = the round never happened; after = report stale but state authoritative (FR-286). |
| C-6 | US-2 | Physical counter cannot distinguish loop-back rounds from same-implementation re-invocations (flake investigations) — the very ambiguity the brief documents. A re-run re-emitting the same qualifying NO-GO burns budget without an intervening fix. | Accepted, deliberately: repeated qualifying NO-GOs with no intervening fix ARE non-convergence — the cap should count them. The review loop has the identical property. The `rounds_audit` trail (dates + causes) lets the human at the decision point tell the two apart after the fact — which is precisely the instrumentation OQ2 asked for. |
| C-7 | US-3 | OQ4 diverges from the review pattern (review's cap routes to `/roster-spec` minimal-freeze); is a bare human stop weaker? | No — it is better-typed. Review cap-hit = un-encodable design gap → spec-freeze is the typed exit. QA cap-hit = implement↔QA thrash where the defect could live in the implementation, the review that GO'd it, or the spec's checks — three exits, no mechanical tiebreaker. Auto-routing would guess. Bonus (C-8): a human stop has no express/fast dead-end problem (pipeline-loop-convergence C-15) by construction. |
| C-9 | US-4 | Does a QA gate need exit 3 at all? QA has no red/green or strike machinery. | Kept, cheap and symmetric: the incomplete-`rounds_audit` bookkeeping defect exists for QA exactly as for review, and a shared 0/1/2/3 contract means roster-run's gate-handling prose generalizes instead of forking. Exit 3 stays repair-only, never routed. |
| C-10 | US-4 | Concurrent scripts-lib-split task is introducing `scripts/lib/review/` — where do QA helpers go without colliding? | `scripts/lib/qa/` from day one, per binding decision. **Ordering dependency for the plan phase:** if scripts-lib-split lands first, follow its final layout; if this lands first, the split must relocate QA helpers with the same behavior-preserving bar. Neither task blocks the other's semantics. |
| C-11 | supersession | Between this spec going live and the amendment edit landing, two specs contradict each other about QA boundedness | The supersession clause in this header names FR-032 explicitly and is authoritative from validation; FR-285 makes the one-line amendment (and the roster-run "Known residual" note update) a MUST of the implementation, not a follow-up. The window is one PR wide. |
| C-12 | US-1 | Does a new JSON file in `briefs/` disturb the ship-gate hook? | No — precedent `briefs/friction-dedup-state.json` exists; the hook greps `briefs/<task>-qa.md` for `^\*\*Status:\*\* GO` only. FR-260 additionally freezes the report contract. |
| C-13 | US-2 | `max_qa_rounds` breaks the naming mirror with review's `max_no_go_rounds` | Deliberate (binding): tunables are per-skill-namespaced either way; the distinct name is unambiguous in config and grep. Recorded here so a future "consistency" pass does not rename it. |
| C-14 | US-3 | Resume routing bypasses the QA cap (crash after violating state persisted) | roster-run invokes the QA gate on the qa verdict edge before applying rows (FR-276), mirroring the review gate's `--static` resume invocation. The gate is read-only, so this is safe on a route-only phase. |

## Functional Requirements

#### QA round instrumentation [US-1]

- **FR-260** [US-1]: roster-qa MUST persist machine-readable round state to
  `briefs/<task>-qa-state.json` at every verdict emission (GO and NO-GO alike). The markdown
  report `briefs/<task>-qa.md` MUST keep its exact status-line contract
  (`**Status:** GO ✅` / `**Status:** NO-GO ❌` at start of line, ship-gate hook grep) — the state
  artifact lives alongside it, never inside it.
- **FR-261** [US-1]: The state artifact MUST use the lifecycle-compatible field names `status`,
  `round`, `cycle`, `rounds_audit`, and `round`/`cycle`/fresh-cycle detection MUST be derived by
  shelling out to `node scripts/lib/review/review-lifecycle.js --prior briefs/<task>-qa-state.json` at
  draft composition — never re-derived in prose. An absent prior file is legitimate fresh-task
  input; a present-but-invalid-JSON prior fails closed (lifecycle exit 2 → surface, do not guess).
- **FR-262** [US-1]: The physical `round` counter MUST increment on every QA verdict emission
  regardless of cause; a persisted GO verdict MUST retain its cycle-final `round`/`rounds_audit`
  (auditable, never reset in place); the next QA cycle after a GO MUST initialize fresh (round 1,
  empty `rounds_audit`, `cycle` + 1) — the review two-event lifecycle (INV-3), applied to QA.
- **FR-263** [US-1]: The state shape MUST be documented in `schema/qa-state-schema.md` (analogous
  to `schema/review-json-schema.md`). The QA phase is the artifact's single writer; roster-qa MUST
  NOT add fields to `briefs/<task>-review.json`, and roster-review / the review gate MUST NOT read
  or write `briefs/<task>-qa-state.json`.
- **FR-264** [US-1]: A machine-readable JSON Schema (`schema/qa-state.schema.json`) validated via
  the zero-dep interpreter in `scripts/lib/review/finding-schema.js` SHOULD be provided when the shape is
  expressible in that interpreter's supported subset (`type`/`enum`/`required`/`properties`/
  `additionalProperties`/`items`); if not expressible, the markdown shape doc alone satisfies
  FR-263 and the omission MUST be noted in `schema/qa-state-schema.md`.
- **FR-265** [US-1]: `rounds_audit` MUST be append-only within a cycle, one entry per verdict
  emission, each entry carrying at minimum `{round, date, verdict, causes[], qualifying}`.
- **FR-266** [US-1]: roster-qa MUST surface the round state in both the report (one additive line,
  e.g. `**Round:** 3 (qualifying 2/5)`) and the step 6 human-gate one-liner, without altering the
  status-line format (FR-260).

#### Qualifying counter and cap [US-2]

- **FR-267** [US-2]: The state MUST carry a `qa_no_go_round` counter, reset to 0 on every GO
  verdict and incremented ONLY on a qualifying NO-GO — two counters, never conflated (mirror of
  roster-review §5.5 `round` vs `no_go_round`).
- **FR-268** [US-2]: A NO-GO qualifies if and only if at least one of its causes is a
  deterministic gate failure driving a loop-back to `/roster-implement`: a step 2 quality-gate
  failure (`gate-failure`), a step 3 spec runnable-check FAIL (`spec-check-failure`), a step 3.5
  exit 1 invariant violation (`code-intel-violation`), or a step 4 TUI failure (`tui-failure`).
  The emitted verdict MUST record its cause(s) in the `rounds_audit` entry. (Inclusion of
  `code-intel-violation` and `tui-failure` is an interpretation of the OQ3 decision — C-4,
  flagged for human ratification.)
- **FR-269** [US-2]: A NO-GO caused solely by a cross-runtime discrepancy (step 4.5) MUST NOT
  increment `qa_no_go_round`; it MUST still increment the physical `round` and be recorded in
  `rounds_audit` with `qualifying: false`, cause `cross-runtime-discrepancy`.
- **FR-270** [US-2]: A NO-GO caused solely by a malformed code-intel block (step 3.5 exit 2) MUST
  NOT increment `qa_no_go_round`; same audit treatment, cause `code-intel-malformed`. A round with
  mixed causes qualifies if ANY cause qualifies (EC-4).
- **FR-271** [US-2]: The cap MUST be a roster-qa tunable `max_qa_rounds`, default `5`, compared
  against `qa_no_go_round` (never against the physical `round`).
- **FR-272** [US-2]: Counter and cap MUST ship together in one change — no instrumentation-only
  intermediate release (OQ2 binding decision; the counter is itself the missing instrument, the
  cap is a generous backstop, and `rounds_audit` provides the data to retune the default later).

#### qa-not-converging escalation [US-3]

- **FR-273** [US-3]: When `qa_no_go_round` reaches `max_qa_rounds` at a qualifying NO-GO emission,
  the verdict MUST record escalation `qa-not-converging` and the loop-back to `/roster-implement`
  MUST be blocked.
- **FR-274** [US-3]: `qa-not-converging` MUST terminate at a human decision point: the pipeline
  stops, presents the `rounds_audit` trail and recorded causes, and offers the exits (revise spec
  via `/roster-spec`, re-review via `/roster-review`, split or abandon the task). It MUST NOT
  auto-route to any phase.
- **FR-275** [US-3]: The QA round-cap escalation MUST NOT be overridable — no override field is
  honored by the gate or the skill (mirrors the review round-cap; review's streak override has no
  QA analogue and MUST NOT be borrowed).
- **FR-276** [US-3]: roster-run's verdict table MUST gain a `qa` NO-GO `qa-not-converging` row
  placed above the generic `qa NO-GO → /roster-implement` row, and roster-run MUST invoke the QA
  convergence gate on the qa verdict edge (fresh detection and Step 3 resume) before applying any
  qa row, so resume cannot bypass the cap (C-14).
- **FR-277** [US-3]: Express mode is unaffected (QA is skipped entirely in Express); Fast and Full
  modes are both bounded. The human decision point MUST work identically in Fast (which has no
  spec phase) — offering `/roster-spec` there implies restart-under-full, stated explicitly in the
  presented options.

#### Mechanical QA convergence gate [US-4]

- **FR-278** [US-4]: A new script `scripts/check-qa-convergence.js` MUST enforce the cap
  mechanically. CLI: `node scripts/check-qa-convergence.js <qa-state.json path> [--max-rounds N]`.
  Exit contract mirrors the review gate: `0` = pass; `1` = violation, JSON report with top-level
  `cause: "qa-round-cap"`; `2` = degraded input (absent/malformed state file, unknown flag) —
  fail-closed, route-back blocked; `3` = process-incomplete-only (missing/incomplete
  `rounds_audit` entry for the current round) — repair the draft and re-gate (bounded to 2
  attempts, `round` not bumped), never routed.
- **FR-279** [US-4]: The gate MUST be read-only: it MUST NOT modify any repo file or `.git` state
  (mirror of review-gate FR-022).
- **FR-280** [US-4]: The gate MUST be invoked by roster-qa on a composed `.draft` state before the
  state file is persisted (write order: gate draft → persist `qa-state.json` → write `qa.md`), and
  the persisted state written exactly once per verdict. A legacy state file lacking
  `qa_no_go_round` MUST be treated as 0 with a warning, not exit 2 (mirror of review-gate FR-030).
- **FR-281** [US-4]: Reuse of review convergence machinery MUST be behavior-preserving for the
  review path: `scripts/check-review-convergence.js` semantics, `review-lifecycle.js`, and
  `review-convergence-rules.js` behavior are unchanged and their existing tests stay green
  untouched. If reuse requires extracting a shared helper, the extraction carries the same bar.
- **FR-282** [US-4]: The new gate and any helpers MUST respect the code-quality budgets from day
  one: ≤500 lines per file, ≤50 lines per function; shared QA helpers live in `scripts/lib/qa/`
  (ordering dependency with the concurrent scripts-lib-split task noted in C-10 — the plan phase
  MUST sequence against it).
- **FR-283** [US-4]: The gate MUST have tests mirroring the `scripts/check-review-convergence.test.js`
  pattern (fixture-driven, one test per exit code and per qualifying rule), wired into the
  `npm test` chain.
- **FR-284** [US-4]: After editing `skills/pipeline/roster-qa.md` (and `roster-run.md`), the
  implementation MUST run `bash scripts/sync-harness.sh` and commit ALL regenerated projections
  (CI runs `sync-harness.sh --check` inside `npm test`).

#### Supersession and consistency [US-3]

- **FR-285** [US-3]: The implementation MUST add a one-line amendment to
  `specs/pipeline-loop-convergence.md` marking FR-032 as
  `superseded-by: specs/qa-loop-bounding.md`, and MUST update roster-run's
  "Known residual (FR-032)" note to state the QA loop is now bounded by this spec's mechanism.
  (The amendment edit is implementation scope; this spec's header carries the authoritative
  supersession clause.)
- **FR-286** [US-3]: On resume after a crash, the persisted `qa-state.json` is the authoritative
  round record; a stale or missing `qa.md` MUST NOT reset or re-derive round state (C-5 — state is
  source of truth, report is presentation).

## Acceptance Criteria

- AC-1 [US-1 happy path]: Fresh task, first QA verdict → `briefs/<task>-qa-state.json` created
  with `round: 1`, `cycle: 1`, one audit entry; `qa.md` status line unchanged in format.
  (FR-260, FR-261, FR-265)
- AC-2 [US-1, C-2]: Round/cycle values in the state file match
  `node scripts/lib/review/review-lifecycle.js --prior <state>` output for both fresh-cycle and
  NO-GO-continuation fixtures. (FR-261, FR-262)
- AC-3 [US-1, C-12]: Ship-gate hook grep over `qa.md` behaves identically before and after; state
  JSON invisible to it. (FR-260)
- AC-4 [US-1]: `schema/qa-state-schema.md` exists and documents every field FR-261/FR-265/FR-267
  name. (FR-263, FR-264)
- AC-5 [US-2 happy path]: Qualifying NO-GO (step 2 failure) → `qa_no_go_round` +1,
  `qualifying: true` audited. (FR-267, FR-268)
- AC-6 [US-2, C-4]: Step 3.5 exit 1 NO-GO increments; step 3.5 exit 2 NO-GO does not; step 4.5
  discrepancy NO-GO does not; all three bump physical `round` and land in `rounds_audit`.
  (FR-268, FR-269, FR-270)
- AC-7 [US-2]: GO verdict resets `qa_no_go_round` to 0; retains cycle-final `round`. (FR-267, FR-262)
- AC-8 [US-3 happy path]: `qa_no_go_round` = 5 with `max_qa_rounds: 5` → gate exit 1
  `cause: "qa-round-cap"`, verdict `qa-not-converging`, implement route blocked, human decision
  point presented with audit trail. (FR-273, FR-274, FR-278)
- AC-9 [US-3, C-14]: Resume with violating state on disk → roster-run invokes the gate before the
  qa rows; route-back blocked. (FR-276)
- AC-10 [US-3]: No override path exists at the cap (attempted override refused). (FR-275)
- AC-11 [US-4, C-18-mirror]: Gate run against any fixture → `git status --porcelain` empty. (FR-279)
- AC-12 [US-4]: Absent/malformed state path → exit 2; missing current-round audit entry → exit 3,
  repaired and re-gated without bumping `round`. (FR-278, FR-280)
- AC-13 [US-4, C-11]: `specs/pipeline-loop-convergence.md` carries the FR-032 supersession
  amendment; roster-run's residual note updated. (FR-285)
- AC-14 [US-4]: Existing review-gate/lifecycle/rules test files pass unmodified. (FR-281)

## Edge Cases

- EC-1 [US-1]: Legacy task, `qa.md` exists, no state file → fresh round 1, no warning (absent
  prior is legitimate lifecycle input).
- EC-2 [US-4]: State file present but malformed JSON → gate exit 2, fail-closed; lifecycle CLI
  exit 2 at composition — surface to human, never guess a fresh cycle.
- EC-3 [US-4]: Future-legacy state lacking `qa_no_go_round` → treat as 0 + warning (FR-280).
- EC-4 [US-2]: Mixed-cause NO-GO (qualifying + non-qualifying in one round) → round qualifies
  once; `causes[]` records all; `qa_no_go_round` +1 exactly (never per-cause).
- EC-5 [US-3]: `qa_no_go_round == max_qa_rounds` exactly → violation fires (≥ comparison, cap is
  inclusive — 5 qualifying NO-GOs on a cap of 5 escalate).
- EC-6 [US-2]: GO after 4 qualifying NO-GOs, later regression re-enters QA → fresh cycle, fresh
  budget (`qa_no_go_round: 0`, `cycle` +1) — by design, mirrors review.
- EC-7 [US-1]: Critical E0 path (`formal-verify` replaced QA) → no QA verdict is emitted, no state
  file written; out of scope, behavior unspecified beyond "unchanged".
- EC-8 [US-2, C-6]: Re-invocation without an intervening fix (flake investigation) re-emitting a
  qualifying NO-GO → counts again; accepted — repeated identical failures are non-convergence, and
  the audit trail lets the human distinguish the pattern at the decision point.
- EC-9 [US-3]: Cap hit in Fast mode → human decision point identical; the `/roster-spec` option is
  presented as restart-under-full (FR-277); zero ledger mutation, no automatic mode upgrade.

## Runnable Checks

All checks are post-implementation acceptance commands except CHECK-6, which is runnable today
(it verifies the reuse premise). Exit convention: 0 = check passes, 1 = assertion fired, ≥2 = error.

- CHECK-1 [AC-12]: `node scripts/check-qa-convergence.js /nonexistent.json; test $? -eq 2` →
  expected: exit 0 of the compound (gate exits 2 on absent input, fail-closed).
- CHECK-2 [AC-8]: `node scripts/check-qa-convergence.js scripts/fixtures/qa-state-cap-hit.json --max-rounds 5`
  → expected: exit 1, stdout JSON `cause: "qa-round-cap"`.
- CHECK-3 [AC-6]: `node scripts/check-qa-convergence.test.js` (or the npm-test-integrated
  equivalent) → expected: exit 0; includes fixtures proving cross-runtime-discrepancy and
  malformed-block NO-GOs leave `qa_no_go_round` unchanged.
- CHECK-4 [AC-11]: `node scripts/check-qa-convergence.js <any fixture>; git status --porcelain | wc -l`
  → expected: `0` (read-only guarantee).
- CHECK-5 [AC-14]: `npm test` → expected: exit 0 with `check-review-convergence.test.js`,
  `check-review-convergence-rules.test.js`, and the lifecycle test unmodified from their
  pre-implementation blobs (`git diff --exit-code <base> -- scripts/check-review-convergence*.test.js`).
- CHECK-6 [AC-2]: `printf '{"status":"NO-GO","round":2,"cycle":1,"rounds_audit":[]}' > /tmp/qa-fixture.json && node scripts/lib/review/review-lifecycle.js --prior /tmp/qa-fixture.json`
  → expected: stdout `{"round":3,"cycle":1,"fresh_cycle":false}` (runnable today; proves
  field-compatible reuse).
- CHECK-7 [AC-13]: `grep -q "superseded-by: specs/qa-loop-bounding.md" specs/pipeline-loop-convergence.md`
  → expected: exit 0.
- CHECK-8 [AC-9]: `grep -q "qa-not-converging" skills/pipeline/roster-run.md` → expected: exit 0
  (verdict-table row present).
- CHECK-9 [FR-284]: `bash scripts/sync-harness.sh --check` → expected: exit 0 (projections
  committed).

## Entities

- `briefs/<task>-qa-state.json`: machine-read QA round state, single-writer (QA phase), surviving
  the per-run overwrite of `briefs/<task>-qa.md`; shape in `schema/qa-state-schema.md`.
- `round` (QA): physical counter, +1 on every QA verdict emission; two-event lifecycle (retained
  on GO, fresh next cycle) derived via `scripts/lib/review/review-lifecycle.js`.
- `qa_no_go_round`: qualifying counter — reset on GO, +1 per qualifying NO-GO, compared against
  `max_qa_rounds`.
- Qualifying NO-GO: a NO-GO with ≥1 deterministic-gate-failure cause (`gate-failure`,
  `spec-check-failure`, `code-intel-violation`, `tui-failure`) driving loop-back to implement.
- `max_qa_rounds`: roster-qa tunable, default 5; the cap.
- `qa-not-converging`: escalation emitted at cap hit; terminates at a human decision point;
  non-overridable.
- `scripts/check-qa-convergence.js`: read-only mechanical gate, exit contract 0/1/2/3 mirroring
  `scripts/check-review-convergence.js`; helpers in `scripts/lib/qa/`.

## Open Points Needing Human Validation

1. **C-4 / FR-268 qualifying-cause set:** the OQ3 decision text names quality-gate/test failures;
   this spec additionally counts step 3.5 exit 1 (code-intel invariant violated) and step 4 TUI
   failures as qualifying, because both are deterministic implement-loop-back failures. Ratify or
   narrow.
2. **DRAFT status:** the human-validation quiz (comprehension + consistency check per
   human-validation.md) has not been run; `status: draft` until it is.
3. **FR numbering reservation:** FR-260..FR-286 assumes r5-trace-enforcement stays within
   FR-160..FR-259. If that spec overruns, renumber before validation.
