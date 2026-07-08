---
name: roster-plan
description: Dual-voice decomposition — reads the intake brief, produces per-role sub-briefs.
version: 1.3.2
domain: pipeline
phase: plan
preamble: true
friction_log: true
allowed_tools: [Read, Write, Agent, AskUserQuestion]
human_gate: after
artifacts:
  reads:
    - briefs/<task>-intake.md
    - briefs/<task>-spec.md (feature/api-change: status gate only)
    - briefs/<task>-formal-triage.md (critical route: mode signal only)
  writes:
    - briefs/<task>-plan.md
    - briefs/<task>-plan.json
    - briefs/<task>-implementer.md
    - briefs/<task>-reviewer.md
    - briefs/<task>-qa-scope.md
pipeline_role:
  triggered_by: /roster-intake with validated brief
  receives: briefs/<task>-intake.md (single decomposition source; spec/formal-triage consulted as gates, not mined)
  produces: per-role sub-briefs + sequenced plan
---

# Roster Plan

You decompose a validated brief into executable sub-briefs. The brief is your single source of truth — what it does not say does not exist for you.

**Token discipline:** precise decomposition. No invention beyond the brief.

## Input Contract

Read `briefs/<task>-intake.md` **in full** before doing anything.

If the brief is absent or lacks VALIDATED status:
> ⛔ Intake brief absent or not validated. Re-run `/roster-intake` first.

If required sections are missing (Goal, Scope Boundary, Relevant Files, Quality Gates):
> ⛔ Incomplete brief — missing section(s): <list>. Complete the brief before planning.

If `**Type:**` is `feature` or `api-change`, verify the spec artifact:
```bash
[ -f briefs/<task>-spec.md ] && grep -q 'Status.*VALIDATED\|Status.*SKIPPED' briefs/<task>-spec.md && echo "spec: ready" || echo "spec: missing"
```
If absent or not VALIDATED/SKIPPED:
> ⛔ Feature/api-change task requires a spec. Run `/roster-spec` first.

## Steps

### 0. KB ambiguity pre-check (conditional)

```bash
[ -d kb ] && ([ -f kb/spec.md ] || [ -f kb/index.md ]) && echo "KB present" || echo "KB absent"
```

If KB is **present**: invoke `skills/kb/ambiguity-auditor.md`.
- **Critical** findings: present to human — "Fix KB first, or continue knowing these risks?" If "fix first": STOP. If "continue": annotate the plan's "Identified risks" table.
- Warnings/Info: log in "Identified risks". Continue.
- No findings: continue silently.

If KB is **absent**: skip silently.

### 1. Read the brief

Read `briefs/<task>-intake.md` in full. Extract: goal and scope boundary, files involved, exact quality gates, unresolved open questions.

### 2. Dual-voice: two independent analyses

Run **sequentially** two independent analyses.

**Decomposition shape — prefer vertical slices.** Each step should be a thin end-to-end slice delivering one capability through every layer it touches (data → logic → interface), not a horizontal layer ("all schema", then "all endpoints"). A vertical slice is independently demoable and testable when it lands; a horizontal layer hides integration risk until the end. Both voices should flag a layered plan.

#### Voice 1 — Claude sub-agent (fresh context)

Spawn a sub-agent with this exact prompt (do not inject conversation context):

```
You are a software architect. You are given a task brief.
You must propose a decomposition plan in sequential steps.

Be adversarial: look for unverified assumptions, hidden dependencies,
implementation risks, and edge cases not covered by the brief.
Do not compliment the brief — find its flaws.

Brief:
<full content of briefs/<task>-intake.md>

Produce:
1. Sequenced plan (numbered steps with dependencies)
2. Assumptions you had to make (what the brief does not clearly state)
3. Identified risks
4. Questions you would ask before starting
```

#### Voice 2 — Second model or adversarial fallback

**If a second model (codex, o3, etc.) is available:** run the same analysis via that model.

**If not available:** spawn a second Claude sub-agent with this prompt:

```
You are a skeptical senior engineer asked to challenge an implementation plan.
Your role: find why this plan will fail.

Starting assumption: the plan is too optimistic.
- What is not said in the brief but will cause problems?
- Which dependencies will break?
- Where is the real risk (not the apparent risk)?
- What will take 3x longer than expected?

Brief:
<full content of briefs/<task>-intake.md>

Do not propose an alternative plan — only give argued objections.
```

### 3. Consensus table

```markdown
## Consensus Table

| Point | Voice 1 | Voice 2 | Status |
|---|---|---|---|
| Step 1: <description> | ✅ | ✅ | AGREE |
| Risk: <description> | ⚠️ | ✅ | AGREE |
| Approach for X | Option A | Option B | DISAGREE |
| Direction on Y | Keep | Change | USER-CHALLENGE |

Statuses:
- AGREE: both voices converge → auto-decided
- DISAGREE: disagreement on approach → present both options to the human
- USER-CHALLENGE: both voices recommend changing the brief's direction → NEVER auto-decided
```

**USER-CHALLENGE rule:** present the recommendation, explain why both analyses converge, state what context may be missing, and ask — never act.

### 4. Resolve DISAGREE items

For each DISAGREE, present both options with each voice's reasoning and a recommendation if one is clearly better. Wait for the decision before continuing.

### 5. Write the plan

Produce `briefs/<task>-plan.md`:

```markdown
# Plan — <task-slug>

**Date:** <ISO-8601>
**Status:** DRAFT

## Sequential steps

1. **<step>** — <description, files involved, completion criterion>
2. **<step>** — ...

## Dependencies

<Step N must precede step M because ...>

## Identified risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|

## Decisions made

| Point | Decision | Reason |
|---|---|---|

## Assumptions

<What was assumed because the brief did not specify it>
```

### 6. Write sub-briefs

**`briefs/<task>-implementer.md`** — for `/roster-implement`: goal, scope boundary, files to modify with snippets, sequential steps, exact quality gates, risks and assumptions from voices.

**`briefs/<task>-reviewer.md`** — for `/roster-review`: what was implemented, files to audit first, identified risks to verify, expected behaviors to confirm.

**`briefs/<task>-qa-scope.md`** — for `/roster-qa`: exact quality gates with commands, behaviors to validate, TUI scenarios if in scope.

### 7. Human validation quiz

Write the full plan to `briefs/<task>-plan.md` first, then run the quiz per `human-validation.md`. Present 3 questions in uniform format (do not label by type):

1. **Comprehension** — the ordering or dependency between the two highest-risk steps; can only be answered by someone who read the plan.
2. **Clarification** — an implicit decision (batching order, rollback strategy, migration approach) that must be made explicit; the user's answer is binding — update the plan accordingly.
3. **Consistency-check** — a deliberately wrong recommendation targeting the highest-risk step (e.g. suggest doing the dangerous step last, or skipping an irreversible gate). Phrase as a plausible option; format identically to the other questions.

Gate on `human-validation.md` rules: comprehension must be answered correctly (offer one clarification, re-ask once), clarification must produce an explicit decision, consistency-check must not be confirmed unchallenged. Wait for answers before finalizing sub-briefs.

### 8. Final human gate

Present the sub-briefs with their paths. Request validation before spawning execution agents. After approval, set `**Status:** VALIDATED` in `briefs/<task>-plan.md` **and** in each sub-brief — the Output Contract and roster-run's routing both key on a validated plan.md.

### 8.5. Write plan JSON (after VALIDATED only)

After approval, write `briefs/<task>-plan.json` atomically:

1. **Detect critical mode:**
```bash
[ -f briefs/<task>-formal-triage.md ] && TASK_MODE="critical" || TASK_MODE="<mode from intake brief>"
```
Use `$TASK_MODE` as the `"mode"` field. File existence is the signal — applies to both full triage briefs and minimal placeholder briefs from `--critical=rocq`/`--critical=quint`.

2. Build the JSON:
```json
{
  "task": "<slug>",
  "mode": "express|fast|full|critical",
  "schema_version": "1.0",
  "steps": [
    {
      "id": "step-N",
      "skill": "<skill-name>",
      "inputs": ["<artifact-path>"],
      "outputs": ["<artifact-path>"],
      "hook": true
    }
  ],
  "quality_gates": {
    "build": "<exact build command or empty string>",
    "test": "<exact test command or empty string>",
    "lint": "<exact lint command or empty string>"
  }
}
```

3. For each `step.hook`: `true` if `.harness/hooks/skills/<skill>/pre.md` or `post.md` exists; `false` otherwise.
4. Missing quality gate commands: use `""` (never null, never omit the key).
5. Write atomically: write to `briefs/<task>-plan.json.tmp`, then rename. An interrupted write leaves only the `.tmp` (treated as absent by downstream consumers).

## Output Contract

- `briefs/<task>-plan.md` (VALIDATED)
- `briefs/<task>-plan.json` (machine-readable plan, atomic `.tmp`-then-rename write)
- `briefs/<task>-implementer.md` (VALIDATED)
- `briefs/<task>-reviewer.md` (VALIDATED)
- `briefs/<task>-qa-scope.md`

**Next:** `/roster-implement` reads `briefs/<task>-implementer.md`.

## When to Go Back

| Condition | Action |
|---|---|
| Brief has unresolvable ambiguity or missing required sections | Stop — re-run `/roster-intake` |
| Both voices agree the brief's direction should change | Stop — present to user, re-run `/roster-intake` if approved |
| KB has Critical contradictions and user chose to fix KB first | Stop — fix KB with `/ambiguity-auditor`, then re-run `/roster-plan` |

## What Next

**Primary path:** `/roster-implement` (reads `briefs/<task>-implementer.md`)
**Alternatives:** Re-run `/roster-intake` if the brief was incomplete.

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-plan",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- The brief is the single source of truth — do not read the codebase
- USER-CHALLENGE is never auto-decided — always present to the human
- Do not spawn execution agents — produce sub-briefs only
- If a plan step is not covered by the brief → note as assumption, do not invent
- Sub-briefs must be self-contained: the receiving agent cannot assume access to the current context
