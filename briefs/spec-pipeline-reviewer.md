# Reviewer Brief — spec-pipeline

**Date:** 2026-05-25T12:20:00+02:00
**Status:** VALIDATED

## What Was Implemented

A new `roster-spec` pipeline phase inserted between `roster-intake` and `roster-plan`. The phase is
a multi-sub-agent adversarial mini-pipeline that produces user stories, surfaces challenges,
resolves them, and writes a structured `specs/<slug>.md` contract + `briefs/<slug>-spec.md`
completion marker. The KB indexer was extended to recognize `type: spec`. All downstream agents
(reviewer, qa, architect) and auditors (spec-compliance, ambiguity) were wired to consume specs.
The improvement-loop-planner got a Tool Opportunities output section. Documentation updated.

## Files to Audit First

1. `skills/pipeline/roster-spec.md` — new file, highest risk; check: frontmatter completeness,
   trigger check correctness, sub-agent prompts (anti-sycophantic?), bounce conditions, idempotency
   guard, output format completeness, `## When to Go Back` and `## What Next` presence

2. `scripts/lib/types.ts`, `scripts/lib/infer.ts`, `scripts/build-index.ts` — atomic TypeScript
   change; check all three landed together and are consistent

3. `skills/pipeline/roster-run.md` — routing table; verify spec phase detection logic is correct
   and doesn't break existing routes for fix/chore/docs/refactor tasks

4. `skills/pipeline/roster-review.md` — `no_go_reason` schema and new spec-compliance row

5. `skills/kb/spec-compliance-auditor.md` — parameterization backward compat

## Identified Risks to Verify

| Risk | Check |
|---|---|
| roster-spec idempotency — re-run overwrites existing spec silently | Confirm guard is present and asks user |
| roster-run routing — fix/chore tasks accidentally trigger spec phase | Verify Type-field grep excludes non-feature types |
| spec-compliance-auditor default path — `kb/spec.md` still used when no $ARGUMENTS | Verify default is preserved |
| harness-validator — spec-compliance wrongly marked required on projects without specs/ | Verify conditional logic uses `type: spec` frontmatter check |
| improvement-loop-planner — Tool Opportunities section conflicts with existing output format | Verify placement and formatting |

## Expected Behaviors to Confirm

- `npm test` passes: all skill files pass structure checks (roster-spec must have `## When to Go Back` and `## What Next` because it has `phase:` in frontmatter)
- `ComponentType` in types.ts includes `"spec"` as a union member
- `inferComponentType("specs/foo.md")` returns `"spec"` (verify in infer.ts)
- `roots` array in build-index.ts includes `"specs"`
- roster-run routing table correctly gates spec phase on `**Type:** feature` or `**Type:** api-change`
- `no_go_reason` field in review.json template is structured object, not null
- `briefs/<task>-spec.md` is listed in roster-spec's `artifacts.writes`
- Tool Opportunities section is after `## Recommendation` and before `## Rules` in improvement-loop-planner
