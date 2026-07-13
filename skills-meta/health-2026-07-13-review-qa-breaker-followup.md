# Skill Health Follow-up — Review/QA Breaker and Convergence

**Date:** 2026-07-13  
**Mode:** targeted health review plus delegated corrective follow-up  
**Compared bounty-skills report:** `skills-meta/health-2026-07-13-agent-roster-latest-review.md`  
**Agent-roster base:** `f3c81eb` (`next`, two local commits ahead of `origin/next` at audit start)  
**Entries analyzed:** 93 total (64 with frictions, 29 clean runs)  
**Targeted cross-runtime entries:** 15  
**Decision:** READY TO ADOPT (`c14f6da`, including `670df6b..c14f6da`)

## Executive conclusion

The latest roster work fixed the two blocking defects from the bounty-skills follow-up:

- Finding identity no longer falls back from a modern semantic `fid` to a coarse v1
  `path:line:category` collision. Semantic migration and comparison live in
  `scripts/lib/normalize-rules.js:187-214`, with adversarial collision coverage beginning at
  `scripts/review-normalize-mutations.test.js:86`.
- Large prompts remain file-backed through the helper, wrapper, and runtime boundary. The helper
  passes only `--prompt-file=<path>` at `scripts/xruntime-review.js:174`; the 3 MiB Codex and
  OpenCode regressions at `scripts/xruntime-review.test.js:373-379` prove bounded argv and complete
  stdin delivery.

The base revision did **not** yet share degraded availability between review and QA. Roster-QA
still called `xruntime-exec.sh` directly, so the exact OpenCode timeout recorded during review was
paid again during QA. This was a real defect, not a reason to remove cross-runtime review: the log
also shows repeated cases where the independent runtime found defects missed by the primary
reviewers.

This follow-up closes that gap. Roster-QA now performs a provider-free availability check before
any QA runtime call (`skills/pipeline/roster-qa.md:190-212`). The helper compares the persisted GO
review degradation against both standard sandbox digests for the current runtime version, so the
normal read-only-review to workspace-write-QA transition cannot defeat the breaker
(`scripts/xruntime-review.js:288-328,382-404`). A runtime/version change or explicit
`--human-retry` remains the escape hatch.

A live installed-consumer check exposed a second adoption defect during this follow-up: skill and
workflow instructions referenced `dist/scripts/run-hook.js`, a source-checkout artifact that is not
installed into consumer projects. This made a valid `roster-spec` intake guard impossible to run
from bounty-skills even though the hook itself was present. The runtime is now bundled into the
self-contained `.harness/bin/run-hook.js`, installed by harness sync whenever skill hooks exist,
and verified in a dependency-free scratch consumer.

The same authentic consumer then exposed two more distribution defects that source-checkout tests
had hidden. First, harness sync treated nested installed-skill companion documents as stale and a
normal sync removed them; native skill sibling resources could also be overprojected as standalone
skills. Sync now preserves nested companions, projects native sibling resources beside `SKILL.md`,
and continues to flag genuinely stale flat projections. Second, the review bundle installed a
schema into a consumer whose schema validator requires both passing and failing fixtures, but the
bundle did not ship those fixtures. Bundle v1.3.0 now includes both and proves them through the
installed zero-dependency validator. Consumer manifest validation also accepts the three canonical
source layouts used in practice: root domain-flat, installed `.harness/skills`, and native skill
directories.

## Strong signal and implemented adaptation

### **IMPLEMENTED — [ADAPT] roster-qa → v1.8.1 / review bundle → v1.3.0**

**Signal:** 15 cross-runtime-related friction entries, including repeated timeout, banner-only,
stdout-capture, and invocation-boundary failures. The most recent review and QA entries explicitly
recorded the same OpenCode availability failure in consecutive phases.

**Problem:** Review owned a deterministic degraded-runtime journal, while QA bypassed it and
invoked the raw wrapper unconditionally.

**Adaptation:**

1. `xruntime-review.js --phase qa --check-availability` performs a bounded version probe and reads
   the persisted GO review verdict without invoking the provider.
2. A degraded digest matching either standard review/QA sandbox mode returns
   `skipped-degraded`; the QA provider call is omitted.
3. Missing/non-GO/non-object review state fails closed. Syntax-corrupt verdicts return
   `blocked/malformed-verdict`.
4. Corrupt invocation-journal lines now return `blocked/malformed-journal`; they can no longer be
   skipped in a way that silently re-enables a provider call.
5. The installed scratch-consumer test now proves healthy review execution, review-to-QA breaker
   reuse across sandbox modes, malformed-state failure, and absence of a second runtime call.

**Expected friction reduction:** one 120–240 second failed provider attempt per affected task,
plus removal of the review/QA availability contradiction.

### **IMPLEMENTED — [TOOL] portable installed skill-hook runtime**

**Signal:** the active bounty-skills projection had a valid `roster-spec` pre-hook but no runnable
hook CLI; its instructions named a `dist/` path that exists only in an agent-roster source build.

**Adaptation:** `scripts/build-hook-runtime.mjs` deterministically bundles the hook runner and YAML
parser into `.harness/bin/run-hook.js`. `sync-harness.sh` installs it when skill hooks exist and
fails `--check` on missing or stale runtime state. `/recruit update` documents the same atomic
installation path. Workflow templates and all active skill instructions now use the portable path.
The installed-consumer smoke test proves the runner works without target `node_modules`, accepts
the canonical `**Status: VALIDATED**` intake marker, and rejects the stale `**Status:** VALIDATED`
spelling.

### **IMPLEMENTED — [FIX] lossless consumer projection and schema validation closure**

**Signal:** running bounty-skills' real validation after adoption found that sync recommended
deleting required companion documents, normal sync removed those documents, and the newly installed
review schema had no valid/invalid fixture pair for the consumer's auto-discovered schema suite.

**Adaptation:** `sync-harness.sh` now distinguishes nested companion resources from owned flat
projections, preserves those resources on repeat sync, and supports native skill directories with
direct sibling resources. Bundle v1.3.0 adds one valid and one deliberately invalid
`review-finding` JSONL fixture. The consumer manifest check accepts installed flat/native sources
without weakening the missing-source failure. Scratch tests exercise Codex and OpenCode projection,
repeat sync, stale-flat detection, native resource placement, bundle installation, and fixture
validation.

## Finding disposition

| Prior finding | Current disposition | Evidence |
|---|---|---|
| AR-H-01 legacy identity collision | CLOSED | Semantic legacy migration plus direct summary/v2 comparison; seven mutation tests pass. |
| AR-M-02 prompt re-enters argv | CLOSED | File-backed helper→wrapper→runtime path; 3 MiB Codex/OpenCode tests pass. |
| AR-M-03 authentic consumer readiness | CLOSED | Installed scratch consumer now proves healthy success, fail-closed malformed state, and real review→QA breaker handoff. |
| AR-L-04 corrupt journal lines skipped | CLOSED | Malformed line produces durable `blocked/malformed-journal`; repeated calls remain blocked. |
| Review/QA availability state not shared | CLOSED | QA check consumes GO review degradation across read-only/workspace-write modes before provider invocation. |
| Installed skill-hook runner absent | CLOSED | Harness sync installs a self-contained runner; full-profile scratch consumer executes the real intake guard without target dependencies. |
| Nested companion docs deleted or reported stale | CLOSED | Repeat-sync tests preserve Codex/OpenCode companions while stale flat projections still fail with cleanup guidance. |
| Native skill resources projected as standalone skills | CLOSED | Native sibling-resource test projects resources beside `SKILL.md` and proves no standalone skill is created. |
| Installed review schema lacks consumer fixtures | CLOSED | Bundle v1.3.0 ships valid/invalid JSONL fixtures and validates both through the installed bundle. |
| Installed consumer manifest rejected | CLOSED | Sync check accepts domain-flat, `.harness/skills`, and native `skills/<name>/SKILL.md` canonical sources; missing sources still fail. |
| Review churn / finding re-observation | SUBSTANTIALLY CLOSED | Semantic identity, probable-duplicate surfacing, two-event lifecycle, round audit, strike routing, and delta specialist selection are all executable or schema-backed. Benchmark real multi-round tasks before changing the five-review cap. |
| Skill sizing | HEALTHY | All 37 structure checks pass. `roster-qa` remains a focused 1,881-word gate skill; no new skill or further split is justified. |

## Verification

- `node --test scripts/xruntime-review.test.js`: PASS (38 tests after corrupt-journal coverage).
- Identity/normalizer focused suite: PASS (all mutation and normalization tests).
- `node --test scripts/review-bundle-install.test.js`: PASS (15 integration tests).
- `node --test scripts/sync-harness-guard.test.js`: PASS (8 authentic projection tests).
- `node scripts/check-pipeline-install.js`: PASS, including bundle closure and digests.
- `npm run test:review-bundle`: PASS (15 integration tests; 17-file bundle).
- `bash scripts/sync-harness.sh --check`: PASS.
- `npm run check:init-harness`: PASS, including the dependency-free installed hook consumer.
- `npm run check:hook-runtime`: PASS; generated runner matches a fresh deterministic bundle.
- `npm audit --audit-level=moderate`: PASS (0 vulnerabilities after updating `js-yaml`).
- `npm test`: PASS after regenerating `layers.skills`, runtime projections, and the portable runner.
- `git diff --check`: PASS.

## Weak signals to monitor

### QA attempts are not yet journaled by the shared helper

The preflight prevents review→QA re-payment, but a QA attempt that itself degrades still runs
through the raw wrapper. Re-running QA later could pay that QA failure again because there is no
phase-neutral QA execution journal. Current evidence does not show three same-task QA retries, so
this remains below the proposal threshold. If it recurs, promote QA execution into the helper
rather than adding another prose check.

### Local-only shipping remains documentation, not a terminal mode

Commit `f3c81eb` correctly records that the prior task ended at a prepared local commit because
remote mutation was outside scope. Roster-Ship still has no first-class local-delivery terminal.
There is one direct friction entry, below threshold. Add a `delivery_mode: local` only if this
repeats; do not broaden ship authority implicitly.

### Changed runtime versions intentionally re-probe

The shared breaker keys on runtime/version and accepts both standard sandbox modes. A version
change is treated as meaningful new availability and permits one attempt. This is deliberate and
should remain unless measurements show version churn itself causes repeated waste.

## Stability

Twenty-nine clean runs are positive evidence. The latest correction task's deterministic hooks,
focused tests, full suite, bundle integration, and projection checks are green. No extra reviewer
layer, review skill split, or new agent is supported by the data.
