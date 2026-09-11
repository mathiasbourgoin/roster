---
name: roster-investigate
description: Analyzes a bug or unexpected behavior to find its root cause, read-only.
when_to_use: "Use when a failure is unclear, flaky, or ambiguous and needs diagnosis before any fix. Trigger: 'why does X fail', 'investigate'."
version: 1.4.0
domain: pipeline
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion]
isolation: fork
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


### Friction Log

**Write your entry when THIS phase ends — before you hand off, before you report, before you
stop.** Not at session end. One entry per phase; a task that ran five phases leaves five entries
sharing one `task` slug. Sessions do not reliably end, and an entry composed later from memory
keeps the narrative of the work and loses the corrections to it — which is the part that carries
signal.

Record honestly:
- **frictions** — workarounds, long searches, ambiguities, and every place a confident conclusion
  of yours was later refuted. A user correction is the highest-value entry there is; write it.
- **classes** — the closed vocabulary below, most load-bearing first.
- **methods** used, and any suggestion for a tool, skill, or adaptation.
- **skipped** — any mandated step this phase did not perform, as `"<step>: <reason>"`. A skipped
  step that goes unrecorded is indistinguishable from a step that ran. Omit the key if nothing
  was skipped; never omit it *instead of* admitting a skip.

A run with nothing to report is a **clean run**: `"frictions": []` and `"classes": []`. Log it.
Clean runs are the denominator — without them no rate can be computed, and "zero clean runs" is
then an artefact of the log rather than a fact about the work.

This is not a performance review. It is cross-run memory.

Canonical entry template (append to `skills-meta/friction.jsonl`; set `"skill"` to your
skill's name — extra documented fields like `class_note`, `event` or `mode` are allowed):

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",
  "task": "<task-slug>",
  "frictions": [],
  "classes": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

**Friction classes — closed vocabulary.** Pick by *remedy*, not by symptom:

`gate-vacuous` (a check passed while checking nothing) · `evidence` (a conclusion asserted
without, or against, the evidence) · `process-bypass` (a mandated step not performed, absence
unrecorded) · `missing-artifact` (a referenced file absent, untracked, or not installed) ·
`stale-tooling` (tool present but stale/misbehaving) · `agent-isolation` (worktree or
shared-checkout boundary damage) · `parallel-collision` (concurrent agents contending) ·
`schema-drift` (two artifacts disagree about a shape, or a contract is undocumented at the call
site) · `scope` (scoped too narrowly/broadly, or duplicating delivered work) · `git-mechanics`
(a git/forge operation whose real result differs from its reported one) · `human-gate` (a human
decision unavailable, deferred, or handed back) · `runtime-limits` (session limit, compaction,
killed job, rejected tool arity) · `external-dep` (third-party service or machine unavailable) ·
`positive-signal` (**not** a friction — a gate that worked, a discovery; excluded from
clustering) · `other` (requires a non-empty `class_note`).

The list above is the contract — it is injected into this skill, so it is readable wherever this
skill runs. Do not invent values: use `other` plus a `class_note`, which is how the vocabulary
earns its next entry.

Full definitions, one canonical instance per class, and the classification rules live in the
roster source at `schema/skill-schema.md` → *Friction classes*, where the vocabulary is closed
and validated by `scripts/check-friction-shape.js --log`. **That path resolves in the roster
repo, not necessarily in an installed harness** — if it is absent here, the list above is
complete and authoritative on its own; nothing above depends on opening it.


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

When the symptom involves state or accounting, anchor on **ground-truth state** (the authoritative store, DB, or service), not on logs or intermediate reports — those record what was *attempted*, not the durable result, and can disagree with reality. Before theorizing, find the **empirical discriminator**: the smallest observable that separates a failing case from a passing sibling. A reproduction that looks correct may be the *wrong scenario* (wrong trigger, missing setup), not the absence of the bug.

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

Distinguish **code-confirmed** (the code provably supports the hypothesis when read) from **observed** (the symptom reproduced live). If the symptom is reproducible, do not stop at code-confirmed — confirm by observation: code-reading can be right about the mechanism yet wrong about the runtime effect.

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

**Persist what was learned (if a KB exists).** Before considering the investigation closed, fold the durable facts into the KB (`/kb-update` or hand them to `kb-agent`): the confirmed root cause **and** the hypotheses that were ruled out — so the next investigator does not re-walk the same dead-ends. A refutation is knowledge worth keeping, not just a discarded branch.

## When to Go Back

| Condition | Action |
|---|---|
| Root cause cannot be determined from code alone | Stop — report hypotheses to human, ask for more context or logs |
| Investigation reveals the bug is in an external dependency | Stop — report findings, do not attempt a fix in this run |

## What Next

**Primary path — a confirmed root cause is a Fast-mode task.** This report already produced what
question/research/spec produce, so route to **Fast**: `implement → review → qa → ship`
(`/roster-run` §modes). Announce the mode so it is recorded.

**`review` is not the optional part.** On 2026-08-26 a human said "corrige le" on a defect with
exactly this report in hand; the fix went straight to shipping and review was skipped. The human
caught it, not the ledger — nothing distinguished "not started" from "deliberately bypassed",
because no mode had been recorded. Skipping question/research/spec here is correct; skipping
review is not.

**Alternative:** `/roster-intake` — when the fix's scope is contested, or it changes a contract
**Alternatives:**
- `/roster-plan` — if root cause and fix are unambiguous and intake is not needed

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

Append one entry at phase exit — when this skill finishes, not at session end. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-investigate"`.

## Rules

- Never modify code without an explicit human gate
- Never propose a fix without an identified root cause
- Every causal claim must cite the file and line
- "Looks like" is not a root cause — confirm or refute
- If reproducible: reproduce before analyzing statically
