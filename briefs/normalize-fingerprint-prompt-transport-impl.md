# Implementation Brief — normalize-fingerprint-prompt-transport

**Date:** 2026-07-13
**Mode:** fast
**Status:** COMPLETED

## Modified files

| File | Type of change | Reason |
|---|---|---|
| `scripts/lib/normalize-rules.js` | modification | Replace unsafe modern-to-v1 fallback with verified semantic identity and surface ledger/new probable duplicates. |
| `scripts/review-normalize.js` | modification | Include legacy-ledger/new-finding identity misses in owner adjudication output. |
| `scripts/review-normalize*.test.js` | modification | Cover v1 collisions, v2 collisions, forged fid, incomplete legacy rows, and compatible migration. |
| `scripts/xruntime-review.js` | modification | Keep prompts file-backed when invoking the wrapper. |
| `scripts/xruntime-exec.sh` | modification | Add backward-compatible `--prompt-file=<path>` streaming and clean wrapper-owned output files. |
| `scripts/xruntime-review.test.js` | modification | Prove a 3 MiB prompt reaches the runtime with bounded argv. |
| `scripts/review-bundle.manifest.json` | modification | Publish the changed tool closure as bundle 1.1.0. |
| `skills/pipeline/roster-qa.md` + projections | modification | Use the bounded prompt transport in cross-runtime QA and bump to 1.7.0. |
| `specs/review-*.md` | modification | Supersede the wrapper byte-freeze and define fail-closed legacy identity migration. |
| `.harness/harness.json`, `.claude/harness.json`, `AGENTS.md` | generated/catalog update | Keep installed skill versions and projections synchronized. |

## Decisions made

- A modern `fid` miss never falls back to coarse v1 identity. Legacy rows with a summary are indexed under a reconstructed fid, then direct summary and v2 fields are verified. Incomplete rows remain visible but cannot suppress a new finding.
- Ledger/new identity misses are probable duplicates only; no automatic merge or resolution occurs.
- The wrapper retains every positional prompt value for compatibility and adds unambiguous `--prompt-file=<path>`. Both supported runtimes accept piped stdin with EOF, avoiding E2BIG without attachment semantics.
- Review bundle 1.1.0 and roster-qa 1.7.0 are backward-compatible minor releases.

## Quality Gates

- [x] TDD RED: legacy collision and 3 MiB prompt tests failed against the prior implementation.
- [x] Focused tests: `node --test scripts/review-normalize-mutations.test.js scripts/review-normalize.test.js scripts/xruntime-review.test.js scripts/review-lifecycle.test.js` — 82 passed.
- [x] Shell syntax/smoke: `bash -n scripts/xruntime-exec.sh` plus file-backed Codex stub invocation.
- [x] Bundle/install gates: manifest, pipeline-install, and harness-sync checks passed.
- [x] Full suite: `npm test` passed.
- [x] Diff hygiene: `git diff --check` passed.

## Points of attention for review

- Confirm legacy identity never suppresses a distinct summary or v2 invariant.
- Confirm the temporary prompt directory is removed on success, timeout, and spawn failure.
- Confirm positional wrapper callers remain compatible while QA uses the new path.
- Confirm bundle and skill version bumps match generated projections.

## Identified out-of-scope

None.
