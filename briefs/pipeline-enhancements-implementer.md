# Implementer Brief — pipeline-enhancements

**Date:** 2026-05-24T23:33:00+02:00
**Status:** VALIDATED

## Goal

Implement 3 pipeline enhancements: blind research skills (roster-question + roster-research), "When to Go Back" sections in all 12 skills, and "What Next" sections in all 12 skills.

## Scope Boundary

OUT of scope: non-pipeline skills, agents, rules, hooks, sync scripts, harness schema.

## Backward arc graph (reference for all "When to Go Back" sections)

| From | Back to | Condition |
|---|---|---|
| roster-research | roster-question | Questions too vague or unanswerable |
| roster-intake | roster-research | Research missing critical context |
| roster-plan | roster-intake | Brief unresolvable ambiguity |
| roster-implement | roster-plan | Plan step cannot be implemented |
| roster-review (NO-GO) | roster-implement | Fixes required |
| roster-qa (NO-GO) | roster-implement | Gate failure |
| roster-ship | roster-qa | QA not GO |
| roster-investigate | roster-intake | Root cause found |
| roster-audit | roster-plan or roster-intake | Findings require re-scoping |
| roster-skill-evolve | roster-skill-health | No approved proposals |

## Steps

### Step 1: Create `skills/pipeline/roster-question.md`

New skill. Full content:
- frontmatter: name, description, version 1.0.0, domain pipeline, phase question, preamble true, friction_log true, allowed_tools [Read, Write, Agent, AskUserQuestion], human_gate after, artifacts writes roster/<task-slug>/questions.md
- Body: task → neutral questions, sub-agent for question generation, writes questions.md WITHOUT including the task description, human reviews questions
- When to Go Back: if task too vague to form questions → ask human to clarify before proceeding
- What Next: primary roster-research; nudge always shown

### Step 2: Create `skills/pipeline/roster-research.md`

New skill. Full content:
- frontmatter: version 1.0.0, domain pipeline, phase research, preamble true, friction_log true, allowed_tools [Read, Bash, Agent, Glob, Grep], human_gate never (fully automated), artifacts reads roster/<task-slug>/questions.md writes roster/<task-slug>/research.md
- Body: reads ONLY questions.md (never the task), spawns documentarian sub-agents (locator, analyzer, pattern-finder). **Adaptive depth**: for small tasks (≤3 files, narrow scope) runs a single fast sub-agent; for larger tasks runs all 3 in parallel. Depth is a tunable (`tunables.depth`: `fast` | `full`, default `auto`). Synthesizes into research.md with file:line references.
- Explicit rule: "NEVER read task.md, the task description, or any file not referenced in questions.md"
- When to Go Back: if questions.md absent → run /roster-question first; if questions unanswerable → back to /roster-question
- What Next: primary roster-intake

### Step 3: Update `skills/pipeline/roster-intake.md`

- Add to `artifacts.reads`: `roster/<task-slug>/research.md (optional)`
- Add new Step 0 before "Silent reading": "If `roster/<task-slug>/research.md` exists, read it as enrichment context before reading the KB."
- Add `## When to Go Back` section (from arc graph)
- Add `## What Next` section after Output Contract
- Bump version 1.0.0 → 1.1.0

### Step 4: Update `skills/pipeline/roster-run.md`

- Make `/roster-question` → `/roster-research` → `/roster-intake` the **mandatory** standard route — roster-run always starts with question
- Add `## What Next` section (it's an entry point, so What Next = roster-intake or roster-investigate depending on routing)
- Bump version

### Step 5: Update remaining 10 skills (use arc graph above for When to Go Back)

For each: add `## When to Go Back` + `## What Next` + bump minor version.

Skills: roster-plan, roster-implement, roster-review, roster-qa, roster-ship, roster-investigate, roster-audit, roster-init, roster-skill-health, roster-skill-evolve

### Step 6: Add `roster/` to `.gitignore`

```bash
echo "\n# roster per-task artifacts (ephemeral)\nroster/" >> .gitignore
```

### Step 7: Rebuild index

```bash
npm run build:index
```

### Step 8: Update AGENTS.md

Add to the Skills table:
| roster-question | pipeline | Decompose task into neutral research questions (blind research prep) |
| roster-research | pipeline | Blind documentarian research — reads questions only, produces file:line grounded research |

## Standard "What Next" block format

Place this at the end of each skill's Output Contract section:

```markdown
## What Next

**Primary path:** `/roster-<next>`
**Alternatives:**
- `/roster-<alt>` — <when to use>

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.
```

## Standard "When to Go Back" block format

Place this before the Friction Log section:

```markdown
## When to Go Back

| Condition | Action |
|---|---|
| <condition> | Stop — re-run `/roster-<skill>` |
| <condition> | Stop — re-run `/roster-<skill>` |
```

## Quality Gates

```bash
# Verify index rebuilt
npm run build:index

# Verify new skills appear in index
node -e "const i = require('./index.json'); console.log(Object.keys(i.skills).filter(k => k.includes('roster-')))"
```

## Points of attention for review

- roster-research blindness rule must be unambiguous — no exceptions
- When to Go Back conditions must match the arc graph exactly
- All 12 skills must have both sections (none missed)
- Version bumps: new skills = 1.0.0, modified = minor bump
