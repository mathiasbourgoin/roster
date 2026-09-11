---
name: review-v2-corrections
type: spec
status: live
feature: Review v2 correctness fixes (finding identity, lifecycle, journal enforcement)
brief: briefs/review-v2-corrections-intake.md
date: 2026-07-13
version: 1.3.0
---

# Spec — Review v2 Corrections

**Profile: minimal-freeze** (Type: fix + Trust boundary: yes — human-overruled at the intake
gate: finding-ledger integrity is a review-evidence surface). Per the minimal-freeze contract:
Invariants + Runnable Checks + paired ACs only; no story ceremony; `min_user_stories`/
`min_gwtscenarios_per_story` do not apply. Evidence base:
`~/dev/bounty-skills/skills-meta/health-2026-07-13-roster-review-v2-followup.md` (3 HIGH,
5 MEDIUM; two claims independently verified upstream before this freeze).

## Invariants

- **INV-1 (no silent finding loss):** two findings sharing a v1 fingerprint but differing in
  summary (or any present v2 semantic field) are NEVER exact-merged — they become probable
  duplicates for owner adjudication. A v1 collision alone never destroys evidence. A modern
  finding whose `fid` misses MUST NOT fall back to a legacy v1-only match; a legacy row is
  matched only after its summary can reconstruct the same semantic `fid`.
- **INV-2 (no silent regression suppression):** a re-report matching a ledger entry is reduced to
  a reobservation ONLY when that entry's linked ratchet check exists and passed on the current
  tree (per the gate's latest report). Otherwise the entry is REOPENED (status → OPEN, prior
  status/check metadata preserved) or routed to owner adjudication. A same-round-resolved,
  no-check finding that reappears is a regression, never metadata. The full re-observed finding
  body is always preserved.
- **INV-3 (two-event lifecycle, single wording):** the physical `round` lifecycle is stated
  everywhere as: (1) the persisted GO verdict retains cycle-final state; (2) the next review
  cycle initializes round 1, full fan-out, fresh `rounds_audit`, fresh probe. No "persists across
  the whole task" / bare "no reset-on-GO" shorthand anywhere in skill prose.
- **INV-4 (journal is an enforcement input):** the degraded-refusal decision reads BOTH the
  latest matching journal entry (task/runtime/digest) AND verdict state; a malformed verdict is
  explicit degraded-input, never silent no-state. A malformed journal line also fails closed
  because its runtime/digest cannot be authenticated. Crash-before-persist cannot cause a repeat
  probe of an unchanged degraded runtime.
- **INV-5 (no untrusted identity in the ledger):** cross-runtime findings are canonically
  re-fingerprinted and deduplicated within the augment-only array before verdict composition;
  model-provided fingerprints never survive into anything FR-015 can mirror.
- **INV-6 (transport cannot masquerade as runtime health):** prompts travel via file/stdin;
  that file-backed transport MUST continue through the wrapper/runtime subprocess boundary;
  spawn-layer failures (E2BIG, ENOENT) are classified as `spawn-error` (degraded, distinct
  reason), never as `empty-output`. The journal records the prompt digest, never the prompt.
- **INV-7 (every breaker state is schema-valid):** the explicit human-skip decision has a
  first-class shape (reason, actor, digest, round, ts) accepted by the verdict schema and
  documented in schema/review-json-schema.md.
- **INV-8 (override routes exactly once):** roster-run, seeing `design-not-converging` with a
  valid current-round `streak_override`, routes to `/roster-implement` exactly once; round-cap
  escalation remains non-overridable; the LEDGER_SCHEMA block stays byte-identical.
- **INV-9 (review degradation carries into QA):** before QA invokes a second runtime, it runs a
  provider-free availability check. A matching degraded runtime/version in the persisted GO review
  verdict refuses the QA attempt across the standard read-only→workspace-write phase transition;
  a changed runtime/version or explicit human retry may proceed.
  The lookup itself never invokes the provider or appends an invocation journal row.

## Runnable Checks

(Red-command convention: exit 0 = passes, 1 = assertion fired, ≥2 = error.)

- CHECK-1 [AC-1] (fail-closed-path): `node --test scripts/review-normalize-mutations.test.js`
  → exit 0. Contains seven adversarial mutations: (a) two distinct security findings on one
  line — asserting BOTH survive as probable duplicates; (b) a same-round-resolved no-check
  finding re-reported next round — asserting it is REOPENED, not reobserved; (c) a legacy v1
  collision cannot absorb a distinct modern finding; (d) a same-summary legacy row migrates to
  semantic `fid` without duplicate noise; (e) same-summary/different-v2 findings remain distinct;
  (f) a stale or forged fid cannot override direct semantic comparison; (g) an incomplete
  fingerprint-only row cannot suppress. The defect mutations are red against the pre-fix
  normalizer (red-verifiable per the ratchet).
- CHECK-2 [AC-2] (authentic-success-path): `node --test scripts/review-lifecycle.test.js` →
  exit 0. Drives NO-GO → GO → QA-return → resumed review over real artifacts through the real
  helper + normalizer + gate binaries end-to-end (XRUNTIME_BIN stubs, stubbed digest probe, short
  timeouts — no model runtime), asserting fresh-cycle behavior (round 1 via
  scripts/lib/review-lifecycle.js, fresh probe, gate acceptance of the fresh draft and rejection
  of a wrongly-continued one) at the resumed boundary. (E-6)
- CHECK-3 [AC-3]: `node --test scripts/xruntime-review.test.js` → exit 0 incl. new fixtures:
  journal-only degraded state (verdict absent) → refusal; malformed verdict → degraded-input;
  end-to-end `--prompt-file` transport with a prompt above typical `ARG_MAX`; bounded runtime
  argv; oversized-prompt spawn-error classification; schema-valid skip shape.
- CHECK-4 [AC-4]: `! grep -qE 'persists across the whole task|no reset-on-GO' skills/pipeline/roster-review.md && grep -q 'two-event' skills/pipeline/roster-review.md` → exit 0. (E-9)
- CHECK-5 [AC-5]: `node --test scripts/review-normalize.test.js` → exit 0 incl. cross-runtime
  canonicalization fixtures (arbitrary input fingerprint → canonical v1 in the augment array).
- CHECK-6 [AC-6]: roster-run streak-override row present ABOVE the design-not-converging → spec
  row (grep -n ordering) AND `node scripts/check-pipeline-install.js` → exit 0 (LEDGER_SCHEMA
  byte-identity).
- CHECK-7 [AC-7]: BOM fixture in `scripts/check-skill-structure.test.ts` → the two-word
  BOM-prefixed skill counts 2; assembled-projection metric reported in check output.
- CHECK-8 [all]: `npm test` → exit 0; `bash scripts/sync-harness.sh --check` → exit 0; all
  CHECK-N greps from all three convergence-family specs remain green.
- CHECK-9 [AC-9]: `node --test scripts/xruntime-review.test.js` → exit 0 incl. a persisted GO
  verdict with matching degraded runtime/version returning `skipped-degraded` without wrapper
  invocation even when review was read-only and QA is workspace-write, and a changed digest
  returning `available`.

## Acceptance Criteria

- AC-1 ↔ CHECK-1: distinct-vuln collision preserved; regression reopened (INV-1, INV-2).
- AC-2 ↔ CHECK-2: fresh-cycle behavior at QA-return proven end-to-end (INV-3).
- AC-3 ↔ CHECK-3: journal-enforced refusal, malformed-verdict degradation, file transport,
  spawn-error class, skip shape (INV-4, INV-6, INV-7).
- AC-4 ↔ CHECK-4: lifecycle wording unified (INV-3).
- AC-5 ↔ CHECK-5: canonical identity in the augment array (INV-5).
- AC-6 ↔ CHECK-6: override routing without ledger drift (INV-8).
- AC-7 ↔ CHECK-7: counter BOM + assembled metric.
- AC-8 ↔ CHECK-8: whole-system green, token survival intact.
- AC-9 ↔ CHECK-9: QA consults the review breaker before any second-runtime attempt and does not
  repay an unchanged degraded configuration (INV-9).

## Amendments (v1.1.0 — plan-phase dual-voice review, 2026-07-13)

Ten objections; O-1/O-2 were scope-breaking. Invariants unchanged (human-gated); mechanisms
amended. Scope expansion recorded: `scripts/check-review-convergence.js` +
`scripts/lib/review-convergence-rules.js` enter Relevant Files; a persisted gate-report artifact
and a `cycle` field are added. roster-run stays row-level BECAUSE the gate absorbs the logic.

- **E-1 (O-1, override dead-on-arrival):** the GATE becomes override-aware: in static and full
  modes, a `streak_override` with `round == review.round` and `by == "human"` suppresses the
  novel-finding-streak violation (round-cap never suppressed). `computeStrikeMap` respects the
  journaled `strike:false` for an overridden round instead of recomputing it. roster-run's new
  row then works as a row. "Exactly once" = current-round validity (stale after the next verdict
  increments `round`); double-resume before a new verdict routes twice to implement — idempotent,
  noted.
- **E-2 (O-2, unknowable "current tree") — AMENDED to match the implemented mechanism
  (implementation review, 2026-07-13):** roster-review PERSISTS the gate report to
  `briefs/<task>-gate-report.json` beside the verdict (it already has the stdout JSON). There is
  NO separate `--verify-carried` flag or flagged-count-scoped verification pass: gate full mode's
  EXISTING `runRedGreenVerification` already green-runs every finding carrying a `.check`,
  regardless of status — this was true before review-v2-corrections and is unchanged; it is a
  superset of "carried RESOLVED entries the draft flags as pending reobservation," bounded by the
  total count of checks in `findings`, not by how many the normalizer flagged `pending-check` this
  round. The skill's normalizer-side disposition (`dispositions.pending_check[]`, keyed `(check,
  fid)`) reads the PRIOR round's persisted report (absent on round 1 — fails closed to `reopen` per
  the Resolution note below); it then resolves any still-`pending-check` entries AFTER this round's
  gate run, from THIS round's freshly persisted report. Reopen mutations discovered at that point
  trigger exactly one bounded re-gate (exit-3 repair pattern, not open-ended). Fail-closed when the
  check is absent from the report.
- **E-3 (O-3, fingerprint uniqueness):** findings gain `fid` = `fingerprint + "#" + sha8(normalized
  summary)` — the addressable identity for reobservation matching, probable-duplicate records,
  and gate `checks[]` keying (`(check, fid)` with fingerprint fallback for legacy). v1
  `fingerprint` unchanged for compatibility. Schema gains optional `fid`.
- **E-4 (O-4, reopen vs ratchet/strikes):** reopen = `status → OPEN`, `resolved_round → null`,
  new optional schema fields `reopened_from_round` + `reopened_at_round`. Re-resolution at round
  m stamps `resolved_round = m > first_seen_round` → the ratchet demands a check (hole closed).
  Strike definition amended in the gate: a round strikes when it has ≥1 qualifying novel HIGH+
  finding OR ≥1 HIGH+ entry with `reopened_at_round == round` — regression-heavy cycles are no
  longer invisible to two-strike escalation.
  **Clarification (implementation review, 2026-07-13):** the reopened-strike test carries the SAME
  two guards as the novel-strike test — `status !== "ACCEPTED"` and `category !== "scope"`. The
  ACCEPT-permanence contract (a human ACCEPT "permanently waives the invariant") wins over a
  mechanical reopen: an ACCEPTED finding must never strike, reopened or not. Scope-category
  findings are excluded per EC-4 for the same reason they never strike when novel.
- **E-5 (O-5, cycle ambiguity):** review.json envelope gains `cycle` (int, incremented at each
  fresh-cycle initialization, retained on GO); journal entries record it; refusal matching keys on
  task/cycle/runtime/digest. Crash-before-persist (same cycle, journal degraded) → refuse; prior
  cycle → re-probe. Deterministic separation.
- **E-6 (O-6, CHECK-2 realism):** extract `scripts/lib/review-lifecycle.js` (`deriveRoundState`,
  fresh-cycle initialization) as the executable witness; skill prose points to it. CHECK-2 asserts
  lifecycle via that module + helper probe behavior + gate acceptance, with XRUNTIME_BIN stubs and
  short timeouts — no model runtime, no 10s version probes in CI (digest probe stubbed). The
  untestable "fan-out expectation recorded" clause is prose-and-reviewer, dropped from the test.
- **E-7 (O-7, augment-only wording):** contract rewritten in roster-review.md +
  review-json-schema.md: cross-runtime entries are canonicalized AT INTAKE (normalize time,
  before recording) and immutable THEREAFTER. "Never rewritten" applies post-recording.
- **E-8 (O-8, malformed verdict):** helper emits `{status: "blocked", reason:
  "malformed-verdict"}` and exits 2; roster-review's consumption table gains the row (surface to
  human; repair = fix or remove the corrupt verdict). The old malformed→null rationale is
  REVERSED deliberately (unverifiable round state = fail closed, same argument as gate exit 2) —
  documented at the site.
- **E-9 (O-9, CHECK-4 form):** CHECK-4 becomes `! grep -qE 'persists across the whole task|no reset-on-GO' skills/pipeline/roster-review.md && grep -q 'two-event' skills/pipeline/roster-review.md`;
  the Rules-line contrast at roster-review.md:445 is rewritten in two-event vocabulary too.
- **E-10 (O-10, skip shape):** the skip entry adopts the existing key family:
  `{status: "skipped-human", reason, config_digest, round, ts, actor}` (config_digest, not
  digest). `shouldRefuseDegraded` matches only `status: "degraded"` — skip entries can never
  arm the breaker. INV-7's "verdict schema" = the prose contract in review-json-schema.md plus
  the composition tests (the machine schema stays finding-level).

## Resolution of the intake open question

Resolved-reobservation suppression consumes the **gate's latest checks[] report** (single-executor
principle — the normalizer stays execution-free, read-only). When no gate report exists for the
entry's check, INV-2's reopen/adjudicate branch applies (fail-closed).

## Amendments (v1.2.0 — health follow-up fixes, 2026-07-13)

- **E-11 (legacy identity migration):** E-3's fingerprint fallback is narrowed. A ledger row
  without `fid` but with `fingerprint` + `summary` is indexed under the reconstructed semantic
  `fid`. A modern finding with `fid` never falls back to raw v1 identity after a miss, and a
  candidate match is verified against normalized summary plus any v2 semantic fields. Rows too
  incomplete to reconstruct identity remain carried forward but cannot absorb a new finding.
  This intentionally prefers a visible one-time duplicate over silent finding suppression.
- **E-12 (end-to-end bounded prompt transport):** `xruntime-review.js` writes its validated prompt
  to a mode-0600 temporary file and passes only that path to `xruntime-exec.sh --prompt-file=<path>`.
  The wrapper streams the file to Codex/OpenCode stdin with EOF and retains its original
  positional-prompt interface. This supersedes review-skill-slimming FR-086's original
  implementation-window byte-freeze while preserving roster-qa compatibility.
- **E-13 (shared review/QA availability breaker):** `xruntime-review.js --phase qa
  --check-availability` compares both standard sandbox digests for the current runtime/version with
  the persisted GO review's degraded state before QA invokes the raw wrapper. Matching degradation returns
  `skipped-degraded` without a provider call or journal append; changed configuration returns
  `available`; `--human-retry` remains the only manual override. Roster-QA requires bundle 1.2.0
  and fails closed when the helper is missing or the review verdict is unreadable.
- **E-14 (corrupt journal fail-closed):** `readLatestJournalEntry` returns an explicit malformed
  sentinel on the first unparsable line instead of skipping it. The helper emits
  `{status:"blocked", reason:"malformed-journal"}` and never invokes the provider; repair or an
  explicit human action is required before retrying.
