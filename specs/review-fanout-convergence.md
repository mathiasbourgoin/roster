---
name: review-fanout-convergence
type: spec
status: live
feature: Review fan-out convergence (two-strike escalation, cross-runtime circuit breaker, delta reviewer selection, authentic-path freeze)
brief: briefs/review-fanout-convergence-intake.md
date: 2026-07-13
version: 1.1.0
---

# Spec — Review Fan-out Convergence

> **Provenance:** produced under explicit full-autonomy delegation (2026-07-13, "handle it
> autonomously up to merging"). Evidence base: `~/dev/bounty-skills/skills-meta/health-2026-07-13.md`
> (H-01..H-04). Extends the pipeline-loop-convergence family — FR numbering continues at FR-050.
> All human gates auto-decided; decisions recorded below.

## Clarifications (challenge-resolution highlights)

| Q | A |
|---|---|
| Round identity (C-1/C-3/C-14, the load-bearing cluster) | New physical `round` counter in review.json: incremented at EVERY verdict emission, reset on GO. `first_seen_round`/`resolved_round` stamp from it. `no_go_round` unchanged (qualifying-only backstop). Loop-back ≡ round ≥ 2. |
| Does round 1 count as a strike? (C-2) | Never — it is inherently novel. Streak window starts at round 2. |
| Same-round-resolved / ACCEPTED novel findings? (C-3/C-5) | Don't count as strikes — which makes a clean GO round strike-free by construction; the streak can never flip a GO. |
| Degraded runtime manufactures strikes? (C-6) | Impossible by construction: degraded output is discarded entirely, never merged into `cross_runtime_findings`. |
| What is "the probe"? (C-8) | The first real cross-runtime pass. Healthy status is recorded too (else probe-once is unimplementable). A healthy runtime runs every round until its first failure → degraded at that round, never retried. |
| config_digest domain (C-9) | hash(runtime name + `--version` output (10s timeout) + wrapper flags). Prompt/diff excluded — else the digest changes every round and the no-retry rule is void. |
| Audit-trail shape (C-15) | `rounds_audit` append-only array, one entry per round including GO drafts; reset on GO. Dirty tree → `fix_sha: null` + reason (flag, not violation). |
| Bookkeeping violation routed to spec-freeze? (C-17) | No — new cause `process-incomplete` is fixed in the draft and the gate re-run BEFORE persisting; only design causes (round-cap, unencodable-finding, novel-finding-streak) map to design-not-converging routing. |
| Delta selection starves the streak signal? (C-23) | Anti-starvation rule: a round whose predecessor recorded a strike runs FULL fan-out — strike 2 is always measured under full scrutiny. |
| US-4 enforcement level (C-21/C-22) | Prose-and-human, accepted and documented. Authentic-path checks need not be gate-executable; never auto-linked as ratchet red-runs unless self-contained. |
| Two CLIs on PATH (C-13) | `cross_runtime` is keyed by runtime name — per-runtime status. Schema-valid empty findings = healthy. Wrapper tree-mutation exit = degraded, reason "tree-mutation", human-flagged. |
| Multiple violations, one cause field (C-4) | Precedence: unencodable-finding > novel-finding-streak > round-cap. |
| QA-return after GO (C-10/C-18) | GO resets round, cross_runtime, rounds_audit. A QA-driven return is a fresh review cycle: round 1 rules, full selection, one re-probe. Deliberate — post-QA re-review deserves full scrutiny. |

## User Stories

### US-1: Two-strike novel-finding escalation (Priority: P0)
As the pipeline, I want the design-problem signature — new HIGH+ findings appearing in consecutive rounds — detected mechanically, so escalation fires on the right signal instead of a late round count.
**Scope**: does NOT change the cap backstop semantics; does NOT touch roster-run (cause is a subfield of the existing design-not-converging row).
**Independent Test**: fixture with novel HIGH+ findings in rounds 2 and 3 → gate exits 1 with novel-finding-streak.
**Acceptance Scenarios**:
1. **Given** novel unresolved non-ACCEPTED HIGH+ non-scope findings in rounds 2 and 3, **When** the gate runs (default `--strikes 2`), **Then** violation `{type: "novel-finding-streak", cause: "novel-finding-streak"}` and exit 1.
2. **Given** a strike at round 2, a strike-free round 3, a strike at round 4, **When** the gate runs, **Then** no streak violation (reset).
3. **Given** round 1 full of novel findings, **When** strikes are evaluated, **Then** round 1 contributes none.
4. **Given** `--strikes abc` or `--strikes 0`, **When** invoked, **Then** exit 2.

### US-2: Cross-runtime circuit breaker (Priority: P0)
As a reviewer, I want an unhealthy secondary runtime to cost the task at most one bounded attempt, so successive rounds stop paying for banner-only output and ten-minute timeouts.
**Scope**: does NOT change GO authority of findings recorded while healthy; does NOT remove cross-runtime review where the runtime works.
**Independent Test**: simulate a timeout → status degraded recorded, later rounds skip the runtime.
**Acceptance Scenarios**:
1. **Given** a first pass returning schema-valid findings in time, **When** recorded, **Then** `cross_runtime.<name> = {status: "healthy", config_digest, round}` and findings keep full GO authority.
2. **Given** a timeout/banner-only/refusal/schema-invalid/tree-mutation outcome, **When** processed, **Then** status degraded with specific reason, output discarded, no retry on later rounds.
3. **Given** an unchanged config_digest, **When** later rounds run, **Then** no re-probe; a changed digest or explicit human request re-probes.
4. **Given** schema-valid output with zero findings, **When** recorded, **Then** healthy.

### US-3: Delta-scoped loop-back reviewer selection (Priority: P1)
As the pipeline, I want loop-back rounds to re-run the owner reviewer plus only implicated specialists, so a narrow correction stops replaying the full fan-out — safe now because the ratchet + every-round gate hold the floor.
**Scope**: round 1 selection unchanged; full fan-out re-triggers on trust-surface changes and after a streak strike (anti-starvation).
**Independent Test**: loop-back with one OPEN finding naming specialist S → exactly owner + S run; audit entry present.
**Acceptance Scenarios**:
1. **Given** a loop-back round with one OPEN finding naming S and no trust-surface change, **When** selection runs, **Then** owner `reviewer` + S only, recorded in `rounds_audit` with non-empty selection_reason.
2. **Given** the correction changes authority/custody/publication semantics, **When** selection runs, **Then** full fan-out, entries `"full-fanout: <trigger>"`.
3. **Given** round r recorded a strike, **When** round r+1 selection runs, **Then** full fan-out (anti-starvation).
4. **Given** a round ≥ 2 verdict draft with a missing/incomplete rounds_audit entry, **When** the gate runs, **Then** violation `{type: "missing-loopback-audit", cause: "process-incomplete"}` — fixed pre-persist, never routed.

### US-4: Authentic-path requirement in minimal-freeze (Priority: P1)
As a spec author, I want every trust-boundary invariant set to include an authentic success path to the real consumer boundary and a fail-closed path, so first-round review never starts on synthetic-only evidence.
**Scope**: prose-and-human enforced (accepted level); checks need not be gate-executable.
**Independent Test**: a minimal-freeze spec without the annotated pair and without the marker fails Step-9 presentation.
**Acceptance Scenarios**:
1. **Given** a new minimal-freeze spec, **When** drafted, **Then** it contains a CHECK-N annotated `(authentic-success-path)` and one annotated `(fail-closed-path)` (one CHECK-N may carry both).
2. **Given** no feasible authentic path, **When** the spec carries `**Authentic path: not feasible — <reason>**`, **Then** Step-9 explicitly echoes the marker; approval = acknowledgment.
3. **Given** the human declines the marker and no path can be added, **When** the phase concludes, **Then** BOUNCED.
4. **Given** an extension of a pre-existing minimal-freeze spec, **When** written, **Then** it adds the pair or the marker.

## Challenges

24 challenges + 20 edge cases raised; all resolved. Highlights are in Clarifications; the full
resolution set is embodied in FR-050..FR-085 (each C/EC maps to at least one FR; the adversarial
transcript is preserved in the pipeline run record). Notable accepted residuals:
- **R-1 (C-22):** US-4 has no mechanical enforcement point — prose-and-human by design; revisit
  if friction data shows label-gaming.
- **R-2 (C-11):** the degraded-inconsistency warning is structural-completeness only; per-round
  attribution of cross_runtime_findings is not reconstructible without per-entry round fields
  (deferred with H-05 normalizer).
- **R-3 (EC-2):** a scope-only round resets the streak (slight under-detection) — accepted for
  simplicity; the cap backstop still applies.

## Functional Requirements

(Contiguous with the pipeline-loop-convergence family; FR-001..FR-042 live in
`specs/pipeline-loop-convergence.md`.)

#### Two-Strike Novel-Finding Escalation [US-1]

- **FR-050** [US-1]: roster-review MUST maintain a physical counter `round` in review.json and MUST increment it at every verdict emission, whether or not the round is qualifying.
- **FR-051** [US-1]: roster-review MUST reset `round` to 0 when a GO verdict is emitted.
- **FR-052** [US-1]: roster-review MUST stamp `first_seen_round` and `resolved_round` from the physical `round` counter; `no_go_round` MUST remain qualifying-only and MUST continue to serve solely as the round-cap backstop.
- **FR-053** [US-1]: The convergence gate MUST classify a physical round r ≥ 2 as a strike if and only if that round contains at least one novel HIGH+ non-scope finding (`first_seen_round == r`) that is neither same-round-resolved nor ACCEPTED; the gate MUST NOT classify round 1 as a strike.
- **FR-054** [US-1]: The convergence gate MUST emit violation `{type: "novel-finding-streak", cause: "novel-finding-streak"}` when the last `strikes` consecutive physical rounds (all ≥ 2) each classify as a strike.
- **FR-055** [US-1]: The convergence gate MUST reset the strike streak whenever a strike-free physical round occurs; non-consecutive strikes MUST NOT accumulate.
- **FR-056** [US-1]: The convergence gate MUST accept `--strikes N` validated as an integer ≥ 1, MUST exit 2 on a non-numeric or out-of-range value, and MUST default to a hard-coded 2 when absent; §5.5's command line MUST document `--strikes`.
- **FR-057** [US-1]: roster-review MUST pass `tunables.novel_finding_strikes` to the gate as `--strikes` when set.
- **FR-058** [US-1]: Documentation MUST state that GO drafts cannot be flipped by the streak check (same-round-resolved findings never count, so a clean GO round is strike-free by construction).
- **FR-059** [US-1]: With multiple violations, the gate MUST select the verdict `cause` by precedence `unencodable-finding` > `novel-finding-streak` > `round-cap`.

#### Cross-Runtime Circuit Breaker [US-2]

- **FR-060** [US-2]: roster-review MUST treat the first real cross-runtime pass as the probe and record `cross_runtime` as an object keyed by runtime name with `{status, reason, config_digest, round}`; healthy status MUST be recorded, not only degraded.
- **FR-061** [US-2]: roster-review MUST mark a runtime degraded on: hard timeout (tunable `cross_runtime_probe_timeout`, default 120s, passed to `xruntime-exec.sh --timeout`), empty/banner-only output, refusal, schema-invalid or truncated output, or wrapper tree-mutation exit (reason `"tree-mutation"`, human-flagged).
- **FR-062** [US-2]: Schema-valid output with an empty findings array MUST record healthy; an empty findings array MUST NOT by itself trigger degraded.
- **FR-063** [US-2]: The output of a degraded run MUST be discarded entirely — never merged into `cross_runtime_findings` — with the degradation reason logged.
- **FR-064** [US-2]: Findings recorded while a runtime was healthy MUST retain full GO-blocking authority after it degrades.
- **FR-065** [US-2]: A healthy runtime MUST keep running each round until its first failure, MUST flip to degraded at that round, and MUST NOT be retried within or after it.
- **FR-066** [US-2]: A degraded runtime MUST NOT be re-probed or re-run unless its `config_digest` changes or the human explicitly requests a retry.
- **FR-067** [US-2]: `config_digest` MUST hash the runtime name, the CLI's `--version` output (10-second timeout; hang → degraded, reason `"version-probe-timeout"`), and the wrapper flags; prompt/diff content MUST be excluded.
- **FR-068** [US-2]: The `cross_runtime` object MUST carry forward across rounds and reset on GO; a QA-return review cycle re-probes once (accepted, documented).
- **FR-069** [US-2]: The gate MUST warn when a degraded runtime entry lacks `reason` or `config_digest`; gate warnings MUST surface in the human-gate one-liner (FR-031 extension).
- **FR-070** [US-1][US-2]: Degraded-runtime output MUST never contribute a novel finding to strike computation (guaranteed by FR-063).

#### Delta-Scoped Loop-Back Reviewer Selection [US-3]

- **FR-071** [US-3]: On round 1 (`round == 1` or legacy review.json missing `round`), roster-review MUST apply existing risk-based selection unchanged; the audit trail is not mandatory and the gate MUST downgrade a missing legacy entry to a warning (FR-030 pattern).
- **FR-072** [US-3]: On loop-back rounds (round ≥ 2), roster-review MUST always run the owner `reviewer` agent.
- **FR-073** [US-3]: On loop-back rounds, a specialist MUST re-run if and only if it is named in an OPEN finding's `specialist` field or a trust-boundary surface changed since `reviewed_sha`; others MUST NOT re-run.
- **FR-074** [US-3]: Cross-runtime participation on loop-back rounds MUST be governed exclusively by US-2 state: healthy + owns an OPEN finding → re-run; degraded → never.
- **FR-075** [US-3]: Full fan-out MUST re-trigger when a correction changes public behavior, authority, custody, isolation, or publication semantics; the judgment MUST be recorded in the audit entry.
- **FR-076** [US-3]: Full fan-out MUST re-trigger for any round whose immediately preceding round recorded a streak strike (anti-starvation).
- **FR-077** [US-3]: roster-review MUST append one entry per round — including GO drafts — to an append-only `rounds_audit` array shaped `{round, reviewed_sha, fix_sha, specialists_run: [{name, selection_reason}]}` with non-empty selection_reason; dirty tree → `fix_sha: null` + reason (pass with flag); full fan-out uses `"full-fanout: <trigger>"`; `rounds_audit` resets on GO.
- **FR-078** [US-3]: On round ≥ 2, the gate MUST emit `{type: "missing-loopback-audit", cause: "process-incomplete"}` when the current round's audit entry is missing or incomplete (absent fields, empty `specialists_run`, or any empty `selection_reason`).
- **FR-079** [US-3]: `process-incomplete` violations MUST be fixed in the draft and the gate re-run BEFORE persisting; they MUST NOT escape to routing. Design-not-converging routing applies only to design causes (`round-cap`, `unencodable-finding`, `novel-finding-streak`). The `cause` enum comment MUST document `process-incomplete`; §5.5 MUST document the pre-persist fix loop.

#### Authentic-Path Requirement in Minimal-Freeze [US-4]

- **FR-080** [US-4]: A minimal-freeze invariant set MUST include ≥1 CHECK-N annotated `(authentic-success-path)` reaching the real consumer boundary and ≥1 annotated `(fail-closed-path)`, OR the marker `**Authentic path: not feasible — <reason>**`; one CHECK-N MAY carry both annotations. Enforcement is prose-and-human (accepted, documented).
- **FR-081** [US-4]: The minimal-freeze "containing only" wording MUST be amended to admit the annotations and marker.
- **FR-082** [US-4]: Step-9 validation MUST explicitly surface the not-feasible marker; approval with it surfaced constitutes acknowledgment.
- **FR-083** [US-4]: When the human declines the marker and no feasible path exists, roster-spec MUST return BOUNCED.
- **FR-084** [US-4]: Authentic-path checks MUST NOT be required to be gate-executable and MUST NOT be auto-linked as ratchet red-run checks unless self-contained.
- **FR-085** [US-4]: Any extension of a pre-existing minimal-freeze spec MUST add the pair or the marker.

## Acceptance Criteria

- AC-1 [US-1 happy]: novel unresolved non-ACCEPTED HIGH+ non-scope findings in two consecutive rounds ≥ 2, default strikes → `novel-finding-streak` violation. (FR-053, FR-054)
- AC-2: every verdict emission increments `round` exactly once; new findings stamp `first_seen_round` from it; `no_go_round` advances only when qualifying. (FR-050, FR-052)
- AC-3: strike, strike-free round, strike → no violation at `--strikes 2` (reset). (FR-055)
- AC-4: round 1 contributes no strike regardless of content. (FR-053)
- AC-5: `--strikes abc`/`--strikes 0` → exit 2; absent → 2; tunable 3 → `--strikes 3` passed. (FR-056, FR-057)
- AC-6: all-novel-resolved GO round is strike-free; GO stands; `round` resets to 0. (FR-051, FR-058)
- AC-7: unencodable + streak (+ cap) violations → cause `unencodable-finding`; streak + cap → `novel-finding-streak`. (FR-059)
- AC-8 [US-2 happy]: schema-valid timely first pass → `{status: "healthy", config_digest, round}`; findings keep GO authority. (FR-060, FR-064)
- AC-9: timeout/banner/refusal/invalid/tree-mutation → degraded + specific reason; output absent from `cross_runtime_findings`; no strike derives. (FR-061, FR-063, FR-070)
- AC-10: schema-valid empty findings → healthy. (FR-062)
- AC-11: unchanged digest → no re-probe; changed `--version` or human request → re-probe. (FR-066, FR-067)
- AC-12: degraded persists across rounds; GO resets `cross_runtime`; QA-return re-probes once. (FR-065, FR-068)
- AC-13: degraded entry missing reason/config_digest → gate warning, surfaced in one-liner. (FR-069)
- AC-14 [US-3 happy]: loop-back, one OPEN finding naming S, no trust change → owner + S only; audit entry with non-empty reason. (FR-072, FR-073, FR-077)
- AC-15: loop-back GO draft → complete audit entry exists before the GO reset. (FR-077)
- AC-16: incomplete audit entry on round ≥ 2 → `missing-loopback-audit`/`process-incomplete`; repaired pre-persist; never routes. (FR-078, FR-079)
- AC-17: strike at round r → full fan-out at r+1 with `"full-fanout: <trigger>"` reasons. (FR-076, FR-077)
- AC-18: round 1 / legacy → existing selection; missing audit → warning only. (FR-071)
- AC-19 [US-4 happy]: new minimal-freeze spec carries both annotations (or one dual-annotated CHECK-N); wording admits them. (FR-080, FR-081)
- AC-20: not-feasible marker explicitly echoed at Step-9; approval = acknowledgment. (FR-082)
- AC-21: declined marker + no feasible path → BOUNCED. (FR-083)
- AC-22: manual/CI-only authentic check excluded from ratchet red-runs unless self-contained; extension adds pair or marker. (FR-084, FR-085)

## Edge Cases

- EC-1 [US-1]: novel HIGH+ ACCEPTED same round → no strike (FR-053).
- EC-2 [US-1]: scope-only round between two novel rounds → streak resets (accepted under-detection R-3; cap backstop remains).
- EC-3 [US-1]: `--strikes 1` legal → fires on any single strike round ≥ 2 (aggressive; consumer choice).
- EC-4 [US-1]: novel scope-category finding → never a strike (non-scope filter is per-finding).
- EC-5 [US-2]: two CLIs on PATH → per-runtime keyed entries; independent status.
- EC-6 [US-2]: healthy probe, later-round timeout → flips degraded at that round, no retry after (FR-065).
- EC-7 [US-3]: legacy review.json on a physical loop-back → warning only, never violation (FR-071).
- EC-8 [US-3]: dirty tree → `fix_sha: null` + reason, pass with flag (FR-077).
- EC-9 [US-3]: deduped finding names the surviving specialist only — the converged twin need not re-run.
- EC-10 [US-4]: single CHECK-N genuinely covering both roles → dual annotation allowed (FR-080).
- EC-11 [US-4]: BOUNCED interplay: derivable invariants + no feasible path + declined marker → BOUNCED (FR-083).

## Runnable Checks

- CHECK-1 [AC-1..7, 13, 16, 18]: `node --test scripts/check-review-convergence.test.js` → exit 0 (extended fixture matrix).
- CHECK-2 [AC-1]: `grep -c 'novel-finding-streak' skills/pipeline/roster-review.md scripts/check-review-convergence.js` → ≥1 each.
- CHECK-3 [AC-5, AC-9]: `grep -q 'novel_finding_strikes' skills/pipeline/roster-review.md && grep -q 'cross_runtime_probe_timeout' skills/pipeline/roster-review.md` → exit 0.
- CHECK-4 [AC-14]: `grep -q 'rounds_audit' skills/pipeline/roster-review.md && grep -q 'rounds_audit' scripts/check-review-convergence.js` → exit 0.
- CHECK-5 [AC-19]: `grep -q 'authentic-success-path' skills/pipeline/roster-spec.md` → exit 0.
- CHECK-6 [AC-16]: `grep -q 'process-incomplete' skills/pipeline/roster-review.md` → exit 0.
- CHECK-7 [scope]: `git diff <base>..HEAD -- skills/pipeline/roster-run.md` → empty (roster-run untouched).
- CHECK-8 [projection]: `bash scripts/sync-harness.sh --check` → exit 0.
- CHECK-9 [all]: `npm test` → exit 0.

## Amendments (v1.1.0 — plan-phase dual-voice review, 2026-07-13)

Nine objections (three blocking) from the plan-phase skeptical voice, plus Voice 1's open
questions. Amendments override the base FRs where they conflict.

- **B-1 (O-1, strike history not reconstructible — blocking):** strikes are journaled, not
  recomputed. The gate computes the strike classification for the **current round only** (from
  findings — same-round status is point-in-time correct at gate time) and reports it; roster-review
  persists it as a `strike: bool` field on the round's `rounds_audit` entry. Past strikes are
  **read from `rounds_audit[].strike`**, never re-derived — so a late ACCEPT cannot retroactively
  erase a recorded strike, the streak is monotonic across gate runs, and FR-076's anti-starvation
  reads the previous entry's flag directly. FR-053/054 amended accordingly. The brief's "zero new
  state" claim was wrong; the new state is one boolean per round in an array that already exists.
- **B-2 (O-2, FR-065/FR-074 contradiction — blocking):** participation precedence, highest first:
  (1) degraded → never runs (breaker overrides everything); (2) round 1 or full-fan-out round →
  healthy runtime runs; (3) delta round → healthy runtime runs iff it owns an OPEN finding.
  FR-065's "every round until first failure" is amended to "every round **on which it is
  selected** until first failure." Full fan-out includes the cross-runtime pass when healthy.
- **B-3 (O-3, reset choreography vs single write — blocking):** "reset on GO" is abolished.
  The persisted GO verdict **retains** the cycle's final `round`, `rounds_audit`, and
  `cross_runtime` values (better for audit anyway); fresh state is **initialized at the first
  round of the next review cycle**. The gate therefore always validates exactly the object that
  is written. `round` increments exactly once per **persisted verdict**, at draft composition
  (`draft.round = prior.round + 1`); re-gating a repaired draft (B-5) does NOT re-increment.
  FR-051/FR-068/FR-077 amended.
- **B-4 (O-4, silent no-op on stale gate scripts):** the gate report gains a `config` echo
  (`{max_rounds, strikes, static}`); §5.5 requires roster-review to verify `config.strikes` is
  present in the report — absent means the installed script predates this feature → treat as
  degraded input, surface to human ("gate script out of date"). The new script also rejects
  unknown flags (exit 2) going forward. The consumer-repo distribution gap itself remains the
  recorded follow-up from PR #49.
- **B-5 (O-5, exit-contract overload + unbounded fix loop):** new exit code **3** =
  "process-incomplete violations only — repair the draft and re-gate; do not route." Exit 1 is
  design causes (possibly mixed); top-level `cause` (new report field, per FR-059 precedence)
  is never `process-incomplete`. The repair loop is bounded: **max 2 attempts**, then surface to
  human. Gate header, §5.5, and tests document 0/1/2/3.
- **B-6 (O-7, false-positive calibration + amplification):** the **streak** escalation (not the
  cap) is human-overridable **once per streak**: the design-not-converging verdict presents at
  the §7 gate with an explicit "override — one more implement round" option; an override is
  recorded in review.json (`streak_override: {round, by: "human"}`) and resets the streak. The
  cap escalation remains non-overridable. This bounds the cost of a false positive at one human
  decision instead of a forced spec re-entry, while keeping the default strikes=2 evidence-backed.
- **B-7 (O-8, A-11 spurious under physical rounds):** A-11 is re-keyed to the physical counter —
  warn when `round` is absent/0 while findings carry `first_seen_round > 0`; the old
  `no_go_round`-based form is retired in the same slice.
- **B-8 (O-9 + Voice-1 Q1/Q2/Q7, legacy + field semantics):** when `round` is absent (legacy
  review.json), the gate **skips strike computation and the audit check entirely** with warnings
  (FR-030 pattern) — the 17 existing fixtures pass unmodified; new behavior activates only when
  `round` is present. Mid-task upgrades stay in legacy mode until the next cycle starts fresh.
  Definitions: `reviewed_sha` = HEAD at the previous round's verdict emission; `fix_sha` = HEAD
  at current draft composition; dirty tree → `fix_sha: null` + `fix_sha_reason` (pass-with-flag;
  null without the reason field is incomplete → violation).
- **B-9 (O-6, prose-only breaker — accepted residual R-4):** the breaker's mechanical teeth are
  limited to the structural warning (FR-069) and the config echo (B-4); probe-once/discard/no-retry
  compliance is prose-level. Accepted: the breaker's primary value is *revoking the mandate to
  retry* that the old rule imposed. Follow-up candidate: `xruntime-exec.sh --probe-log` for a
  deterministic invocation journal (deferred with H-05).

Voice-1 confirmations folded in: spec supersedes the brief's degraded-inconsistency fixture
(FR-069 structural form is correct); `specs/pipeline-loop-convergence.md` is touched only for
the cause-enum cross-reference note; the gate reports a top-level `cause` field.

## Entities

- `Round`: physical per-cycle verdict counter (`round`), incremented every emission, reset on GO — the cohort key for strikes, loop-back detection, and audit entries.
- `Strike`: a physical round ≥ 2 containing ≥1 novel, unresolved, non-ACCEPTED HIGH+ non-scope finding.
- `CircuitBreaker`: per-runtime `cross_runtime.<name>` status object; probe-once, degrade-once, no silent retry.
- `RoundsAudit`: append-only per-round record of reviewer selection (`reviewed_sha`, `fix_sha`, `specialists_run`).
- `AuthenticPathCheck`: a minimal-freeze CHECK-N annotated `(authentic-success-path)` or `(fail-closed-path)`.
