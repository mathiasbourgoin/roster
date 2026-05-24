# Plan — pipeline-enhancements

**Date:** 2026-05-24T23:33:00+02:00
**Status:** VALIDATED

## Backward arc graph (drives all "When to Go Back" sections)

| From skill | Goes back to | Condition |
|---|---|---|
| roster-research | roster-question | Questions too vague, missing key areas, or unanswerable |
| roster-intake | roster-research | Research missing critical context for the brief |
| roster-intake | (human) | Task too ambiguous to form a brief |
| roster-plan | roster-intake | Brief has unresolvable ambiguity or missing sections |
| roster-implement | roster-plan | Plan step cannot be implemented as described |
| roster-review (NO-GO) | roster-implement | Fixes required |
| roster-qa (NO-GO) | roster-implement | Automated gate fails |
| roster-ship | roster-qa | QA not GO |
| roster-investigate | roster-intake | Root cause found — convert to intake for fix |
| roster-audit | roster-plan or roster-intake | Findings require re-scoping |
| roster-skill-evolve | roster-skill-health | No approved proposals in report |
| roster-init | (none — entry point) | — |
| roster-skill-health | (none — analysis only) | — |

## What Next map

| Skill | Primary | Alternatives | Notes |
|---|---|---|---|
| roster-question | roster-research | — | — |
| roster-research | roster-intake | roster-question (if questions bad) | — |
| roster-intake | roster-plan | roster-investigate (if root cause unclear) | — |
| roster-plan | roster-implement | — | — |
| roster-implement | roster-review | — | — |
| roster-review | roster-qa (GO) / roster-implement (NO-GO) | — | Branch on verdict |
| roster-qa | roster-ship (GO) / roster-implement (NO-GO) | — | Branch on verdict |
| roster-ship | done | roster-intake (next task) | — |
| roster-investigate | roster-intake | roster-plan (if fix obvious) | — |
| roster-audit | roster-review or roster-plan | — | Depends on findings |
| roster-init | roster-intake or roster-run | — | — |
| roster-skill-health | roster-skill-evolve (if approvals) | — | Or done if no proposals |
| roster-skill-evolve | roster-skill-health (next cycle) | — | — |

## Sequential steps

1. **Create `skills/pipeline/roster-question.md`** — New skill: takes $ARGUMENTS (task description), spawns sub-agent to produce neutral research questions, writes `roster/<task-slug>/questions.md` (task NOT included in that file). Includes When to Go Back + What Next. v1.0.0.

2. **Create `skills/pipeline/roster-research.md`** — New skill: takes `roster/<task-slug>/questions.md` path in $ARGUMENTS only, NEVER reads the task. Spawns documentarian sub-agents (locate, analyze, pattern-find). Writes `roster/<task-slug>/research.md` with file:line references. Includes When to Go Back + What Next. v1.0.0.

3. **Update `skills/pipeline/roster-intake.md`** — Add step 0: if `roster/<task-slug>/research.md` exists, read it as enrichment context. Add `## When to Go Back` + `## What Next`. Bump to v1.1.0. Update `artifacts.reads` to include optional research.md.

4. **Update `skills/pipeline/roster-run.md`** — Make `/roster-question` → `/roster-research` → `/roster-intake` the mandatory standard route for all tasks. roster-research depth is adaptive (fast on small tasks, thorough on large ones — tunable in the skill). Add `## What Next`. Bump to v1.1.0.

5. **Update remaining 10 skills** (batch) — Add `## When to Go Back` + `## What Next` + version bump to each:
   - roster-plan, roster-implement, roster-review, roster-qa, roster-ship, roster-investigate, roster-audit, roster-init, roster-skill-health, roster-skill-evolve

6. **Add `roster/` to `.gitignore`** — Ephemeral per-task artifacts (questions.md, research.md) should not be committed.

7. **Run `npm run build:index`** — Rebuild index.json with 2 new skills.

8. **Update `AGENTS.md`** — Add roster-question and roster-research to the Skills table.

## Dependencies

- Step 3 depends on Step 2 (roster-intake reads research.md format)
- Step 7 depends on Steps 1–5 (all skill files must exist before index rebuild)
- Step 8 depends on Step 7

## Identified risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| roster-research accidentally reads task context | Medium | High (breaks blind principle) | Add explicit "NEVER read task.md or $ARGUMENTS task description" rule in skill |
| JSONL absent on nudge check | High | Low (bash error) | Always show nudge — no JSONL count check |
| Inconsistent arc graph across 12 skills | Medium | Medium | Write arc graph first (step 0 done), copy exact wording from graph |
| `roster/` dir committed by mistake | Low | Low | .gitignore entry |

## Decisions made

| Point | Decision | Reason |
|---|---|---|
| roster-question invocation | Mandatory in roster-run (always first step) | Ensures blind research always happens before intake |
| Metabolism nudge trigger | Always show | Simpler, no bash dependency, still valuable as a reminder |
| Artifact dir | `roster/<task-slug>/` | Per-task, gitignored, mirrors QRSPI's `thoughts/qrspi/<task-id>/` |
| What Next format | Structured block with primary + alternatives + nudge | Consistent, scannable |

## Assumptions

- `npm run build:index` works as documented in AGENTS.md
- `.gitignore` already exists at repo root (confirmed: it does)
