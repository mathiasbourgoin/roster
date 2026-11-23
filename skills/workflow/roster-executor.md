---
name: roster-executor
description: "Use for a bounded task that can be completed by an available economy-tier worker while preserving the parent task's checks and ownership."
when_to_use: "Use when delegating a bounded implementation or research contribution to an available economy-tier worker; e.g. '/roster-executor <mission>'."
version: 1.0.0
domain: workflow
phase: null
preamble: false
friction_log: false
allowed_tools: [Read, Write, Edit, Bash, Glob, Grep, Agent]
human_gate: none
tunables:
  model: auto
  profile: auto
  route: auto
  objective: cost
  wait_seconds: 60
artifacts:
  reads: []
  writes: []
---

# Roster Executor

## Steps

1. Read `.harness/roadmap/executor-advisor.md` (source checkout: `docs/executor-advisor.md`) before
   dispatch. Resolve user choices and tunables by its precedence rules. `profile` means an
   observed runtime-supported configuration, not a provider preset.
2. Confirm the bounded goal fits the available worker's observed capabilities and that the
   requested route is permitted. Treat unavailable identity or permission as unknown; do not
   guess. Exact unavailable model requests stop without substitution.
3. Use the existing resource-analysis guide where comparison is relevant. Do not alter an
   accepted model assignment or pipeline gate. Express Lite never spawns.
4. Send one compact mission with stable task/mission and attempt identity, goal, permitted writes,
   scope, current state, inputs, checks/evidence, durable destination in existing plan/notes, and
   return format including next action. Bound waiting to `wait_seconds` (default 60, never above
   the parent task's bound); timeout only ends waiting, not the attempt. Parent coordinates
   follow-up and reconciles interrupted work before any duplicate dispatch.
5. Return the contribution with evidence, check results, requested model, observed actual model
   and source (or `unknown`), and unresolved risks. The parent verifies and integrates it.

## When to Go Back

If the mission scope, permissions, or exact-model requirement cannot be satisfied, return the
specific conflict to the parent before dispatch.

## What Next

Return the contribution and durable evidence to the parent for verification and integration.
