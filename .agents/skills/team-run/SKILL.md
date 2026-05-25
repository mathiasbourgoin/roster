---
name: team-run
description: Run the agent team on a task — triggers tech-lead research → validation → planner → execution.
version: 1.0.0
---

# Team Run

Start the agent pipeline on `$ARGUMENTS`. If no task is provided, ask for one before proceeding.

## Prerequisites

Before starting:

1. Confirm a team is installed: check `.harness/harness.json` or `.claude/agents/` for an installed lead agent.
   - If no team is installed, stop: "No team found. Run `/recruit` first to assemble and install a team."
2. Confirm a `tech-lead` agent is in the installed team. If the lead role is missing, stop and report.

## Execution Model

You cannot spawn agents. The pipeline runs through human-mediated handoffs:

```
[you: tech-lead research] → [human validates brief]
→ [human: spawn planner]  → [planner: sub-briefs]
→ [human validates decomp] → [human: spawn implementers]
→ [implementers] → [reviewer] → [QA] → [you: merge decision]
```

Tell the user this upfront. Do not imply agents hand off autonomously.

## Steps

1. **Intake check** — if the task is fuzzy or high-stakes (team composition, architecture, scope, governance), run the diagnostic interview (per `rules/governance/diagnostic-interview.md`) before proceeding.

2. **Spawn tech-lead** — output a ready-to-use spawn request:

```
SPAWN REQUEST
Mode: B — human-mediated sequential
Agent: tech-lead
Role: research, plan, and coordinate delivery of the task

--- PASTE THIS AS THE AGENT'S INITIAL PROMPT ---
Task: $ARGUMENTS

Run the research phase, produce a brief, validate it with the user, then spawn the planner.
--- END ---
```

3. **State the pipeline** — tell the user:
   - tech-lead will produce a research brief and run a validation quiz before anything is built
   - after the quiz, they will need to spawn the planner with the brief content
   - implementers, reviewer, and QA follow after planner produces sub-briefs
   - each handoff requires the user to relay output to the next agent

4. **Stay available** — after spawning tech-lead, remain available for merge decisions, escalations, and context routing at each pipeline stage.

## Rules

- never proceed without a confirmed lead agent in the installed team
- never imply autonomous agent-to-agent handoff
- if the task is blank, ask once; if still blank, stop
