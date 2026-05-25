# Plan — spec-pipeline

**Date:** 2026-05-25T12:20:00+02:00
**Status:** VALIDATED

## Sequential Steps

1. **TypeScript indexer changes (atomic)** — Add `"spec"` to `ComponentType` union in `scripts/lib/types.ts`, add `specs/` prefix mapping in `scripts/lib/infer.ts`, add `"specs"` to roots array in `scripts/build-index.ts`. All three must land together. Verify with `npm test && npm run build:index`.

2. **Add `**Type:**` field to `roster-intake.md`** — Modify the brief template in `skills/pipeline/roster-intake.md` to emit `**Type:** feature|api-change|fix|chore|docs|refactor` as a line in the brief body (after Status). This is the trigger signal `roster-spec` and `roster-run` grep for.

3. **Create `skills/pipeline/roster-spec.md`** — New skill. Multi-sub-agent mini-pipeline. See implementer brief for full design. Produces `briefs/<task>-spec.md` (completion artifact) + `specs/<task-slug>.md` (indexed permanent artifact). Passes `npm test` structure checks.

4. **Update `skills/pipeline/roster-run.md` routing table** — Add spec phase detection: after intake validated AND `**Type:**` is feature/api-change AND `briefs/<task>-spec.md` absent → route to `/roster-spec`. Update canonical route string to include `→ /roster-spec`.

5. **Update `skills/pipeline/roster-review.md`** — Replace `"no_go_reason": null` with structured schema `{type, failed_acs}`. Add conditional specialists row for per-feature spec-compliance. Add routing note: `type == "spec-ac-failure"` → re-run `/roster-spec`.

6. **Parameterize `skills/kb/spec-compliance-auditor.md`** — Add `$ARGUMENTS` input contract: if a spec path is passed, read that instead of `kb/spec.md`. Default to `kb/spec.md` for backward compatibility.

7. **Update `skills/pipeline/roster-qa.md`** — Add conditional: if `specs/<task-slug>.md` exists, read its `## Runnable Checks` section and use as primary verification checklist. Each check must pass or be marked N/A with justification.

8. **Update `skills/kb/ambiguity-auditor.md`** — Add new step after existing KB checks: if `specs/` directory exists, cross-check entity names from `## Entities` sections across all spec files. Flag name conflicts as CRITICAL.

9. **Update `agents/management/architect.md`** — Add `specs/<task-slug>.md` to artifacts.reads (conditional). Add step: before flagging a design issue, check if a spec defines the expected behavior.

10. **Update `skills/management/improvement-loop-planner.md`** — Add mandatory `## Tool Opportunities` output section after `## Recommendation`. Format: `[TOOL] <description> — replaces: <LLM judgment pattern it makes deterministic>`.

11. **Update `skills/kb/harness-validator.md`** — Make spec-compliance-auditor conditional in required auditor list: only required if `specs/` directory exists in the project.

12. **Documentation** — README pipeline table (+roster-spec row), AGENTS.md skills count 15→16, docs/agents.md pipeline skills table (+roster-spec row).

13. **Verification** — `npm test` (full suite including structure checks on new skill), `npm run build:index && grep '"component_type":"spec"' index.json`.

## Dependencies

- Step 3 depends on Step 1 (type must exist in TypeScript before indexer can classify specs)
- Step 4 depends on Steps 2 and 3 (routing needs both the Type field and the spec skill to exist)
- Step 5 (reviewer spec-compliance row) depends on Step 6 (auditor must be parameterized first)
- Steps 7, 8, 9 are independent of each other, depend only on Step 3
- Step 13 depends on all prior steps

## Identified Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `roster-spec` skill too complex to pass structure checks on first pass | Medium | Low | Draft carefully; `npm test` catches missing `## When to Go Back` / `## What Next` |
| Idempotency: re-running roster-spec writes duplicate `specs/<slug>.md` | Medium | Medium | Guard: check if `specs/<slug>.md` exists before writing; ask user to confirm overwrite |
| harness-validator conditional logic: existing projects may have `specs/` from other tools | Low | Low | Check for roster-specific frontmatter (`type: spec`) not just directory existence |
| improvement-loop-planner Tool Opportunities section: format must fit existing Proposal Format | Low | Low | Insert after `## Recommendation`, before `## Rules` |

## Decisions Made

| Point | Decision | Reason |
|---|---|---|
| Brief mutation vs separate file | Separate `briefs/<task>-spec.md` | Mutating validated artifact corrupts validation boundary |
| `type:` detection | Grep `**Type:**` from brief body | Intake brief has no YAML frontmatter block |
| spec-ac-failure routing | Back to roster-spec | Spec was wrong, not the plan |
| harness-validator scope | Conditional on `specs/` | Adding unconditional requirement breaks all existing projects |
| Gherkin vs runnable checks | Runnable checks (shell/curl/pytest) | No step-definition runner in this system |
| improvement-loop-planner path | `skills/management/` | Verified on disk; brief had wrong path |
| AGENTS.md count | 15→16 | Actual current count is 15, not 11 as brief stated |

## Assumptions

- `<task-slug>` in `specs/<task-slug>.md` equals the task slug from the intake brief filename
- `specs/` directory created by roster-spec on first run; build-index silently skips absent dirs
- Backward compatibility of `no_go_reason` change: per-project review.json files are ephemeral, not versioned here
