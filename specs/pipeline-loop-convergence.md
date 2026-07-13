---
name: pipeline-loop-convergence
type: spec
status: live
feature: Review/implement loop convergence (invariant ratchet + mechanical gate)
brief: briefs/pipeline-loop-convergence-intake.md
date: 2026-07-13
version: 1.1.0
---

# Spec — Review/Implement Loop Convergence

> **Provenance note:** produced under an explicit full-autonomy delegation from the human
> (2026-07-13). Human gates in this phase were auto-decided; every auto-decision is recorded
> in Clarifications/Challenges below. Items flagged **[HUMAN-REVIEW]** revise or refine a
> previously human-ratified decision based on evidence found during research and should be
> double-checked.

## Clarifications

| Q | A |
|---|---|
| Who increments `no_go_round`, when? | roster-review, at NO-GO verdict emission (reads prior value first); reset to 0 on GO. Only NO-GOs with ≥1 OPEN HIGH+ *non-scope* finding increment. |
| How is the mode upgrade written, given ledger `.mode` is immutable-on-resume and roster-run never writes the ledger? | **[HUMAN-REVIEW]** It is not written. A direct ledger mutation or new event shape fails the byte-synced jq schema gate (roster-run.md:149-168) → CORRUPT → task halts. The ratified *outcome* (misclassified task re-enters with full pipeline) is achieved via the existing restart-under-new-mode path: the gate blocks continuation, the pipeline stops, the human restarts under full mode. No automatic upgrade. |
| Gate runs pre- or post-verdict? | Post-verdict, pre-routing. It never converts NO-GO to GO; it decides whether the route-back is permitted. |
| Gate behavior on absent/malformed review.json? | Exit 2, fail-closed (blocks route-back, surfaces to human). Exception: review.json valid but missing `no_go_round` key = legacy → round 0 + warning. |
| Ratchet vs ACCEPTED findings? | ACCEPTED is exempt (human waiver). The acceptance prompt must state the waiver is permanent — no check will ever guard this invariant. |
| Who records `check`/`check_encodable`? | Implementer proposes via a new `## Ratchet` section in `briefs/<task>-impl.md`; roster-review consumes it into review.json (artifact channel — the loop crosses fresh contexts). |
| Does roster-run's Full-mode spec-dispatch row honor the flag? | Yes: dispatch to /roster-spec when Type is feature/api-change OR `Trust boundary: yes` (roster-run.md:261 row). New design-not-converging row goes ABOVE the catch-all (roster-run.md:284). |
| OQ1/OQ2 ratification | Auto-ratified under delegation per the brief's own proposals: `max_no_go_rounds = 5`; red-before-green mandatory and gate-enforced (US-4 promoted to P0 — the ratchet never ships without it). |

## User Stories

### US-1: Trust-boundary tasks never skip the invariant freeze (Priority: P0)
As a pipeline operator, I want fix/refactor/chore tasks flagged as trust-boundary to go through a minimal spec freeze so that review checks against a fixed contract instead of discovering requirements mid-loop.
**Why this priority**: root cause of the motivating six-round churn — requirements discovered mid-loop.
**Scope**: does NOT cover full user-story ceremony for these tasks; the deliverable is the invariant set (CHECK-N + paired AC-N).
**Independent Test**: run roster-spec on a `Type: fix` + `Trust boundary: yes` brief → minimal-freeze spec produced, not SKIPPED.
**Acceptance Scenarios**:
1. **Given** an intake brief with `Type: fix` and `Trust boundary: yes`, **When** roster-spec's Trigger Check runs, **Then** the spec phase is not skipped and produces a minimal-freeze spec (Invariants + CHECK-N + paired AC-N).
2. **Given** `Type: fix` and `Trust boundary: no`, **When** the Trigger Check runs, **Then** the phase is SKIPPED exactly as today.
3. **Given** an intake description mentioning signature verification with no flag set, **When** roster-intake drafts the brief, **Then** keyword detection proposes `Trust boundary: yes` and the human gate must confirm before VALIDATED.
4. **Given** a legacy brief with no Trust boundary field, **When** the Trigger Check runs, **Then** it skips as today but emits a warning (fail-open, logged risk).

### US-2: Invariant ratchet on loop-back rounds (Priority: P0)
As a reviewer, I want every HIGH+ loop-back finding to require fix + linked runnable check before RESOLVED, so each round's deterministic gate is strictly stronger than the last.
**Why this priority**: the convergence mechanism itself.
**Scope**: does NOT cover LOW/MEDIUM findings, same-round raise+resolve, or ACCEPTED findings.
**Independent Test**: loop-back round resolving a HIGH finding without a check link → gate violation.
**Acceptance Scenarios**:
1. **Given** a HIGH finding from round 1 fixed in round 2 with a new self-contained check file declared in `## Ratchet`, **When** review re-runs, **Then** the finding may be RESOLVED and the gate passes.
2. **Given** a HIGH loop-back finding claiming RESOLVED with no check link, **When** the convergence gate runs, **Then** it exits 1 and the route-back is blocked.
3. **Given** a HIGH finding ACCEPTED by the human (with the permanent-waiver prompt shown), **When** the gate runs, **Then** no check is demanded for it.
4. **Given** the implementer proposes `check_encodable: false` with a reason in `## Ratchet`, **When** review records it and the human does not ACCEPT, **Then** the verdict escalates as design-not-converging.

### US-3: Mechanical convergence gate + escalation (Priority: P0)
As the pipeline, I want a deterministic read-only script gating the NO-GO route-back so the loop rules survive fresh contexts and resumes.
**Why this priority**: prose-only loop rules drift exactly when they matter (long overnight contexts).
**Scope**: does NOT bound the review-GO → QA-NO-GO → implement loop (roster-qa out of scope; residual documented).
**Independent Test**: fixture review.json at the cap → gate exits 1.
**Acceptance Scenarios**:
1. **Given** `no_go_round` has reached `max_no_go_rounds` (5), **When** review produces another NO-GO, **Then** the gate blocks the implement route and the verdict escalates with `cause: "round-cap"`.
2. **Given** any un-encodable, non-ACCEPTED HIGH+ finding, **When** the verdict is emitted, **Then** `design-not-converging` with `cause: "unencodable-finding"` regardless of round count.
3. **Given** an absent or malformed review.json, **When** the gate runs, **Then** exit 2 and the route-back is blocked (fail-closed).
4. **Given** a resume at roster-run's verdict-table edge with a violating review.json, **When** roster-run routes, **Then** it invokes the gate first and the route-back is blocked (resume bypass closed).
5. **Given** an express/fast task hitting escalation, **When** the gate blocks, **Then** the pipeline stops and instructs the human to restart under full mode — no ledger mutation.

### US-4: Red-before-green proof for ratcheted checks (Priority: P0 — promoted; mandatory with the ratchet)
As a reviewer, I want each new ratcheted check proven to fail (assertion-red) against the recorded pre-fix SHA, so vacuous checks cannot satisfy the ratchet.
**Why this priority**: without it the ratchet's path of least resistance is a hollow check.
**Scope**: does NOT apply when no committed baseline exists (uncommitted-tree tasks — accepted, flagged residual).
**Independent Test**: check whose red command exits 0 against the pre-fix worktree → gate violation.
**Acceptance Scenarios**:
1. **Given** a new check overlaid alone onto a throwaway worktree at the finding's `pre_fix_sha`, **When** its red command exits 1 (assertion fired), **Then** `red_verified: true` and `check_blob` are recorded.
2. **Given** the red command exits 0 on the pre-fix tree, **When** the gate classifies it, **Then** vacuous-check violation, exit 1.
3. **Given** the red command exits ≥2 (build/import error or unreachable SHA), **When** the gate classifies it, **Then** `red_verified: false` inconclusive, surfaced to human; self-containment is the first remedy; if impossible → `check_encodable: false` path.
4. **Given** a previously red-verified check file whose current blob differs from `check_blob`, **When** the gate runs, **Then** red verification is re-run (weakening protection).

## Challenges

28 challenges raised by the adversarial pass; all resolved. Condensed table (C-numbers preserved):

| ID | Story | Challenge (condensed) | Resolution |
|---|---|---|---|
| C-1 | US-1 | Express/fast have no intake — who detects the flag? | roster-run's classification step runs the heuristic for every task and recommends full mode before mode is recorded (routing-time, no ledger write); review catches mid-loop cases via escalation → stop + restart. |
| C-2 | US-1 | Minimal artifact breaks CHECK→AC→US traceability; collides with idempotency | Minimal profile writes `specs/<slug>.md` with `**Profile: minimal-freeze**`; each CHECK-N gets a paired AC-N (1:1, mechanical) preserving `failed_acs` traceability. **[HUMAN-REVIEW]** revises earlier "AC optional" decision — reason: review keys on AC ids. Existing spec → extend, never skip. |
| C-3 | US-1 | Absent Trust-boundary field behavior | Fail-open (skip as today) + warning. Fail-closed would break every in-flight/legacy task. Logged risk. |
| C-4 | US-1 | roster-run Full-mode routing never dispatches a fix to spec | Row condition becomes: Type feature/api-change OR Trust boundary: yes. |
| C-5 | US-1 | BOUNCED semantics for minimal path | No derivable invariant → BOUNCED. `min_user_stories`/`min_gwt` tunables explicitly do not apply to the minimal profile. |
| C-6 | US-1 | "token" keyword false-positives in an LLM repo | Accepted: human confirm bounds cost; heuristic stays in intake prose (proposal-only, low-stakes drift). |
| C-7 | US-2 | "Previously-OPEN" undecidable from one overwritten file | Findings array becomes cumulative per task (carry forward verbatim, reset on GO) with `first_seen_round`/`resolved_round`. Gate predicate: `resolved_round > first_seen_round` ⇒ check required. |
| C-8 | US-2 | Fingerprint (path:line:category) breaks across rounds | Identity = the carried-forward entry itself; fingerprints not re-derived on carry-forward. |
| C-9 | US-2 | ACCEPTED vs un-encodable contradiction | One decision point: un-encodable + human-ACCEPTED = waived (no escalation, permanent-waiver prompt); un-encodable + not accepted = design-not-converging. Human authority preserved, waiver made loud. |
| C-10 | US-2 | Who writes check fields, via what channel | New `## Ratchet` section in `briefs/<task>-impl.md` (implementer proposes); roster-review consumes into review.json (it owns that artifact). |
| C-11 | US-2 | No frozen set exists for non-trust/spec-less tasks | Checks land in the test suite (new file); review.json `check` field references them; no spec file created. |
| C-12 | US-2 | New check file trips the scope gate | Loop-back manifest re-derivation gains "∪ declared ratchet check paths". |
| C-13 | US-2 | Who executes spec-level CHECK-N every round | roster-implement runs spec CHECK-N commands in its quality gates each round; the convergence gate re-runs only newly-added checks (red + green halves). |
| C-14 | US-3 | Resume routing bypasses the gate | roster-run invokes the gate on the resume edge before the verdict-table route-back. Gate is read-only, so this is safe for a route-only phase. |
| C-15 | US-3 | design-not-converging dead-ends for upgraded tasks (no intake brief) | Escalation on express/fast = stop + guided human restart under full mode (which runs intake). Full-mode tasks have an intake brief by construction, so /roster-spec routing is always satisfiable there. |
| C-16 | US-3 | Which NO-GOs increment the counter | Only NO-GOs with ≥1 OPEN HIGH+ non-scope finding. Scope-only NO-GOs don't count. QA loop explicitly out of scope — residual documented (FR-032). |
| C-17 | US-3 | Cap-hit vs un-encodable share one enum value | New `no_go_reason.cause` field: `"round-cap"` \| `"unencodable-finding"`. |
| C-18 | US-3 | Counter write ownership; crash between verdict-write and gate-run | roster-review writes state (reads prior file, increments at emission); gate is pure read-only → idempotent, re-run on resume covers crashes. |
| C-19 | US-4 | Which SHA is `pre_fix_sha`; uncommitted trees | HEAD at the NO-GO verdict emission that first records the finding. Uncommitted-tree tasks: `pre_fix_sha` null + reason; `red_verified` stays null; gate accepts but flags in one-liner. **[HUMAN-REVIEW]** accepted residual: no red-proof for uncommitted-tree work. |
| C-20 | US-4 | Overlay contamination for existing-file checks | Ratcheted checks MUST be new self-contained files. File-level overlay is then always clean. |
| C-21 | US-4 | Check weakened after verification | `check_blob` recorded at verification; blob mismatch → mandatory re-verification. |
| C-22 | US-4 | Test runners exit 1 for both assertion and error | Every ratcheted check declares a red command honoring 0=pass/1=assertion/≥2=error (trivial self-contained node wrapper; template in skill text). Convention documented as distinct from gate-script exit-2=degraded. |
| C-23 | US-4 | P1 "mandatory" contradiction | US-4 promoted to P0; ships with the ratchet, never after it. |
| C-24–C-27 | US-5 | Upgrade event fails ledger jq schema (CORRUPT); append vs mutate both broken; downgrade rejection task-fatal | **[HUMAN-REVIEW]** US-5 (automatic mode upgrade) dropped. Replaced by stop + guided restart under full mode (existing sanctioned path, roster-run.md:206-209 pattern). Ledger untouched; no new event shapes; immutability rule unamended. |
| C-28 | US-5 | Conflicts with existing informational Mode Escalation Check | No conflict remains: the existing informational check stays as-is; the new gate-blocked stop is a distinct, binding signal that ends the run rather than annotating it. |

## Functional Requirements

#### Trust-Boundary Tasks Never Skip the Invariant Freeze [US-1]

- **FR-001** [US-1]: roster-intake MUST emit a `**Trust boundary:** yes|no` field in the brief, proposed via the keyword heuristic (auth/attest/evidence/authority/permission/token/signature/custody/integrity) and confirmed by the human at the intake gate.
- **FR-002** [US-1]: roster-spec's Trigger Check MUST route a task with Type fix/refactor/chore/docs AND `Trust boundary: yes` to the minimal-freeze profile; it MUST NOT skip the spec phase for such a task.
- **FR-003** [US-1]: When the Trust boundary field is `no` or absent, roster-spec MUST skip as today; when the field is absent (legacy brief), roster-spec MUST emit a warning before skipping.
- **FR-004** [US-1]: The minimal-freeze profile MUST write `specs/<task-slug>.md` marked `**Profile: minimal-freeze**` containing Invariants, Runnable Checks (CHECK-N), and one AC-N paired 1:1 with each CHECK-N.
- **FR-005** [US-1]: The minimal-freeze profile MUST NOT require user stories or FR ceremony; the `min_user_stories` and `min_gwtscenarios_per_story` tunables MUST NOT apply to a minimal-freeze spec.
- **FR-006** [US-1]: When a spec file already exists for the task, roster-spec MUST extend it by adding invariants; it MUST NOT skip on the grounds that the file exists.
- **FR-007** [US-1]: When no invariant is derivable for a trust-boundary task, roster-spec MUST return BOUNCED.
- **FR-008** [US-1]: roster-run in Full mode MUST dispatch to /roster-spec when Type is feature/api-change OR the brief carries `Trust boundary: yes`.
- **FR-009** [US-1]: roster-run MUST run the trust-boundary keyword heuristic at classification for every task and, on a trust-boundary signal, MUST recommend full mode to the human before the mode is recorded.

#### Invariant Ratchet on Loop-Back Rounds [US-2]

- **FR-010** [US-2]: roster-review MUST keep the review.json findings array cumulative across rounds of one task — prior findings carried forward verbatim with updated status — and MUST reset it on a GO verdict.
- **FR-011** [US-2]: roster-review MUST record on each finding: `first_seen_round` (int), `resolved_round` (int|null), `check` (string|null), `check_encodable` (bool, default true), `red_verified` (bool|null), `pre_fix_sha` (string|null), `check_blob` (string|null).
- **FR-012** [US-2]: A HIGH+ finding with `resolved_round > first_seen_round` MUST have a non-null `check` to be marked RESOLVED.
- **FR-013** [US-2]: Findings raised and resolved in the same round, and findings ACCEPTED by the human, MUST be exempt from the FR-012 check obligation; two findings MAY share one check.
- **FR-014** [US-2]: The acceptance prompt for a HIGH+ finding MUST state that accepting waives the invariant permanently.
- **FR-015** [US-2]: Cross-runtime CRITICAL/HIGH findings that drive a NO-GO MUST be mirrored into the primary findings array at verdict time; the originals in `cross_runtime_findings` MUST NOT be edited (augment-only).
- **FR-016** [US-2]: A ratcheted check MUST be a new self-contained file (new test file, or spec-level CHECK-N command); an existing-file modification MUST NOT satisfy the ratchet.
- **FR-017** [US-2]: The implementer MUST declare each ratchet check in a `## Ratchet` section of `briefs/<task>-impl.md` (finding ref, check path, red command, proposed check_encodable + reason), and roster-review MUST consume that section into review.json.
- **FR-018** [US-2]: roster-implement's loop-back manifest re-derivation MUST union the declared ratchet check paths into the manifest so new check files do not trip the scope gate.
- **FR-019** [US-2]: For a non-trust task with no spec artifact, ratchet checks MUST land in the test suite; the system MUST NOT create a spec file for this purpose.
- **FR-020** [US-2]: roster-implement MUST run the spec's CHECK-N commands as part of its quality gates on every round.

#### Mechanical Convergence Gate + Escalation [US-3]

- **FR-021** [US-3]: roster-review MUST maintain `no_go_round` in review.json — read prior value, increment at NO-GO verdict emission, reset to 0 on GO — and MUST NOT increment it for a NO-GO with zero OPEN HIGH+ non-scope findings (scope-only NO-GO).
- **FR-022** [US-3]: `scripts/check-review-convergence.js` MUST be read-only (it MUST NOT modify any repo file) and MUST honor the exit contract 0=pass, 1=violation, 2=degraded-input.
- **FR-023** [US-3]: On gate exit 2, the pipeline MUST block the route-back and surface the degraded input to the human (fail-closed).
- **FR-024** [US-3]: roster-review MUST invoke the gate before routing a NO-GO back to implement, AND roster-run MUST invoke the gate on the resume edge before the verdict-table route-back.
- **FR-025** [US-3]: The gate MUST report a violation (exit 1) when any HIGH+ finding has `resolved_round > first_seen_round` and a null `check`.
- **FR-026** [US-3]: The gate MUST report a violation when `no_go_round >= tunables.max_no_go_rounds` (roster-review frontmatter, default 5).
- **FR-027** [US-3]: When a HIGH+ finding has `check_encodable: false` and is not human-ACCEPTED, roster-review MUST emit `no_go_reason.type = "design-not-converging"` with `no_go_reason.cause` set to `"unencodable-finding"` or `"round-cap"`, and the verdict MUST route to /roster-spec (full mode).
- **FR-028** [US-3]: roster-run's verdict table MUST contain a design-not-converging row placed above the catch-all row.
- **FR-029** [US-3]: When an Express/Fast task hits escalation, the pipeline MUST stop and instruct the human to restart the task under full mode; it MUST NOT mutate the ledger and MUST NOT upgrade the mode automatically.
- **FR-030** [US-3]: The gate MUST treat a legacy review.json lacking the `no_go_round` key as round 0 with a warning (not exit 2); an absent or otherwise-malformed review.json MUST produce exit 2.
- **FR-031** [US-3]: roster-review MUST surface `no_go_round` and the checks added this task in the review human-gate one-liner.
- **FR-032** [US-3]: The skill documentation MUST record the known residual that the review-GO → QA-NO-GO → implement loop remains unbounded (roster-qa out of scope); the gate MUST NOT attempt to bound it.

#### Red-Before-Green Proof [US-4]

- **FR-033** [US-4]: At NO-GO verdict emission, roster-review MUST record `pre_fix_sha` = current HEAD for each new HIGH+ finding, or null with a recorded reason when the working tree has no committed baseline for the defect.
- **FR-034** [US-4]: When `pre_fix_sha` is null (uncommitted-tree task), `red_verified` MUST stay null, the gate MUST accept, and the condition MUST be flagged in the human one-liner.
- **FR-035** [US-4]: For each newly-added check with a non-null `pre_fix_sha`, the gate MUST create a scratch copy (`git archive` extraction) of `pre_fix_sha` in the scratch directory, overlay ONLY the new check file(s), and run the declared red command.
- **FR-036** [US-4]: On red-command exit 1 the gate MUST record `red_verified: true` and `check_blob` (git hash-object of the check file) in its report for roster-review to persist; on exit 0 the gate MUST report a violation (vacuous check, gate exit 1); on exit ≥2 or setup failure the gate MUST report `red_verified: false` (inconclusive) and surface it to the human.
- **FR-037** [US-4]: Red commands (spec-level CHECK-N and ratchet red commands) MUST follow the exit convention 0=check passes, 1=assertion fired, ≥2=error; the docs MUST note this convention as distinct from the gate-script convention (where 2=degraded input).
- **FR-038** [US-4]: When a check file with `red_verified: true` has a current blob differing from the recorded `check_blob`, the gate MUST re-run red verification; failing that, it MUST report a violation (weakening protection).
- **FR-039** [US-4]: The gate MUST run each newly-added check against the CURRENT tree and require it to pass (green half).

## Acceptance Criteria

- AC-1 [US-1 happy path]: Brief with Type: fix and `Trust boundary: yes` reaches roster-spec → minimal-freeze spec written with `**Profile: minimal-freeze**`, Invariants, CHECK-N; phase not skipped. (FR-002, FR-004)
- AC-2 [US-1, C-3]: Legacy brief, no Trust boundary field, Type: fix → skipped as today AND warning emitted. (FR-003)
- AC-3 [US-1, C-2]: Minimal-freeze spec → every CHECK-N has exactly one paired AC-N and vice versa; `min_user_stories`/`min_gwt` not enforced. (FR-004, FR-005)
- AC-4 [US-1, C-5]: Trust-boundary task with no derivable invariant → BOUNCED, no spec file. (FR-007)
- AC-5 [US-1, C-1]: Task description containing "signature verification" at classification → heuristic fires, full mode recommended to human before mode recorded. (FR-009)
- AC-6 [US-2 happy path]: HIGH finding round 1, fix + new check file declared in `## Ratchet` round 2 → `first_seen_round: 1`, `resolved_round: 2`, non-null `check`; RESOLVED valid; gate passes. (FR-011, FR-012, FR-017)
- AC-7 [US-2, C-20]: Ratchet declaration pointing at an existing-file modification → not accepted. (FR-016)
- AC-8 [US-2, C-12]: New check file declared in `## Ratchet` on loop-back → re-derived manifest includes it; scope gate silent. (FR-018)
- AC-9 [US-2, C-9]: ACCEPT prompt for HIGH+ finding states permanent waiver; accepted finding exempt from check obligation. (FR-013, FR-014)
- AC-10 [US-2, C-15/EC-6]: Cross-runtime HIGH finding drives NO-GO → mirrored into primary findings; original in `cross_runtime_findings` byte-identical. (FR-015)
- AC-11 [US-3 happy path]: `no_go_round` reaches 5 → gate exits 1, route-back blocked, verdict `design-not-converging` + `cause: "round-cap"`. (FR-021, FR-026, FR-027)
- AC-12 [US-3, C-16]: NO-GO whose only OPEN findings are scope findings → `no_go_round` unchanged. (FR-021)
- AC-13 [US-3, C-18]: Gate run against any input → no repo file created or modified. (FR-022)
- AC-14 [US-3, C-14]: Resume at roster-run verdict edge with violating review.json → gate invoked, route-back blocked. (FR-024)
- AC-15 [US-3, C-17/C-28]: Un-encodable non-ACCEPTED HIGH+ finding → `design-not-converging` + `cause: "unencodable-finding"`; routed via new row sitting above the catch-all. (FR-027, FR-028)
- AC-16 [US-3, C-24..27]: Express task hits round cap → pipeline stops with restart-under-full instruction; ledger `.mode` unchanged; zero new ledger events. (FR-029)
- AC-17 [US-3, C-30/EC-8]: review.json missing `no_go_round` → round 0 + warning; review.json absent → exit 2. (FR-030, FR-023)
- AC-18 [US-4 happy path]: New HIGH finding gets `pre_fix_sha` = HEAD; loop-back check red command exits 1 in the pre-fix scratch copy and 0 on current tree → `red_verified: true`, `check_blob` recorded, gate passes. (FR-033, FR-035, FR-036, FR-039)
- AC-19 [US-4]: Red command exits 0 on pre-fix worktree → vacuous-check violation, route-back blocked. (FR-036)
- AC-20 [US-4, EC-10]: Setup failure or exit ≥2 → `red_verified: false` inconclusive, surfaced to human, self-containment remedy offered first. (FR-036)
- AC-21 [US-4, C-21]: Red-verified check file later edited (blob mismatch) → red verification re-run; if it cannot pass, gate exits 1. (FR-038)
- AC-22 [US-4, C-19]: Uncommitted-tree task → `pre_fix_sha` null + reason, `red_verified` null, gate accepts, one-liner flags it. (FR-034)

## Edge Cases

- EC-1 [US-1]: Trust boundary field absent (legacy brief) → fail-open skip + warning (AC-2).
- EC-2 [US-1]: Human overrides keyword proposal to "no", review later finds trust surface → normal ratchet applies on loop-back; no re-proposal mechanism (residual, human decision was explicit).
- EC-3 [US-1]: `specs/<slug>.md` already exists when minimal path fires → extend, never skip (FR-006).
- EC-4 [US-2]: HIGH finding raised and resolved within one round → exempt (never crossed a loop-back).
- EC-5 [US-2]: Two HIGH findings reveal the same invariant → one shared check, both link it (FR-013).
- EC-6 [US-2]: Cross-runtime HIGH finding drives loop-back → mirrored into primary findings (FR-015).
- EC-7 [US-3]: Gate itself exits 2 on a would-be cap round → fail-closed to human (FR-023), not auto-escalation.
- EC-8 [US-3]: Pre-change review.json without `no_go_round` on resume → round 0 + warning (FR-030).
- EC-9 [US-3]: GO with ACCEPTED HIGH findings resets counter; same defect class re-surfacing later restarts at 0 — expected; ratcheted checks from prior rounds still guard it permanently.
- EC-10 [US-4]: `pre_fix_sha` unreachable (shallow clone, rewritten branch) → error-red path, human surfaced (AC-20).
- EC-11 [US-4]: Nondeterministic check flakes on red run → single-run policy; flagged as general test-quality issue, not retried by the gate.
- EC-12 [US-4]: Check needs runtime-assembled fixtures (repo push-protection) → self-containment requirement covers it; check file must assemble its own fixtures.
- EC-13 [US-3]: Task with no ledger at all hits escalation → stop + restart guidance works identically (no ledger writes needed).

## Runnable Checks

- CHECK-1 [AC-11, AC-13, AC-17, AC-19]: `node --test scripts/check-review-convergence.test.js` → expected: exit 0 (contract test covers cap, RESOLVED-without-check, read-only, legacy round-0, absent→exit-2, vacuous-red fixtures).
- CHECK-2 [AC-15]: `grep -c 'design-not-converging' skills/pipeline/roster-review.md skills/pipeline/roster-run.md` → expected: ≥1 in each file.
- CHECK-3 [AC-15]: in `skills/pipeline/roster-run.md`, the `design-not-converging` verdict row appears at a lower line number than the catch-all "any other reason" row → expected: true (grep -n comparison).
- CHECK-4 [AC-1, AC-2]: `grep -q 'Trust boundary' skills/pipeline/roster-intake.md && grep -q 'minimal-freeze' skills/pipeline/roster-spec.md` → expected: exit 0.
- CHECK-5 [AC-6]: `grep -q '## Ratchet' skills/pipeline/roster-implement.md && grep -q 'first_seen_round' skills/pipeline/roster-review.md` → expected: exit 0.
- CHECK-6 [AC-11]: `grep -q 'max_no_go_rounds' skills/pipeline/roster-review.md` → expected: exit 0 (frontmatter tunable, default 5).
- CHECK-7 [projection]: `bash scripts/sync-harness.sh --check` → expected: exit 0 (three projections in sync).
- CHECK-8 [all]: `npm test` → expected: exit 0 (includes new contract test once wired).
- CHECK-9 [AC-5, FR-009]: `diff <(grep -oE 'auth|attest|evidence|authority|permission|token|signature|custody|integrity' skills/pipeline/roster-intake.md | head -1) <(grep -oE 'auth|attest|evidence|authority|permission|token|signature|custody|integrity' skills/pipeline/roster-run.md | head -1)` → expected: exit 0 (the trust-boundary keyword regex is duplicated verbatim in both files — this is a drift guard, not a dedup; a mismatch means one file's heuristic silently diverged from the other).

## Amendments (v1.1.0 — plan-phase dual-voice review, 2026-07-13)

The plan phase's two independent voices found consistency defects in v1.0.0. Resolutions below
**amend** the FRs they cite; where an amendment conflicts with earlier text, the amendment wins.

- **A-1 (O-1, GO-round bypass — critical):** FR-024 amended: the gate MUST be invoked at **every
  verdict emission (GO and NO-GO)**, before the verdict is persisted and before the human gate.
  On a GO round, any gate violation (RESOLVED-without-check, vacuous red, blob mismatch)
  invalidates the GO — the verdict becomes NO-GO with the violation as a finding. The ratchet is
  enforced most strictly on the round that ends the loop.
- **A-2 (O-2/O-3, read-only contradiction + no writer):** FR-022/AC-13 amended: "read-only" means
  the gate MUST NOT modify the repo working tree or `.git` (no `git worktree add`; pre-fix trees
  are extracted via `git archive <sha> | tar -x` into the scratch directory). Red/green commands
  run inside scratch copies with a cwd jail and a per-command timeout (default 120s, `--timeout`
  flag). **Invocation order fixed:** roster-review composes a draft verdict → invokes the gate
  (full mode: executes red/green, emits a JSON report on stdout) → merges report fields
  (`red_verified`, `check_blob`) and any blocking outcome into the verdict → writes review.json
  **once**. No post-write crash window. On the roster-run resume edge the gate runs in
  `--static` mode: structural checks only (fields, counters, cap), no command execution — results
  were already persisted at verdict time; roster-run stays route-only.
- **A-3 (O-5, poisoned pre_fix_sha):** New FR-040: in Fast/Full modes, roster-implement MUST
  commit each round's work before handing off to review; roster-review MUST verify a clean tree
  at verdict emission — if dirty, `pre_fix_sha` is null with reason `"dirty-tree"` and the
  one-liner flags it (never a confidently wrong SHA).
- **A-4 (O-7, CHECK-N vs improve loop):** FR-020 amended: roster-implement runs non-`manual`
  spec CHECK-N commands and prior rounds' ratcheted checks as quality gates **on loop-back rounds
  only**. A check introduced in the current round follows TDD (expected red mid-round); manual
  CHECK-Ns are excluded. Mid-implementation failures of current-round checks do not consume
  `max_improve_iterations`.
- **A-5 (O-8, manifest widening):** FR-018 amended: the loop-back manifest union takes paths of
  **OPEN findings only** plus the **current round's** declared ratchet check paths. RESOLVED
  rounds stop widening the scope gate.
- **A-6 (O-9, wrapper realism):** FR-037 amended: ratchet red commands MUST be plain self-contained
  scripts (e.g. `node <check>.js` using its own assertions mapped to exit 1, errors to exit ≥2) —
  MUST NOT rely on a test runner's exit codes (`node --test`/jest exit 1 for both assertion and
  load error). The runner-integrated copy of the check (for the suite) and the red command may be
  the same file when the file honors the convention when executed directly. Template ships in
  roster-implement's skill text. The gate sets `NODE_PATH` to the live repo's `node_modules` for
  scratch-tree runs (dependency availability without repo mutation).
- **A-7 (O-11, distribution):** New FR-041: `scripts/check-review-convergence.js` MUST be
  registered in the pipeline install path (installer + `check-pipeline-install.js` manifest) so
  consumer repos receive it, mirroring `check-scope-diff.sh`. FR-026 amended: the script
  hard-codes default 5 and accepts `--max-rounds <n>`; the invoking skill prose passes the
  tunable from frontmatter (the script never parses projection frontmatter itself).
- **A-8 (O-12, permanence after GO):** New FR-042: on a GO verdict, before the reset (FR-010),
  roster-review MUST promote every red-verified ratcheted check to a permanent home: appended as
  a CHECK-N entry in `specs/<task-slug>.md` when a spec exists; otherwise the check file remains
  in the test suite and post-GO weakening protection degrades to ordinary test discipline
  (documented residual — the brief's "permanent guarantee" wording is scoped accordingly).
- **A-9 (O-10, keyword-prompt collision):** FR-009 amended: when the existing `--critical` Tier A
  keyword check and the trust-boundary heuristic both fire at classification, roster-run MUST
  present a single combined prompt, with the critical route taking precedence (critical already
  implies full mode). Implementation note: the roster-run diff is the riskiest of the batch — the
  byte-synced jq ledger block (roster-run.md:149-168) must remain byte-identical.
- **A-10 (Voice 1, escalation-vs-trigger gap):** FR-027 amended: when `design-not-converging`
  routes a task to `/roster-spec`, the escalation context MUST force the minimal-freeze profile
  regardless of the Trust-boundary flag or Type — the un-encodable finding IS the invariant gap
  to spec. Trigger Check gains this escalation-entry exception.
- **A-11 (O-6, unverifiable carry-forward — accepted residual):** The gate verifies the artifact
  it is handed; it cannot prove roster-review carried findings forward honestly (prior state is
  overwritten). Documented residual: the gate hardens routing and resolution against drift, not
  against a reviewer that rewrites history. Mitigation kept cheap: the gate warns when
  `no_go_round` is 0 while findings carry `first_seen_round > 0` (internal inconsistency check).

## Entities

- `ConvergenceGate`: the read-only script `scripts/check-review-convergence.js` deciding whether a NO-GO route-back is permitted (exit 0/1/2).
- `RatchetCheck`: a new self-contained runnable check (test file or spec CHECK-N command) linked from a HIGH+ finding, proven red against `pre_fix_sha` and green against the current tree.
- `MinimalFreezeSpec`: a `specs/<slug>.md` with `**Profile: minimal-freeze**` — Invariants + CHECK-N + paired AC-N, no story ceremony.
- `TrustBoundaryFlag`: the `**Trust boundary:** yes|no` intake field (keyword-proposed, human-confirmed).
- `NoGoRound`: per-task NO-GO counter in review.json, incremented only by finding-driven NO-GOs, reset on GO.
- `RedCommand`: a check's declared command honoring exit 0=pass / 1=assertion fired / ≥2=error.
