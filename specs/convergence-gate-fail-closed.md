---
name: convergence-gate-fail-closed
type: spec
status: VALIDATED
feature: Fail-closed hardening of the review-convergence gate (three CONFIRMED-HIGH bypasses)
brief: briefs/convergence-gate-fail-closed-intake.md
date: 2026-07-14
version: 1.0.0
---

# Spec — Convergence Gate Fail-Closed (minimal-freeze)

> Validation (standing user delegation, autonomous batch 2026-07-14): invariants/checks reviewed; all three bypasses were reproduced at HEAD by intake. Binding refinement from spec review — FIX-B: classify a green-phase failure as `weakened` only on an actual `recordedBlob !== currentBlob` mismatch, NOT on `recordedBlob !== null` (otherwise a legitimate red-reproduced failure is mislabeled). FIX-B fast-path is an optimization; correctness holds even if roster-review does not persist `red_verified` back onto the finding (CHECK-2 pins the persisted-true case).

**Profile: minimal-freeze** (Type: `fix` + Trust boundary: `yes` — the review-convergence gate is
a fail-closed security control; each defect lets an unsafe verdict slip past a block that was meant
to stop it). Per the minimal-freeze contract: Invariants + Runnable Checks + paired ACs only; no
story ceremony; `min_user_stories`/`min_gwtscenarios_per_story` do not apply. Requirements are
numbered `CGF-N` (fresh range — the existing specs' `FR-` space runs to FR-286 and `LSE-*` is
owned by leak-scanner-entropy; neither is reused).

## Context

The codex cross-runtime re-run pass (`briefs/xruntime-rerun-pass-triage.md`) found three
CONFIRMED-HIGH gate-integrity defects where the gate — a fail-closed control — fails **open**. All
three reproduce at current HEAD (verified at intake):

- **FIX-A — non-array `review.findings` gates as zero findings.** `deriveGateRoundInputs`
  (`scripts/check-review-convergence.js:199`) does
  `const findings = Array.isArray(review.findings) ? review.findings : []`. A verdict whose
  `findings` is a string/object (corrupt, hand-edited, truncated) is silently treated as an empty
  finding set and the gate exits 0. Reproduced: a `findings` **object** carrying a HIGH
  `check_encodable:false` finding exits 0; the identical finding in **array** form exits 1.
- **FIX-B — matching `check_blob` counts as red proof without `red_verified`.** In
  `scripts/lib/redgreen-scratch.js`, `verifyCheck` (line 61) computes
  `needsVerification = recordedBlob === null || recordedBlob !== currentBlob`; on a blob match it
  calls `reverifyGreenOnly` (line 69), which returns `red_verified: true` **unconditionally** and
  runs only the green half — the red phase never runs and the persisted finding's own
  `red_verified` field is never consulted. Reproduced: `verifyCheck` returns `{red_verified:true}`
  for a check file that always `exit(0)` (never red), purely because `recordedBlob === currentBlob`.
- **FIX-C — statusless HIGH bypasses the OPEN-HIGH GO block.** `status` is not in `required` in
  `schema/review-finding.schema.json`, and `canonicalizeFindings`
  (`scripts/review-normalize.js:170`) touches only `fingerprint`/`fingerprint_v2`/`fid` — it never
  defaults `status`. A HIGH finding with no `status` is formally neither OPEN nor RESOLVED, so it
  slides past the prose OPEN-HIGH GO block. Reproduced: a statusless HIGH survives the normalizer
  with `status` still absent, and schema `required` excludes `status`.

**Binding OQ rulings (from the VALIDATED intake brief — single source of truth):**

- **OQ1 (FIX-C mechanism):** the normalizer **defaults** `status` to `"OPEN"`; the schema stays
  permissive — `status` is **NOT** added to `required` (would reject legacy fixtures / cross-runtime
  findings that omit it). INV-5 (of review-v2-corrections) is preserved because the default is
  applied inside `canonicalizeFindings`, shared by both the primary and cross-runtime arrays.
- **OQ2 (FIX-A absent-key):** an **absent** `findings` key defaults to `[]` (legacy-safe); only a
  **present, non-array** value is the new degraded case → `fail(2)`.
- **OQ3 (lib-split sequencing):** this task goes FIRST and edits `scripts/lib/redgreen-scratch.js`
  in place at its current flat path. The concurrent `scripts-lib-split` rebases onto it later. Do
  NOT move files here.
- **OQ4 (FIX-B `red_verified` source):** the source of truth is the finding's own persisted
  `red_verified` field on `review.json`, forwarded by `verifyFinding`; no separate gate-report
  lookup in v1.

## Invariants

The frozen properties this task MUST NOT violate. INV-A..INV-C encode the three fixes; INV-D..INV-G
freeze the surrounding contracts the intake declared load-bearing. Each invariant carries its
runnable check(s) and annotations inline.

- **INV-A (fail-closed on degraded findings):** a `review.findings` value that is **present but not
  an array** is degraded input → `fail(2)` (same class as the existing "review.json must be a JSON
  object" treatment in `readReviewJson`), NEVER exit 0/1/3. An **absent** `findings` key still
  defaults to `[]` and behaves as today (legacy verdicts). `CHECK-1` (fail-closed-path).
- **INV-B (no red proof without a proven red run):** the `check_blob`-match fast path in
  `verifyCheck` may skip the scratch red run **only** when the persisted finding's `red_verified`
  is strictly `true`. When the blob matches but `red_verified !== true`, `verifyCheck` MUST fall
  through to `verifyViaScratch` and run red. A forged/copied `check_blob`, or a check that was never
  actually red, is thereby caught as `vacuous`/inconclusive rather than accepted. Strengthens the
  spirit of review-v2-corrections INV-2 (no silent regression suppression). `CHECK-2`
  (authentic-success-path).
- **INV-C (no statusless HIGH bypass):** a finding reaching the gate with no `status` MUST be
  treated as OPEN (blocking), never silently non-blocking. `canonicalizeFindings` defaults absent
  `status` to `"OPEN"` for both the primary and cross-runtime arrays; the schema keeps `status`
  optional. `CHECK-3` (fail-closed-path) + `CHECK-4`.
- **INV-D (exit-code contract unchanged):** the gate's exit contract — `0` pass / `1`
  design-violation / `2` degraded-input / `3` process-incomplete-only — and its precedence
  (inconclusive 2 > design 1 > process-incomplete 3 > pass 0) MUST NOT shift. FIX-A's new failure
  maps to `2` (degraded), not `1` and not `3`. `CHECK-5`.
- **INV-E (review-v2-corrections INV-1..8 non-regression):** none of `specs/review-v2-corrections.md`
  INV-1..INV-8 is weakened. In particular INV-2 (regression suppression) is strengthened by INV-B,
  and INV-5 (canonical identity shared by both arrays) is preserved by applying the FIX-C default
  inside the shared `canonicalizeFindings`. `CHECK-6`.
- **INV-F (read-only gate guarantee, FR-022 of pipeline-loop-convergence):** the gate MUST NOT
  modify any repo file or `.git` state; pre-fix trees are extracted via `git archive | tar -x` into
  a scratch dir, never `git worktree add`. FIX-B changes only **whether** the scratch red run is
  *skipped*; the extraction/jail mechanism is untouched. `CHECK-2` + `CHECK-6`.
- **INV-G (red-before-green fixtures):** each of FIX-A/B/C ships a fixture that reproduces its
  specific bypass against pre-fix HEAD (RED) and turns GREEN with the fix — no fix lands without a
  test that would have caught it. `CHECK-1` (A), `CHECK-2` (B), `CHECK-3`/`CHECK-4` (C).

## Requirements (CGF-1..CGF-11)

Fresh, non-colliding range. Each is normative and maps to at least one CHECK-N.

#### FIX-A — degraded findings (INV-A, INV-D)
- **CGF-1** [INV-A]: `deriveGateRoundInputs` MUST call `fail(2)` when `review` has a `findings` key
  whose value is not an array. [CHECK-1]
- **CGF-2** [INV-A]: `deriveGateRoundInputs` MUST default `findings` to `[]` — behaving exactly as
  today — when the `findings` key is absent. [CHECK-1]

#### FIX-B — red-verified fast path (INV-B, INV-F)
- **CGF-3** [INV-B]: `verifyCheck` MUST NOT return `red_verified: true` via the blob-match fast path
  (`reverifyGreenOnly`) unless the persisted `red_verified` passed in is strictly `true`. [CHECK-2]
- **CGF-4** [INV-B]: `verifyFinding` (`scripts/check-review-convergence.js:305`) MUST forward
  `f.red_verified` into the `verifyCheck` call. [CHECK-2]
- **CGF-5** [INV-B]: when `recordedBlob === currentBlob` but the persisted `red_verified` is not
  strictly `true`, `verifyCheck` MUST fall through to `verifyViaScratch` (run the scratch red half),
  not short-circuit green-only. [CHECK-2]

#### FIX-C — statusless HIGH (INV-C, INV-E)
- **CGF-6** [INV-C]: `canonicalizeFindings` MUST set `status` to `"OPEN"` when the input finding has
  no `status`, and MUST NOT overwrite a present `status` (`OPEN`/`RESOLVED`/`ACCEPTED`). [CHECK-3]
- **CGF-7** [INV-C]: `schema/review-finding.schema.json` MUST keep `status` OUT of `required`;
  a statusless finding MUST still validate. [CHECK-4]

#### Cross-cutting freeze (INV-D..INV-G)
- **CGF-8** [INV-D]: the gate exit-code contract `0/1/2/3` and its precedence MUST NOT change.
  [CHECK-5]
- **CGF-9** [INV-F]: the gate MUST NOT mutate any repo file or `.git` state (FR-022). [CHECK-2,
  CHECK-6]
- **CGF-10** [INV-E]: none of review-v2-corrections INV-1..8 MUST be weakened by these three fixes.
  [CHECK-6]
- **CGF-11** [INV-G]: each fix MUST ship a red fixture reproducing its bypass at pre-fix HEAD that
  turns green with the fix. [CHECK-1, CHECK-2, CHECK-3, CHECK-4]

## Runnable Checks

(Red-command exit convention, A-6: exit `0` = passes, `1` = assertion fired, `≥2` = error. `node
--test` is accepted here per the review-v2-corrections / leak-scanner-entropy precedent — the
fixtures themselves are plain assertions and the suite exits 0/1 cleanly. NOTE: this is distinct
from the gate script's OWN exit contract, where `2` = degraded input, exercised *inside* the
fixtures.)

- **CHECK-1** [AC-1] (fail-closed-path): `node --test scripts/check-review-convergence.test.js` →
  exit 0, where the suite MUST contain a FIX-A fixture built with the real `makeRepo()`/
  `writeReview()` harness: (a) a verdict whose `findings` is an **object** carrying one HIGH
  `check_encodable:false` finding → gate exits **2** (degraded); (b) the **same** finding in array
  form → gate exits **1** (unencodable-finding); (c) a verdict with the `findings` key **absent** →
  gate exits normally (no degraded-input failure from a missing key). Fixtures (a) are RED at
  pre-fix HEAD (gate exits 0) and GREEN after (INV-A, INV-G, CGF-1/CGF-2).
- **CHECK-2** [AC-2] (authentic-success-path): `node --test scripts/check-review-convergence.test.js`
  → exit 0, driving the gate binary end-to-end against a real git repo (`makeRepo()`/`commitFile()`,
  real `git archive` extraction, real `node <check>` execution): (a) a finding with a
  committed check that always `exit(0)` (never red), a `check_blob` matching the current tree, and
  `red_verified` absent/false → the gate now runs the scratch red, detects **vacuous** and exits 1
  (RED at pre-fix HEAD: gate exits 0, treating the blob match as proof); (b) a finding whose
  persisted `red_verified === true` with a matching `check_blob` → fast path taken, green re-run
  only, exit 0 (optimization of an already-proven red still works). Reaches the real consumer
  boundary (INV-B, INV-F, INV-G, CGF-3/CGF-4/CGF-5).
- **CHECK-3** [AC-3] (fail-closed-path): `node --test scripts/review-normalize.test.js` → exit 0,
  containing a fixture where a NEW HIGH finding with no `status` field is passed through
  `normalize()` and the emitted finding carries `status: "OPEN"`; a finding with an explicit
  `status: "RESOLVED"`/`"ACCEPTED"` is NOT rewritten. RED at pre-fix HEAD (status still absent
  after normalize) (INV-C, INV-G, CGF-6).
- **CHECK-4** [AC-4]: `node --test scripts/review-finding-schema.test.js` → exit 0, containing a
  fixture asserting (a) a finding object omitting `status` validates against
  `schema/review-finding.schema.json`, and (b) `status` is absent from the schema's `required`
  array. Guards against a regression that would tighten the schema and break legacy fixtures
  (INV-C, CGF-7).
- **CHECK-5** [AC-5]: the existing exit-code assertions in
  `scripts/check-review-convergence.test.js` (clean pass → 0; design violation → 1; degraded input
  → 2; process-incomplete-only → 3; and precedence) remain green. `node --test
  scripts/check-review-convergence.test.js` → exit 0 covers them alongside CHECK-1/CHECK-2
  (INV-D, CGF-8).
- **CHECK-6** [AC-6]: whole-system green / CI parity: `npm run build:ts && npm test` → exit 0 —
  the full suite including the three fixture homes plus every existing convergence-family and
  review-v2 test (INV-E, INV-F, CGF-9/CGF-10).

## Acceptance Criteria

- **AC-1 ↔ CHECK-1:** present-but-non-array `findings` fails closed (exit 2); array form still
  exits 1; absent key still legacy-safe (INV-A, CGF-1/CGF-2).
- **AC-2 ↔ CHECK-2:** a blob match is not accepted as red proof without persisted
  `red_verified === true`; a genuinely never-red check is caught as vacuous end-to-end; the
  already-proven fast path still works and the gate mutates nothing (INV-B, INV-F, CGF-3/4/5).
- **AC-3 ↔ CHECK-3:** a statusless HIGH is defaulted to OPEN by the normalizer; present statuses
  are untouched (INV-C, CGF-6).
- **AC-4 ↔ CHECK-4:** the schema keeps `status` optional; a statusless finding still validates
  (INV-C, CGF-7).
- **AC-5 ↔ CHECK-5:** the gate exit-code contract and precedence are unchanged (INV-D, CGF-8).
- **AC-6 ↔ CHECK-6:** full test chain green; INV-1..8 non-regression and read-only guarantee hold
  (INV-E, INV-F, CGF-9/CGF-10).

## Defects found in the fixes as specified

Two issues surfaced while grounding the fixes against the code. Neither breaks fail-closed
correctness; both are worth pinning at planning.

1. **FIX-B — `weakened`/`green-failure` mislabel on the newly-routed blob-match fall-through
   (minor, cosmetic).** After FIX-B, a finding whose `check_blob` **matches** the current tree but
   whose persisted `red_verified` is not `true` is routed into `verifyViaScratch`
   (`redgreen-scratch.js:77`). There, `wasPreviouslyVerified = recordedBlob !== null` is `true`
   because the blob *matched* — so a green failure is reported as `weakened`, which
   `buildRedGreenViolations` renders as *"check_blob mismatch and re-verification could not
   reproduce red (FR-038)"*. In this path there was **no** blob mismatch and red **did** reproduce,
   so both clauses of the message are false. The violation is still raised (exit 1, fail-closed —
   correct direction), only mislabeled. `wasPreviouslyVerified` conflates "has a recorded blob"
   with "was previously green-verified"; FIX-B newly exercises that conflation. Recommendation:
   base the `weakened` vs `green-failure` classification on an actual `recordedBlob !== currentBlob`
   mismatch (or thread `red_verified` into `verifyViaScratch`), not on `recordedBlob !== null`
   alone. Not blocking; note it so the implementer either fixes the label or documents it.

2. **FIX-B — the fast-path optimization is only effective if `red_verified` is persisted back onto
   the finding (dependency, not a correctness hole).** OQ4 fixes the source of truth as the
   finding's own `red_verified` field on `review.json`. `verifyFinding` builds a `checkEntry`
   stamping `red_verified` from the run result, but whether roster-review then merges that value
   back onto the **finding object** (vs only into the gate report's `checks[]`) is roster-review
   skill behavior, out of scope for these three files. If it is NOT persisted onto the finding, the
   fast path never triggers and every re-run falls through to a full scratch red run — correctness
   preserved (fail-closed), performance lost. This is why CHECK-2 asserts the fast path explicitly
   with a finding carrying `red_verified: true`: it pins the optimization as load-bearing so a
   silent regression to "always re-run" is caught. No code change to the three files; flag the
   roster-review persistence dependency at planning.

FIX-A and FIX-C have no defects as specified: FIX-A's `hasOwnProperty` + `Array.isArray` split
cleanly separates absent (→ `[]`) from present-non-array (→ `fail(2)`); FIX-C's default in
`canonicalizeFindings` runs AFTER schema validation (statusless input is accepted then defaulted,
never rejected) and does not affect `fid`/`fingerprint` identity (both are `status`-independent).

## Entities

- `deriveGateRoundInputs`: the gate's single-file input derivation
  (`check-review-convergence.js`) — where FIX-A's non-array guard lives.
- `verifyCheck` / `reverifyGreenOnly` / `verifyViaScratch`: the red-before-green primitives in
  `scripts/lib/redgreen-scratch.js` — where FIX-B's fast-path guard lives.
- `canonicalizeFindings`: the normalizer's per-finding canonicalizer
  (`scripts/review-normalize.js`), shared by primary + cross-runtime arrays — where FIX-C's
  `status` default lives.
- `red_verified`: a finding's persisted proof that its ratchet check was observed red at least
  once; the fast path's precondition (OQ4).
