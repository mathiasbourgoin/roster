# Reopen findings with failed green checks

**Profile: minimal-freeze**

## Invariants

- A matching report's explicit `greenFailed: true` or `weakened: true` must reopen a re-observed RESOLVED finding, regardless of `red_verified: true`; preserve the full finding and reopen provenance. The gate uses `weakened: true, greenFailed: false` when a changed, previously verified check fails green. An inconclusive gate result has no red proof and must also reopen (CHECK-1, AC-1).
- Matching verified reports with `greenFailed: false` or an absent legacy field remain reobservations. A failing report for another check or identity cannot reopen this finding; missing coverage remains pending-check. Existing no-check and absent-report behavior remains fail-closed (CHECK-2, AC-2).

## Runnable Checks

- **CHECK-1 [AC-1] (fail-closed-path):** `node scripts/review-normalize-green-check.js`. The standalone checker uses the real `normalize()` boundary; exits 0 on pass, 1 only for assertion failure, and 2 for load/setup errors. Red command: run the same checker against the pre-fix `normalize-rules.js` (overlay only that production file from the base revision).
- **CHECK-2 [AC-2] (authentic-success-path):** `node scripts/review-normalize-green-check.js`. The same checker also requires verified successful green and legacy reports to remain reobservations. Red command: temporarily mutate the disposition return to unconditionally reopen matching RESOLVED entries; verified report assertions must fail with exit 1. Full QA additionally runs `node --test scripts/review-normalize.test.js scripts/review-normalize-mutations.test.js scripts/review-normalize-trace.test.js` for CLI, identity, pending-check and provenance controls.

## Acceptance Criteria

- **AC-1:** CHECK-1 fails against the pre-fix source and passes with the patch for both semantic fid and legacy fingerprint report keys; reopened entries carry current body and round provenance.
- **AC-2:** CHECK-2 passes with the patch and rejects the unconditional-reopen mutation; verified successful/legacy reports, unmatched identities and existing no-check/report contracts remain correct.
