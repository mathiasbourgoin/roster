# Content snapshot guards

**Profile: minimal-freeze**

## Invariants
- CHECK-1 [AC-1] (fail-closed-path): content or index mutations of existing dirty tracked/untracked paths cause both guards to reject success, even when porcelain status is unchanged.
- CHECK-2 [AC-2] (authentic-success-path): actual wrapper and verifyCheck consumer boundaries preserve successful read-only runs and runtime/check exit semantics; snapshots themselves never write Git state.
- CHECK-3 [AC-3] (fail-closed-path): snapshot errors cannot be accepted as verified read-only; NUL-delimited unusual filenames and symlink targets are unambiguous.
- CHECK-4 [AC-4] (proof-integrity): missing wrapper artifacts and unavailable checker prerequisites are infrastructure failures, never assertion-backed red evidence.

## Runnable Checks
Each CHECK invokes `node scripts/content-snapshot-guards.check.js . <scenario>`: standalone assertions return 0 on success, 1 on assertion failure, >=2 on setup error. QA additionally runs the expanded test matrices in the two existing suites.

- CHECK-1: `node scripts/content-snapshot-guards.check.js . mutation`; red-command: `node scripts/content-snapshot-guards.check.js <pre-fix-source-root> mutation`; both original consumers miss dirty tracked content changes (exit 1). The pre-fix source is a disposable HEAD archive, never a modified canonical checkout.
- CHECK-2: `node scripts/content-snapshot-guards.check.js . read-only`; red-command: in a disposable copy force either consumer's successful read-only result to fail, then `node scripts/content-snapshot-guards.check.js <copy> read-only` (exit 1). The check reaches actual wrapper and green verifier success boundaries.
- CHECK-3: `node scripts/content-snapshot-guards.check.js . snapshot-errors`; red-command: run the standalone check against original wrapper code, which silently skips the after snapshot if the repository disappears (exit 1). Odd filename and symlink coverage is supplied by QA matrices.
- CHECK-4: `node scripts/content-snapshot-checker-setup.check.js`; red-command: overlay only this check onto a disposable archive of `efd04a724e75d83082bfd7cda45697085dc5e1da`, then invoke the same command (assertion exit 1). The candidate returns 0; the actual red/green verifier confirmed check blob `6d750ed38ec8a69a8e28adf09f79e0c145916ce8`. The check exercises missing-wrapper and unavailable-tool setup controls without relaxing CHECK-1–3 assertion controls.

## Acceptance Criteria
- AC-1: CHECK-1 passes with tracked, staged/unstaged, untracked and index content changes detected.
- AC-2: CHECK-2 passes at actual consumers with no-write success preserved.
- AC-3: CHECK-3 passes with failures rejected and filenames/types encoded safely.
- AC-4: CHECK-4 passes with missing-wrapper, unavailable-tool and wrapper launch failures classified as infrastructure (exit >=2), while genuine behavioral assertion failures remain exit 1.
