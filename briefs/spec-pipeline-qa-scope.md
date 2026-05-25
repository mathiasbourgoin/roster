# QA Scope — spec-pipeline

**Date:** 2026-05-25T12:20:00+02:00
**Status:** VALIDATED

## Quality Gates

```bash
# Primary gate — must pass 0 failures
npm test

# Indexer verification
npm run build:index && grep '"component_type":"spec"' index.json | head -3

# Shellcheck (if any .sh files modified — none expected in this task)
# shellcheck scripts/install.sh
```

## Behaviors to Validate

**AC-1 — roster-spec skill exists and passes structure checks**
```bash
ls skills/pipeline/roster-spec.md
npm test 2>&1 | grep "roster-spec\|skill files pass"
```
Expected: file exists, npm test shows all skill files pass

**AC-2 — TypeScript indexer changes complete and consistent**
```bash
grep '"spec"' scripts/lib/types.ts
grep 'specs/' scripts/lib/infer.ts
grep '"specs"' scripts/build-index.ts
```
Expected: all three greps return matches

**AC-3 — Indexer classifies spec files correctly**
```bash
mkdir -p specs
printf -- '---\nname: qa-fixture\ntype: spec\nstatus: live\nfeature: qa test\nbrief: briefs/test.md\ndate: 2026-05-25\nversion: 1.0.0\n---\n# QA fixture\n## Entities\n- `QAEntity`: test entity.\n' > specs/.qa-fixture.md
npm run build:index && grep '"component_type":"spec"' index.json | head -3
rm specs/.qa-fixture.md
```
Expected: grep returns at least one line with `"component_type":"spec"`

**AC-4 — roster-intake brief template includes Type field**
```bash
grep '\*\*Type:\*\*' skills/pipeline/roster-intake.md
```
Expected: line found

**AC-5 — reviewer no_go_reason is structured object**
```bash
grep -A3 'no_go_reason' skills/pipeline/roster-review.md | head -6
```
Expected: shows `type` and `failed_acs` fields, NOT `null`

**AC-6 — reviewer conditional specialists includes per-feature spec-compliance**
```bash
grep -i 'spec-compliance.*per-feature\|per-feature.*spec' skills/pipeline/roster-review.md
```
Expected: line found in specialists table

**AC-7 — QA reads spec Runnable Checks**
```bash
grep -i 'runnable.checks\|specs/.*slug' skills/pipeline/roster-qa.md
```
Expected: both patterns found

**AC-8 — ambiguity-auditor has cross-spec entity step**
```bash
grep -i 'cross-spec\|specs/\*\.md\|## Entities' skills/kb/ambiguity-auditor.md
```
Expected: at least two of three patterns found

**AC-9 — roster-run routing includes spec phase**
```bash
grep -i 'roster-spec\|spec.*absent\|Type.*feature' skills/pipeline/roster-run.md
```
Expected: spec phase appears in routing

**AC-10 — Documentation updated**
```bash
grep 'roster-spec' README.md
grep 'Skills (16)' AGENTS.md
grep 'roster-spec' docs/agents.md
```
Expected: all three greps return matches

**AC-11 — Full test suite passes**
```bash
npm test
```
Expected: 0 failures, all agent and skill files pass structure checks
