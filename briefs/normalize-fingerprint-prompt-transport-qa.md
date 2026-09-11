# QA Report — normalize-fingerprint-prompt-transport

**Date:** 2026-07-13
**Mode:** fast
**Status:** GO ✅

## Gate results

| Gate | Result | Evidence |
|---|---|---|
| TypeScript build | PASS | `npm run build:ts` completed successfully. |
| Focused regression suite | PASS | 82 tests passed across normalize mutations, normalization, lifecycle, and cross-runtime transport. |
| Full project suite | PASS | `npm test` exited 0 in 22.476s, including all agent, skill, hook, schema, ledger, manifest, and harness checks. |
| Review bundle | PASS | `node scripts/review-bundle-manifest.js --check`: 15-file bundle is current. |
| Pipeline distribution | PASS | `node scripts/check-pipeline-install.js`: installed skills, hooks, schemas, and plugin manifests are consistent. |
| Harness projections | PASS | `bash scripts/sync-harness.sh --check`: all runtime projections match the source harness. |
| Shell syntax | PASS | `bash -n scripts/xruntime-exec.sh`. |
| Diff hygiene | PASS | `git diff --check`. |
| Lint | N/A | No project lint script is configured. |
| Code-intelligence properties | N/A | No `kb/properties.md` exists for this repository. |
| TUI | N/A | No terminal UI is changed by this task. |

## Security regression coverage

- Legacy v1 fingerprint collisions with different summaries remain distinct and are surfaced as probable duplicates.
- Exact legacy semantic identities migrate/reobserve correctly.
- Differing v2 boundary, invariant, or failure-mode fields cannot be suppressed by a shared v1 fingerprint or summary.
- Forged fids and incomplete fingerprint-only ledger entries cannot suppress incoming findings.
- Three-megabyte prompts reach both Codex and OpenCode stubs through stdin with bounded argv entries.
- Prompt directories and wrapper-owned output files are removed on success, timeout, mutation rejection, unknown runtime, and injected write failure.
- Legacy positional prompts, including option-shaped values and literal `--prompt-file`, remain compatible.

## Independent runtime check

The required OpenCode QA attempt used the new `--prompt-file=<path>` transport and a 240-second
bound. It exited 124 after producing only the runtime banner (`build · qwen3.6:27b`) and no QA
result. This is recorded as degraded runtime availability, not a product discrepancy. The earlier
independent review attempt had the same timeout signature, and the no-retry breaker was honored.

## Verdict

GO. All deterministic release gates pass, the reviewer reported no remaining findings, and the
only degraded signal is the unavailable independent OpenCode runtime.
