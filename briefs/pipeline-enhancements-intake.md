# Intake Brief — pipeline-enhancements

**Date:** 2026-05-24T23:35:00+02:00
**Status:** VALIDATED

## Goal

Enhance the roster skill pipeline with three improvements borrowed from QRSPI analysis:

1. **Blind research phase** — Add two new skills (`roster-question` and `roster-research`) that sit before `roster-intake`. `roster-question` decomposes the task into neutral research questions without revealing the solution intent. `roster-research` is a pure documentarian — it reads only the questions (never the task) and produces a `research.md` grounded in `file:line` references. `roster-intake` is updated to optionally consume `research.md` when available.

2. **"When to Go Back"** — Add a `## When to Go Back` section to all 12 pipeline and meta skills. Each section specifies the exact conditions under which the skill must stop and route the user back to a prior skill, and which skill to re-run.

3. **"What Next"** — Add a `## What Next` section to the output template of all 12 skills. After completing, each skill presents the user with: (a) the primary next skill, (b) alternative paths, (c) a periodic nudge toward `roster-skill-health` when the friction log is accumulating.

## Scope Boundary

What is explicitly OUT of scope:
- Changes to non-pipeline skills (kb/, workflow/, testing/, media/)
- Changes to agents, rules, hooks, or the harness sync scripts
- Implementing a worktree phase (QRSPI Phase 6 — not needed for our use case)
- Changing the artifact naming scheme for existing briefs (only new `roster/<task>/` dir for question/research artifacts)
- Any UI or tooling changes beyond the skill `.md` files themselves

## Relevant Files

| File | Role | Change |
|---|---|---|
| `skills/pipeline/roster-run.md` | Entry point / router | Add routing to `roster-question` → `roster-research` for complex tasks |
| `skills/pipeline/roster-intake.md` | Intake brief producer | Consume `roster/<task>/research.md` if present; add When to Go Back + What Next |
| `skills/pipeline/roster-plan.md` | Plan decomposer | Add When to Go Back + What Next |
| `skills/pipeline/roster-implement.md` | Implementation driver | Add When to Go Back + What Next |
| `skills/pipeline/roster-review.md` | GO/NO-GO review | Add When to Go Back + What Next |
| `skills/pipeline/roster-qa.md` | QA gates | Add When to Go Back + What Next |
| `skills/pipeline/roster-ship.md` | Conventional commit + PR | Add When to Go Back + What Next |
| `skills/pipeline/roster-investigate.md` | Root-cause investigation | Add When to Go Back + What Next |
| `skills/pipeline/roster-audit.md` | Quality/compliance audit | Add When to Go Back + What Next |
| `skills/pipeline/roster-init.md` | Project bootstrapper | Add When to Go Back + What Next |
| `skills/meta/roster-skill-health.md` | Friction analyzer | Add When to Go Back + What Next |
| `skills/meta/roster-skill-evolve.md` | Improvement implementer | Add When to Go Back + What Next |
| `skills/pipeline/roster-question.md` | **NEW** — question decomposer | Create from scratch |
| `skills/pipeline/roster-research.md` | **NEW** — blind researcher | Create from scratch |
| `index.json` | Skill index | Add 2 new skills after `npm run build:index` |
| `AGENTS.md` | Project registry | Update skill table (+2 entries) |

## Architecture Notes

**Artifact convention for new skills:**
- `roster-question` writes `roster/<task-slug>/questions.md`
- `roster-research` writes `roster/<task-slug>/research.md`
- `roster-intake` reads `roster/<task-slug>/research.md` if present (optional enrichment, never blocks if absent)
- `roster/` dir should be in `.gitignore` (ephemeral working artifacts, like `briefs/`)

**Blind research principle (from QRSPI):**
- `roster-research` receives only the path to `questions.md` in `$ARGUMENTS`
- It must never read `task.md` or see the task description
- Its sub-agents are documentarian-only (describe what IS, never what SHOULD BE)
- Output is dense `file:line` references, not prose opinions

**"What Next" format** (consistent across all skills):
```markdown
## What Next

**Primary path:** `/roster-<next-skill>`
**Alternatives:**
- `/roster-investigate` — if something unexpected was discovered
- `/roster-audit` — if code quality concerns were flagged

> 💡 **Metabolism check:** If this is your 5th+ run, consider `/roster-skill-health` to analyze friction patterns.
```
The metabolism nudge appears only when the friction log has ≥5 entries (skill checks JSONL count).

**"When to Go Back" format:**
```markdown
## When to Go Back

| Condition | Action |
|---|---|
| Research is missing critical context | Stop — ask user to run `/roster-research` first |
| Brief has unresolvable ambiguity | Stop — re-run `/roster-intake` with clarification |
| Plan contradicts the brief | Stop — re-run `/roster-plan` |
```

**Version bumps** (per AGENTS.md semver rules):
- All modified skills: minor bump (x.+1.0) — new capabilities, backward compatible
- New skills: 1.0.0

## Quality Gates

```bash
# Build / index
npm run build:index

# No automated tests for .md skills — lint is manual review
```

## Open Questions

_(empty — all decisions above are resolved)_
