---
name: team
description: Build, review, or run the installed agent team via one dispatch skill.
when_to_use: "Use to apply a team proposal, audit installed agents, or kick off a pipeline task. Trigger: '/team', 'apply the team proposal', 'audit my team', 'run the team on X'."
version: 1.0.3
domain: workflow
phase: null
preamble: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: before
pipeline_role:
  triggered_by: human
  receives: $ARGUMENTS — mode (build | review | run <task>)
  produces: harness changes (build), audit report (review), or pipeline execution (run)
---


# Roster Preamble

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction: present the recommendation,
explain why, state what context you might be missing, and ask — never act unilaterally.

### Escalation

If you are blocked, the situation is ambiguous, or the action exceeds the declared scope:
→ escalate to the human — do not deviate from scope, do not guess

### Asking Questions

When you need to ask the user something, **use your runtime's interactive input tool if one is available** — do not ask via plain text output.

Known runtime tool names:

| Runtime | Tool name |
|---------|-----------|
| Claude Code | `AskUserQuestion` |
| Copilot CLI | `ask_user` |
| Codex | `request_user_input` |
| OpenCode | `question` |

Rules:
- One question at a time — never bundle multiple questions into one message
- Prefer multiple-choice options over open-ended when the answer space is predictable
- If no interactive tool is available, output a clearly marked plain-text question and wait for the user's reply before proceeding


# Team

Manage the installed agent team.

## Steps

1. Detect the mode from `$ARGUMENTS`:
   - `team build` — apply an approved team proposal to the harness
   - `team review` — audit the installed team for gaps, staleness, and redundancy
   - `team run <task>` — start the full pipeline on a task via tech-lead
2. If `$ARGUMENTS` is empty or not one of the above, ask once:
   > "Which mode? `build` (apply proposal), `review` (audit team), or `run <task>` (execute pipeline)"
3. Execute the matching mode section below: **build**, **review**, or **run**.

---

## Mode: build

Apply an approved team proposal to the project harness. This is the install step that follows a validated `/recruit` proposal.

### Prerequisites

1. A validated team proposal must exist at `docs/team-proposal-<YYYY-MM-DD>.md`.
   - If no proposal file is found, stop: "No approved proposal found. Run `/recruit` first."
2. The proposal must have passed the recruiter validation quiz — confirm before proceeding.

### Steps

1. **Locate the proposal** — find the most recent `docs/team-proposal-*.md`. If multiple exist, list and ask the user to confirm which to apply.

2. **Spawn harness-builder** — output a spawn request:

```
SPAWN REQUEST
Mode: B — human-mediated
Agent: harness-builder
Role: apply approved team proposal to shared harness

--- PASTE THIS AS THE AGENT'S INITIAL PROMPT ---
/harness build

An approved team proposal exists at <path-to-proposal>. Apply it:
- install agents listed in the proposal into .harness/agents/
- install rules listed in the proposal into .harness/rules/
- install skills listed in the proposal into .harness/skills/
- update .harness/harness.json manifest
- run sync-harness.sh to project runtime entrypoints (Claude Code, Codex)
- run coherence checks after install
--- END ---
```

3. **Report** — after harness-builder completes, confirm what was installed and run `npm test` if in the roster repo.

---

## Mode: review

Audit the currently installed team. Equivalent to recruiter Mode 2 (Team Audit & Upgrade) plus a harness coherence check.

### Prerequisites

An installed team must exist (`.harness/harness.json` or `.claude/agents/`).
- If none found, stop: "No installed team found. Run `/recruit` to assemble one."

### Steps

1. **Read current harness state** — check `.harness/harness.json`. Note installed agents, versions, and last-modified dates.

2. **Spawn recruiter Mode 2** — output a spawn request:

```
SPAWN REQUEST
Mode: B — human-mediated
Agent: recruiter
Role: Team Audit & Upgrade (Mode 2)

--- PASTE THIS AS THE AGENT'S INITIAL PROMPT ---
/recruit

Existing harness found at .harness/. Run Mode 2: Team Audit & Upgrade.

Audit the current team against the roster index and current project state. Report:
- agents that are stale (> 365 days or newer version available)
- role gaps not covered by the current team
- redundant agents (two agents for the same role)
- pipeline_role coherence (missing input/output contracts)
- any agent missing from the installed team that the project now needs

Propose an upgrade set and run the validation quiz before making any changes.
--- END ---
```

3. **Harness coherence check** — separately run `npm run check:agents` in the roster repo if available.

4. **Report** — summarize stale agents, gaps, and recommended next step (`team build` to apply, or no action needed).

---

## Mode: run \<task\>

Start the agent pipeline on a task via tech-lead.

### Prerequisites

1. Confirm a team is installed: check `.harness/harness.json` for an installed lead agent.
   - If none, stop: "No team found. Run `/recruit` first."
2. Confirm `tech-lead` is in the installed team. If missing, stop and report.

### Steps

1. **Intake check** — if the task is fuzzy or high-stakes, run the diagnostic interview (per `rules/governance/diagnostic-interview.md`) before proceeding.

2. **Spawn tech-lead** — output a ready-to-use spawn request:

```
SPAWN REQUEST
Mode: B — human-mediated sequential
Agent: tech-lead
Role: research, plan, and coordinate delivery of the task

--- PASTE THIS AS THE AGENT'S INITIAL PROMPT ---
Task: <task from $ARGUMENTS>

Run the research phase, produce a brief, validate it with the user, then spawn the planner.
--- END ---
```

3. **State the pipeline** — tell the user:
   - tech-lead produces a research brief and runs a validation quiz before anything is built
   - after the quiz, they spawn the planner with the brief content
   - implementers, reviewer, and QA follow after the planner produces sub-briefs
   - each handoff requires the user to relay output to the next agent

4. **Stay available** — remain available for merge decisions, escalations, and context routing at each pipeline stage.

### Rules

- Never proceed without a confirmed lead agent
- Never imply autonomous agent-to-agent handoff
- If task is blank, ask once; if still blank, stop

## When to Go Back

| Condition | Action |
|---|---|
| No approved team proposal exists (build mode) | Stop — run `/recruit` first |
| No team installed (review or run mode) | Stop — run `/recruit` to assemble one |
| `tech-lead` missing from installed team (run mode) | Stop — flag to human, re-run `/recruit` to add it |

## What Next

- **build** → run `/team review` to verify the installed team, then start tasks with `/team run <task>`
- **review** → run `/team build` to apply proposed upgrades, or no action if team is healthy
- **run** → follow the pipeline handoffs as instructed by tech-lead
