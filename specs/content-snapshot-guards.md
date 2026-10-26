# Content snapshot guards

**Profile: minimal-freeze**

## Invariants
- CHECK-1 [AC-1] (fail-closed-path): content or index mutations of existing dirty tracked/untracked paths cause both guards to reject success, even when porcelain status is unchanged.
- CHECK-2 [AC-2] (authentic-success-path): actual wrapper and verifyCheck consumer boundaries preserve successful read-only runs and runtime/check exit semantics; snapshots themselves never write Git state.
- CHECK-3 [AC-3] (fail-closed-path): snapshot errors cannot be accepted as verified read-only; NUL-delimited unusual filenames and symlink targets are unambiguous.

## Runnable Checks
Each CHECK invokes `node scripts/content-snapshot-guards.check.js . <scenario>`: standalone assertions return 0 on success, 1 on assertion failure, >=2 on setup error. QA additionally runs the expanded test matrices in the two existing suites.

- CHECK-1: `node scripts/content-snapshot-guards.check.js . mutation`; red-command: `node scripts/content-snapshot-guards.check.js <pre-fix-source-root> mutation`; both original consumers miss dirty tracked content changes (exit 1). The pre-fix source is a disposable HEAD archive, never a modified canonical checkout.
- CHECK-2: `node scripts/content-snapshot-guards.check.js . read-only`; red-command: in a disposable copy force either consumer's successful read-only result to fail, then `node scripts/content-snapshot-guards.check.js <copy> read-only` (exit 1). The check reaches actual wrapper and green verifier success boundaries.
- CHECK-3: `node scripts/content-snapshot-guards.check.js . snapshot-errors`; red-command: run the standalone check against original wrapper code, which silently skips the after snapshot if the repository disappears (exit 1). Odd filename and symlink coverage is supplied by QA matrices.

## Acceptance Criteria
- AC-1: CHECK-1 passes with tracked, staged/unstaged, untracked and index content changes detected.
- AC-2: CHECK-2 passes at actual consumers with no-write success preserved.
- AC-3: CHECK-3 passes with failures rejected and filenames/types encoded safely.
