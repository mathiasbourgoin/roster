---
name: commit-telemetry
description: Prepare available, agent-reported local commit metadata without fabricating measurements or participants.
scope: global
category: workflow
version: 1.0.0
---

# Commit telemetry

Before any commit in a project with enabled `.harness/telemetry.json`, stage the intended
changes and prepare `.harness/.local/commit-report.json` using the installed
`.harness/bin/roster-telemetry.cjs` (`report <task>` creates a template, never overwrites one).
Refresh staged_tree using `git write-tree` after staging changes. Read the manifest version.

Use cumulative task elapsed_seconds/input_tokens/output_tokens measured by the runtime when
available, otherwise null. Input includes cached input without double counting. Never invent
zero, extrapolate from characters or claim an authenticated provider measurement. Preserve
measurement provenance locally; do not copy transcripts, prompts or secrets into metadata.

Record only actual participating agent role names (or null), actual express/fast/full mode
(or null), and formal status not-used/specified/verified/unavailable with backend null/rocq/quint.
Do not equate a planned team with participation, or a formal spec with successful verification.
Only claim verified from checker evidence tied to the candidate; it remains agent-reported.

For amend and same-task follow-up commits, retain cumulative totals without adding old values
twice. Respect disabled fields and explicit disable. Advisory telemetry is not a quality gate;
strict missing enabled measurements need real evidence or an explicit policy change by the owner.
Never bypass hooks to force a commit. `/roster-telemetry` controls settings and updates.
