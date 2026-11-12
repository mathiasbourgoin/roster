---
name: roster-usage
description: "Use only when the user explicitly requests a local usage report or invokes /roster-usage."
when_to_use: "Explicit manual usage reporting; never suggest or run automatically."
version: 1.0.0
domain: workflow
phase: null
preamble: false
friction_log: false
disable-model-invocation: true
allowed_tools: [Read, Bash]
human_gate: none
artifacts:
  reads: [skills-meta/cost.jsonl, .harness/.local/usage.jsonl]
  writes: []
---

# Roster Usage

Produce a local report only on explicit user invocation. Do not install hooks, offer
telemetry, add reminders, download collectors or run this skill at pipeline boundaries.

## Steps

1. Read `.harness/harness.json` if present. Resolve the trusted runtime at
   `.harness/bin/roster-usage.cjs`, or `scripts/roster-usage.cjs` in a Roster checkout.
   If unavailable, report the stale installation without fetching a substitute.
2. Invoke `node <runtime> report` in the requested project. Default sources are only
   `skills-meta/cost.jsonl` and `.harness/.local/usage.jsonl` in that project. Use
   repeatable `--project <directory>` or `--input <jsonl-file>` only for explicitly
   selected sources. Never scan home directories, sessions or transcripts.
3. Present totals with provenance and coverage. Null means unknown, not zero. Preserve
   separate scopes when overlap prevents a reliable combined total. Explain that
   reported costs are supplied observations, not a pricing calculation or savings proof.
   Claude Code, Codex, OpenCode and Pi use the same normalized input contract; tool
   support does not imply a native collector exists for every runtime.
4. Refer to `.harness/roadmap/usage-schema.md` and `usage-reports.md` for input shapes
   (source checkout: `schema/usage-report-schema.md`, `docs/usage-reports.md`). Keep
   raw records local. Sharing or posting a report requires its own explicit instruction.

## When to Go Back

On malformed input or ambiguous provenance, report the failure or unknown aggregate.
Do not repair source observations, invent measurements or silently add other inputs.

## What Next

Return the requested report. No collection configuration, commit, send or follow-up
telemetry prompt is implied.
