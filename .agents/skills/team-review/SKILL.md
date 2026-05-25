---
name: team-review
description: Audit the installed team against the current project and roster — surfaces stale agents, gaps, and upgrade candidates.
version: 1.0.0
---

# Team Review

Audit the currently installed team. Equivalent to running recruiter Mode 2 (Team Audit & Upgrade) plus a harness coherence check.

## Prerequisites

1. An installed team must exist (`.harness/harness.json` or `.claude/agents/`).
   - If none found, stop: "No installed team found. Run `/recruit` to assemble one."

## Steps

1. **Read current harness state** — check `.harness/harness.json` (or `.claude/harness.json` if legacy). Note installed agents, versions, and last-modified dates.

2. **Run recruiter Mode 2** — output a spawn request:

```
SPAWN REQUEST
Mode: B — human-mediated
Agent: recruiter
Role: Team Audit & Upgrade (Mode 2)

--- PASTE THIS AS THE AGENT'S INITIAL PROMPT ---
/recruit

Existing harness found at .harness/ (or .claude/agents/). Run Mode 2: Team Audit & Upgrade.

Audit the current team against the roster index and current project state. Report:
- agents that are stale (> 365 days or newer version available)
- role gaps not covered by the current team
- redundant agents (two agents for the same role)
- pipeline_role coherence (missing input/output contracts)
- any agent missing from the installed team that the project now needs

Propose an upgrade set and run the validation quiz before making any changes.
--- END ---
```

3. **Harness coherence check** — separately, run `npm run check:agents` in the roster repo if available, to confirm no agent in the roster is missing required metadata.

4. **Report** — after recruiter returns findings, summarize:
   - what's stale and what the upgrade path is
   - any gaps
   - recommended next step (`/team-build` to apply an upgrade, or no action needed)

## Rules

- never modify the harness without running the recruiter validation quiz first
- if recruiter is itself stale, flag it — it should be upgraded before auditing the rest of the team
