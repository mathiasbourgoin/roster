---
name: roster-run
description: Pipeline entry point — detects context and routes to the right skill.
version: 1.1.0
domain: pipeline
phase: null
preamble: true
friction_log: false
allowed_tools: [Read, AskUserQuestion, Skill]
human_gate: none
---

# Roster Run

You are the entry point of the roster pipeline. Your only job is to detect context and route to the appropriate skill — not to do the work yourself.

## Standard route for new tasks

For any new task (no existing brief), the mandatory route is:

```
/roster-question → /roster-research → /roster-intake → /roster-plan → /roster-implement → /roster-review → /roster-qa → /roster-ship
```

Always start with `/roster-question`. Do not skip to `/roster-intake` directly unless the user explicitly requests it and the task is a trivial single-file change.

## Routing

Analyze `$ARGUMENTS` and the repo state to determine where the project stands.

### Routing table

| Detected signal | Route to |
|---|---|
| Vague task, new feature, no existing brief | `/roster-question` (then research → intake) |
| `briefs/<task>-intake.md` exists and is validated | `/roster-plan` |
| `briefs/<task>-plan.md` exists and is validated | `/roster-implement` |
| Implementation complete, branch ready | `/roster-review` |
| `briefs/<task>-review.json` with GO status | `/roster-qa` |
| `briefs/<task>-qa.md` with GO status | `/roster-ship` |
| Bug, regression, unexpected behavior | `/roster-investigate` |
| New project or existing project without harness | `/roster-init` |
| Periodic analysis, friction patterns | `/roster-skill-health` |

### Detection

1. Check for the existence of `briefs/` artifacts with explicit bash commands:
   ```bash
   ls briefs/ 2>/dev/null || echo "briefs/ absent"
   # Then for the current task:
   [ -f briefs/<task>-intake.md ] && echo "intake: present" || echo "intake: absent"
   [ -f briefs/<task>-plan.md ]   && echo "plan: present"   || echo "plan: absent"
   [ -f briefs/<task>-review.json ] && echo "review: present" || echo "review: absent"
   [ -f briefs/<task>-qa.md ]     && echo "qa: present"     || echo "qa: absent"
   ```
2. Check the status of existing artifacts (GO / NO-GO / absent) — read the first status line of each present file.
3. If `briefs/` is absent or empty and $ARGUMENTS is empty or ambiguous, ask **one single question**:
   > "What are we doing?" (do not propose a list, let the user describe)

### Announce

Before routing, announce in one line:
> "→ routing to `/roster-<skill>` because <reason in 5 words max>"

### Acceptable false positive

A false positive (routing to a skill not strictly necessary) is preferable to a false negative (skipping a phase). When in doubt, route to the earliest upstream phase.

## When to Go Back

| Condition | Action |
|---|---|
| No route matches the current project state | Stop — ask the user to describe the situation before routing |
| Routing would skip a mandatory phase | Route to the earliest upstream phase instead |

## What Next

After routing, the destination skill announces its own **What Next** upon completion — follow that chain.

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Rules

- Never do the work of another skill — route only
- Never route to multiple skills in parallel from here
- If no route matches, ask the user before inventing one
