# Portable review-bundle consumer compatibility

mode: full

The installer no longer distributes an ambient scripts/package.json. The existing generator retains canonical/legacy .js paths and produces18 deterministic .cjs counterparts, rewriting only known managed relative require references. The46-file manifest binds both closures. Active portable instructions use .cjs; legacy exports and installer collision/shared-file policies stay intact. Existing scope-bearing installer input now guards unrelated native TypeScript too.

Meaningful authentic consumer RED: consumer-script-scope-native-red.log (exit1, unchanged typed export breaks after actual old installation). GREEN: native-green.log exit0. Initial focused gate had51pass/2 stale count assertions; corrected focused-v2 is58/58PASS. Final docs change exposed one old verifier-command assertion, retained install-final exit1; corrected standalone suite and full npm suite are pending at this source freeze, not certified passes. Manifest freshness, installed verification46, sync --check and diff --check actual0.

Required commands: npm test; npm run test:review-bundle; node scripts/review-bundle-manifest.js --check; node scripts/review-bundle-verify.cjs; bash scripts/sync-harness.sh --check; git diff --check.

No consumer project source, runtime algorithms, global configuration, provider calls or live installation changed. Existing failed trial is inactive until upstream qualification. Root explicitly authorized one nonauthor reviewer to cover correctness/security/architecture/spec dimensions under constrained slots, recorded as one review rather than multiple independent voices. Cross-runtime provider checks are explicitly skipped by delegated lead authority due standing no-Claude/no-unchanged-reprobe instruction; no fresh degraded or cross-runtime GO claim.

Preparation failures retained: original source graph lock differs, so alias was refused and own npm ci completed0 (37MiB); pre-plan/implement hooks actual0. Two initial strict planner role invocations refused before two fresh sequential planning voices completed. These are setup evidence, not product success.
