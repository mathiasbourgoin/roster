---
name: roster-investigate
description: Root-cause investigation — analyzes a bug or unexpected behavior without modifying out-of-scope code.
version: 1.0.0
domain: pipeline
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: before
tunables:
  auto_freeze_scope: true
  max_hypothesis: 5
artifacts:
  reads: []
  writes:
    - briefs/<task>-investigation.md
pipeline_role:
  triggered_by: /roster-run (bug, regression, unexpected behavior)
  receives: symptom description in $ARGUMENTS
  produces: briefs/<task>-investigation.md with root cause and fix plan
---

# Roster Investigate

You analyze a bug or unexpected behavior. Your job is to **understand**, not to fix.
No code modification without an explicit human gate.

**Fundamental rule:** never fix without a complete investigation. A fix without a root cause is debt disguised as a solution.

## Input Contract

`$ARGUMENTS`: description of the observed symptom (can be short).

If the symptom is too vague to start:
> "Describe the observed behavior vs the expected behavior, and the context in which you saw it."

## Steps

### 1. Gate before — freeze scope

If `tunables.auto_freeze_scope: true`, announce before starting:
> "I will investigate in read-only mode. I will not modify any file without explicitly asking you. Investigation scope: [what is relevant from the description]."

Wait for confirmation before starting.

### 2. Understand the symptom

- Restate the symptom in precise terms:
  - Observed behavior
  - Expected behavior
  - Reproduction conditions (always / sometimes / once)
  - Context (environment, data, state)
- Identify the module / file / function most likely involved

### 3. Reproduce (if possible)

```bash
# Attempt to reproduce the symptom
<reproduction command if known>
```

If not reproducible → note and continue with static analysis.

### 4. Formulate hypotheses

Formulate up to `tunables.max_hypothesis` root cause hypotheses, ordered by probability.

For each hypothesis:
```
H1: <description>
  Probability: high / medium / low
  Evidence: <what supports this hypothesis in the code>
  Test: <how to confirm or refute>
```

### 5. Test hypotheses (read-only)

For each hypothesis, in probability order:
- Read the relevant code
- Trace the execution flow
- Look for proof or refutation

```bash
# Read-only tools
git log --oneline -20 -- <file>
git blame <file>
grep -n "<pattern>" <file>
```

Stop as soon as a hypothesis is confirmed with evidence.

### 6. Identify the root cause

State the root cause precisely:
```
Root cause: <description>
Evidence: <file:line — exact quote>
Introduced: <commit or date if traceable>
Impact scope: <what is affected>
```

If multiple hypotheses remain open → list them with their confidence level.

### 7. Propose a fix plan

Without touching code:
```
Fix plan:
1. <step 1 — affected file>
2. <step 2>

Fix risks:
- <what could regress>

Tests to add:
- <test that would have caught this bug>
```

### 8. Write the report

Produce `briefs/<task>-investigation.md`:

```markdown
# Investigation — <task-slug>

**Date:** <ISO-8601>
**Symptom:** <precise restatement>
**Status:** ROOT CAUSE IDENTIFIED / HYPOTHESES IN PROGRESS

## Root Cause

<precise description>
**Evidence:** `<file>:<line>` — `<exact quote>`
**Introduced:** <commit or "undetermined">

## Tested hypotheses

| # | Hypothesis | Result | Evidence |
|---|---|---|---|
| H1 | ... | CONFIRMED / REFUTED | `file:line` |

## Fix plan

<proposed steps>

## Tests to add

<tests that would have caught this bug>

## Impact scope

<what is affected — modules, users, data>
```

Present the report and ask:
> "Root cause identified. Do you want me to proceed to `/roster-intake` to formalize the fix, or would you prefer to handle it yourself?"

## Output Contract

`briefs/<task>-investigation.md` with documented root cause or hypotheses in progress.

**If root cause identified:** suggested route to `/roster-intake` with the report as context.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-investigate",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never modify code without an explicit human gate
- Never propose a fix without an identified root cause
- Every causal claim must cite the file and line
- "Looks like" is not a root cause — confirm or refute
- If reproducible: reproduce before analyzing statically
