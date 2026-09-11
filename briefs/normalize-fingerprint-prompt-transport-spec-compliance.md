# Spec Compliance Review — normalize-fingerprint-prompt-transport

**Date:** 2026-07-13
**Status:** PASS — 8/8 claims implemented and tested

Spec sources: `specs/review-v2-corrections.md` v1.2.0, `specs/review-skill-slimming.md`
v1.2.0, and `specs/review-tool-distribution.md` v1.2.0.

## Compliance matrix

| Claim | Status | Implementation | Test evidence |
|---|---|---|---|
| INV-1: a modern fid miss never falls back to raw v1 identity | PASS | `scripts/lib/normalize-rules.js:177-216` | `scripts/review-normalize-mutations.test.js:86` |
| INV-1: differing v2 semantics remain distinct | PASS | `scripts/lib/normalize-rules.js:199-207` | `scripts/review-normalize-mutations.test.js:116` |
| INV-1: forged/stale fid cannot override semantic comparison | PASS | `scripts/lib/normalize-rules.js:210-216` | `scripts/review-normalize-mutations.test.js:127` |
| INV-1: incomplete legacy rows cannot suppress modern findings | PASS | `scripts/lib/normalize-rules.js:185-193` | `scripts/review-normalize-mutations.test.js:140` |
| INV-1/FR-105: ledger/new collisions are visible probable duplicates | PASS | `scripts/lib/normalize-rules.js:138-174`, `scripts/review-normalize.js:242-246` | mutation (c) assertion at `scripts/review-normalize-mutations.test.js:103` |
| INV-6/E-12: prompts remain file/stdin-backed through the runtime boundary | PASS | `scripts/xruntime-review.js:161-183`, `scripts/xruntime-exec.sh:63-85` | Codex + OpenCode 3 MiB cases at `scripts/xruntime-review.test.js:303` |
| FR-086: legacy positional wrapper API remains compatible | PASS | `scripts/xruntime-exec.sh:38-55` | option-shaped and literal `--prompt-file` cases at `scripts/xruntime-review.test.js:328-348` |
| Distribution: shared wrapper/tool changes are versioned and projected | PASS | bundle 1.1.0, roster-qa 1.7.0, synchronized harness manifests | `review-bundle-manifest --check`, `check-pipeline-install`, and `sync-harness --check` |

## Divergences

None.

## Unspecified behavior

None. The v1.2.0 amendments explicitly authorize the legacy identity migration, bounded prompt
transport, output cleanup, and backward-compatible wrapper extension.
