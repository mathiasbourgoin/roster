---
name: fast-optimization
type: spec
status: live
feature: fast pipeline efficiency
date: 2026-10-22
version: 1.0.0
---

# Spec — Fast pipeline efficiency

## Invariants

- Fast retains its baseline and final complete implementation gates, independent review, and independent QA.
- Between edits, Fast runs the narrowest declared check for the changed unit rather than repeating the complete suite.
- Fast records final and focused commands, exit codes, durations, and avoided repeat count in its implementation brief.
- Missing gate evidence or an edit after final verification requires the complete gates again.

## Measurement

Compare `avoided_repeated_full_gate_runs`, focused-check duration, and the existing ship cost snapshots for Fast tasks before and after this change. Quality remains measured by review and QA verdicts and regressions.
