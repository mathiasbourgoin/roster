# Review Report — normalize-fingerprint-prompt-transport

**Date:** 2026-07-13
**Mode:** fast
**Status:** GO ✅

## Scope reviewed

The complete uncommitted task diff, implementation brief, changed source and tests, three amended
live specs, review-bundle manifest, roster-qa source/projections, and generated harness catalogs.
The pre-task tree was clean at `2e4f81e` on branch `next`.

## Specialist results

| Specialist | Result | Notes |
|---|---|---|
| Correctness/security reviewer | GO after fixes | Initial 1 MEDIUM + 4 LOW findings resolved; final re-review returned `[]`. |
| Architecture review | GO | Semantic matching, probable-duplicate construction, temp lifecycle, shell parsing, and bundle projection remain bounded and cohesive. |
| Spec compliance | GO | 8/8 testable claims PASS; see `normalize-fingerprint-prompt-transport-spec-compliance.md`. |
| OpenCode cross-runtime | DEGRADED | Authentic prompt-file invocation timed out at 180.062s; journal digest `opencode:aeee3012b1061a3b`. No result was accepted and the no-automatic-retry breaker was honored. |

## Findings and resolutions

| Severity | Location | Finding | Resolution |
|---|---|---|---|
| MEDIUM | `scripts/xruntime-exec.sh:61` | Wrapper-owned output files persisted in TMPDIR. | Added ownership tracking and EXIT cleanup; caller-supplied `--out` remains untouched. Success, timeout, mutation, and unknown-runtime cases test cleanup. |
| LOW | `scripts/xruntime-review.js:163` | Prompt directory was not covered if prompt writing failed. | Moved the write inside the try/finally and added injected-failure cleanup coverage. |
| LOW | `scripts/xruntime-exec.sh:41` | Literal legacy prompt `--prompt-file` was ambiguous. | New transport is unambiguous `--prompt-file=<path>`; all positional values remain valid and are regression-tested. |
| LOW | `scripts/xruntime-review.test.js:303` | Above-ARG_MAX coverage exercised only Codex. | Parameterized the 3 MiB test across Codex and OpenCode. |
| LOW | `scripts/xruntime-review.js:11` | Header still stated the superseded byte-freeze. | Updated the source contract to FR-086/E-12 and current wrapper compatibility. |
| LOW | `scripts/lib/normalize-rules.js:138` | Probable-duplicate record construction was duplicated during the fix. | Extracted a shared pure record constructor; focused tests remained green. |

## Security and regression assessment

- Modern findings cannot be suppressed by raw v1 collisions, forged fid values, incomplete
  legacy rows, or differing v2 semantics (`normalize-rules.js:177-216`).
- Identity misses remain visible in `findings` and `probable_duplicates`; no automatic merge or
  resolution was introduced (`normalize-rules.js:138-174`).
- Prompt content remains outside argv at both helper and runtime boundaries, is stored in a 0600
  file inside a private temp directory, and is cleaned on all tested exits (`xruntime-review.js:161-183`).
- The wrapper preserves positional callers, cleans only files it owns, and keeps caller-supplied
  output paths (`xruntime-exec.sh:38-98`).
- Bundle 1.1.0, roster-qa 1.7.0, harness manifests, and three runtime projections are synchronized.

## Escalation check

The new wrapper flag is a backward-compatible public interface addition, which is an informational
Fast→Full escalation signal. It does not block GO because the behavior is fully specified in the
v1.2.0 live-spec amendments and the user explicitly authorized the maintainer-side fix.

## Verdict

GO. No OPEN CRITICAL or HIGH findings remain. Proceed to deterministic QA.
