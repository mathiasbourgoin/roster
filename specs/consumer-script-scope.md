# Portable review-tool module scope

**Profile: minimal-freeze**
**Status: VALIDATED**

## Invariants

- FR-001: Portable entrypoints use deterministic generated .cjs counterparts while canonical/legacy .js paths remain; only known managed relative require references change, exports/algorithms stay unchanged. Authentic consumer+tool execution is CHECK-1.
- FR-002: Installing new tools never adds scripts/package.json or rewrites a consumer package/source; native TypeScript/ESM/CommonJS behavior is preserved (CHECK-1).
- FR-003: Closure generation, static resolution and every shipped invocation reference remain complete and source-bound (CHECK-2/CHECK-4).
- FR-004: Existing checksum/collision/shared-file/atomic staging/upgrade/removal protections remain; an already-adopted shared package scope is not guessed away (CHECK-3).
- FR-005: No runtime algorithm/provider/consumer renaming or new framework is introduced; existing regression gates remain required (CHECK-5).

## Runnable Checks

- CHECK-1 [AC-1] (authentic-success-path): `node --test --test-name-pattern="native TypeScript consumer" scripts/review-bundle-install.test.js` executes a real native typed-export consumer before/after the actual installer and invokes installed tools. Add the desired assertion to old source first: its real runtime after-install1 supplies the named RED, not a missingAPI error.
- CHECK-2 [AC-2]: `node --test scripts/review-bundle.test.js` verifies generated closure and manifest references, including explicit .cjs traversal.
- CHECK-3 [AC-3] (fail-closed-path): `node --test scripts/review-bundle-install.test.js` covers actual lifecycle, bad/partial source, collisions/custom helpers, shared files and unchanged mixed consumers.
- CHECK-4 [AC-4]: `bash scripts/sync-harness.sh --check` checks canonical/projection convergence; updated instructions must invoke distributed .cjs paths.
- CHECK-5 [AC-5]: `npm test` and `git diff --check` preserve the established full local tool/regression gates.

## Acceptance Criteria

- AC-1: Real unchanged native TypeScript consumer succeeds after installation, and installed CommonJS tools work without a new ambient package scope.
- AC-2: Every static runtime dependency and required data/schema file is installed and verified; no missing/stale closure is certified.
- AC-3: Ownership, custom files, collisions, staging atomicity and upgrade/removal policies remain intact across ESM/TypeScript/CommonJS fixtures.
- AC-4: Canonical/runtime instructions and component tool paths converge at the accepted revision.
- AC-5: The configured full local gates pass with no unrelated algorithm/consumer/runtime changes.
