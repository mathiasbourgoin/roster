---
name: roster-advisor
description: "Use when a task would benefit from targeted direction from an available stronger adviser, relative to the task and observed capabilities."
when_to_use: "Use for targeted direction after orientation and before consequential design, when stuck or changing approach, or before complex completion; e.g. '/roster-advisor <question>'."
version: 1.0.0
domain: workflow
phase: null
preamble: false
friction_log: false
allowed_tools: [Read, Bash, Glob, Grep, Agent]
human_gate: none
tunables:
  model: auto
  profile: auto
  route: auto
  objective: balanced
  wait_seconds: 60
artifacts:
  reads: []
  writes: []
---

# Roster Adviser

## Steps

1. Read `.harness/roadmap/executor-advisor.md` (source checkout: `docs/executor-advisor.md`) before
   consulting. Resolve user choices and tunables by its precedence rules. `profile` means an
   observed runtime-supported configuration, not a provider preset.
2. Frame one focused question with relevant evidence, constraints, and the decision it informs.
   Inspect available model/capability metadata; do not label any model universally strongest.
3. Check only the permissions needed by the observed route: local delegation does not imply
   cross-session powers, messaging an existing session does not require create permission, and a
   new session does. If a required capability is unavailable or unknown, explain that no adviser
   was consulted; a sequential route cannot consult the current agent itself. If the owner's
   constraints require advice, return blocked. Never silently substitute an exact model request.
4. Bound waiting to `wait_seconds` (default 60, never above the parent task's bound); timeout only
   ends waiting, not the consultation. Return concise advice, evidence/limitations, requested
   child model/source, observed actual model/source (or `unknown`), and next action. Surface
   conflicting advice and source/test evidence for reconciliation; do not treat advice as
   authority, independent review, or approval. The parent owns follow-up.

## Protocol

See `.harness/roadmap/executor-advisor.md` for route semantics, accepted-assignment authority, leaf-role
limits, compact handoffs, interruption recovery, and resource-analysis reuse.

## When to Go Back

If the required route or model is unavailable, return the missing capability or conflict. If
advice conflicts with evidence, present both for the parent to reconcile.

## What Next

Return the bounded advice and evidence to the caller; the parent decides whether to act.
