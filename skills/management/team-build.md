---
description: Apply an approved team proposal — installs agents, rules, and skills into the shared harness.
version: 1.0.0
---

# Team Build

Apply an approved team proposal to the project harness. This is the install step that follows a validated `/recruit` proposal.

## Prerequisites

1. A validated team proposal must exist at `docs/team-proposal-<YYYY-MM-DD>.md`.
   - If no proposal file is found, stop: "No approved proposal found. Run `/recruit` first to generate and validate one."
2. The proposal must have passed the recruiter validation quiz — confirm this before proceeding.

## Steps

1. **Locate the proposal** — find the most recent `docs/team-proposal-*.md`. If multiple exist, list them and ask the user to confirm which to apply.

2. **Run harness-builder build** — output a spawn request:

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

3. **Confirm install** — after harness-builder returns, verify:
   - `.harness/harness.json` is updated
   - runtime projection files exist (`.claude/agents/`, `.claude/commands/` for Claude Code)
   - run `npm run check:agents` in the roster repo if available

4. **Report** — tell the user:
   - what was installed
   - what runtime surfaces were projected
   - recommended next step (`/team-run <task>` to start using the team)

## Rules

- never apply a proposal that has not passed the validation quiz
- never silently overwrite local tuning — merge or flag conflicts
- if the harness-builder reports coherence failures, do not mark install as complete
