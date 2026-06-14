---
name: roster-plan
description: Dual-voice decomposition — reads the intake brief, produces per-role sub-briefs.
version: 1.3.0
domain: pipeline
phase: plan
preamble: true
friction_log: true
allowed_tools: [Read, Write, Agent, AskUserQuestion]
human_gate: after
artifacts:
  reads:
    - briefs/<task>-intake.md
  writes:
    - briefs/<task>-plan.md
    - briefs/<task>-plan.json
    - briefs/<task>-implementer.md
    - briefs/<task>-reviewer.md
    - briefs/<task>-qa-scope.md
pipeline_role:
  triggered_by: /roster-intake with validated brief
  receives: briefs/<task>-intake.md (single source of truth)
  produces: per-role sub-briefs + sequenced plan
---

# Roster Plan

You decompose a validated brief into executable sub-briefs. You have no research context — the brief is your single source of truth. What the brief does not say does not exist for you.

**Token discipline:** precise decomposition. No invention beyond the brief.

## Input Contract

Read `briefs/<task>-intake.md` **in full** before doing anything.

If the brief is absent or does not have VALIDATED status:
> ⛔ Intake brief absent or not validated. Re-run `/roster-intake` first.

If required sections are missing (Goal, Scope Boundary, Relevant Files, Quality Gates):
> ⛔ Incomplete brief — missing section(s): <list>. Complete the brief before planning.

If the intake brief `**Type:**` is `feature` or `api-change`, check for a spec artifact:
```bash
[ -f briefs/<task>-spec.md ] && grep -q 'Status.*VALIDATED\|Status.*SKIPPED' briefs/<task>-spec.md && echo "spec: ready" || echo "spec: missing"
```
If the spec artifact is absent or not VALIDATED/SKIPPED:
> ⛔ Feature/api-change task requires a spec. Run `/roster-spec` first.

## Steps

### 0. KB ambiguity pre-check (conditional)

```bash
[ -d kb ] && ([ -f kb/spec.md ] || [ -f kb/index.md ]) && echo "KB present" || echo "KB absent"
```

If KB is **present**:
→ Invoke `skills/kb/ambiguity-auditor.md` on the KB.
→ If the audit returns **Critical** findings: present them to the human and ask:
  - "These KB contradictions may corrupt the plan. Fix KB first, or continue knowing these risks?"
  - If "fix first": STOP — return to user.
  - If "continue": annotate the plan's "Identified risks" table with each contradiction.
→ If only Warnings/Info: log them in the plan's "Identified risks" table. Continue.
→ If no findings: continue silently.

If KB is **absent**: skip silently.

### 1. Read the brief

Read `briefs/<task>-intake.md` in its entirety. Read nothing else.

Extract:
- The goal and its scope boundary
- The files involved
- The exact quality gates
- Any unresolved open questions

### 2. Dual-voice: two independent analyses

Run **sequentially** two independent analyses of the plan.

**Decomposition shape — prefer vertical slices.** Each step/deliverable should be a thin
*end-to-end* slice that delivers one capability through every layer it touches (e.g. data → logic
→ interface), **not** a horizontal layer ("all the schema", then "all the endpoints", then "all the
UI"). A vertical slice is independently demoable and testable the moment it lands; a horizontal
layer is not finished until every other layer catches up, so it hides integration risk until the
end. This is about the *shape* of the work, not its size — slice by capability, sequence by
dependency. Both voices below should decompose this way and flag a plan that is layered instead.

#### Voice 1 — Claude sub-agent (fresh context)

Spawn a sub-agent with this exact prompt (do not inject the current conversation context):

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

**If a second model (codex, o3, etc.) is available:**
→ Run the same analysis via that model.

**If not available or on error:**
→ Spawn a second Claude sub-agent with this prompt (different — more adversarial):

```
You are a skeptical senior engineer. You are asked to challenge an implementation plan.
Your role: find why this plan will fail.

Starting assumption: the plan is too optimistic.
Questions to ask yourself:
- What is not said in the brief but will cause problems?
- Which dependencies will break?
- Where is the real risk (not the apparent risk)?
- What will take 3x longer than expected?

Brief:
<full content of briefs/<task>-intake.md>

Do not propose an alternative plan — only give argued objections.
```

### 3. Consensus table

Build a synthesis table:

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
- DISAGREE: disagreement on an approach → present both options to the human
- USER-CHALLENGE: both voices think the brief's direction should change → NEVER auto-decided
```

**USER-CHALLENGE rule:** if both analyses agree to change a direction from the brief:
- Clearly present the recommendation
- Explain why both analyses converge
- State what context might be missing
- Ask — never act

### 4. Resolve DISAGREE items

For each DISAGREE, present both options to the human with:
- Voice 1's position (and why)
- Voice 2's position (and why)
- Recommendation if one option is clearly better

Wait for the decision before continuing.

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

Produce one sub-brief per execution role:

**`briefs/<task>-implementer.md`** — for `/roster-implement`:
- Goal, scope boundary, files to modify with snippets
- Sequential steps from the plan
- Exact quality gates
- Points of attention from voices (risks, assumptions)

**`briefs/<task>-reviewer.md`** — for `/roster-review`:
- What was implemented (summary from the plan)
- Files to audit first
- Identified risks to verify
- Expected behaviors to confirm

**`briefs/<task>-qa-scope.md` (brief, not the report)** — for `/roster-qa`:
- Exact quality gates with commands
- Behaviors to validate
- If TUI scope: scenarios to test in tmux matrix

### 7. Human validation quiz

Before presenting the sub-briefs, run the quiz per the human-validation.md protocol. Write the full plan to `briefs/<task>-plan.md` first, then present the quiz — 3 questions, uniform format (do not label by type):

1. **Comprehension** — ask about the specific ordering or dependency between the two highest-risk steps. Can only be answered correctly by someone who read the plan.
2. **Clarification** — name an implicit decision in the plan (e.g. a batching order, a rollback strategy, a data migration approach) that must be made explicit. The user's answer becomes binding — update the plan accordingly.
3. **Consistency-check** — embed a deliberately wrong recommendation targeting the highest-risk step (e.g. suggest doing the most dangerous step last, or suggest skipping an irreversible operation's gate). Phrase as a plausible option. Do not label it differently from the other questions.

Wait for answers before finalizing the sub-briefs. Gate on human-validation.md rules: comprehension must be answered correctly (offer one clarification, then re-ask), clarification must produce an explicit decision, consistency-check must not be confirmed unchallenged.

### 8. Final human gate

Present the sub-briefs with their paths. Request validation before spawning execution agents.

Set `**Status:** VALIDATED` in each sub-brief after approval.

### 8.5. Write plan JSON (after VALIDATED only)

After the human approves and VALIDATED status is set, write `briefs/<task>-plan.json` atomically:

1. **Detect critical mode** before building the JSON:

```bash
[ -f briefs/<task>-formal-triage.md ] && TASK_MODE="critical" || TASK_MODE="<mode from intake brief>"
```

Use `$TASK_MODE` as the `"mode"` field value. The `critical` mode causes `roster-workflow-build` to select `workflows/templates/critical.cwr.json`. This detection applies to both full triage briefs and minimal placeholder briefs written by the `--critical=rocq`/`--critical=quint` shortcut — file existence is the signal.

2. Build the JSON object:
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

3. For each `step.hook`: set `true` if `.harness/hooks/skills/<skill>/pre.md` OR `.harness/hooks/skills/<skill>/post.md` exists; `false` otherwise.

4. For missing quality gate commands: use `""` (never null or omit the key).

5. Write atomically:
   - Write JSON to `briefs/<task>-plan.json.tmp`
   - Rename to `briefs/<task>-plan.json`
   - If interrupted before rename: only the `.tmp` file exists (treated as absent by downstream consumers)

## Output Contract

- `briefs/<task>-plan.md` (VALIDATED)
- `briefs/<task>-implementer.md` (VALIDATED)
- `briefs/<task>-reviewer.md` (VALIDATED)

**Next:** `/roster-implement` reads `briefs/<task>-implementer.md`.

## When to Go Back

| Condition | Action |
|---|---|
| Brief has unresolvable ambiguity or missing required sections | Stop — re-run `/roster-intake` to complete the brief |
| Both voices agree the brief's direction should change | Stop — present to user, re-run `/roster-intake` if approved |
| KB has Critical contradictions and user chose to fix KB first | Stop — fix KB with `/ambiguity-auditor`, then re-run `/roster-plan` |

## What Next

**Primary path:** `/roster-implement` (reads `briefs/<task>-implementer.md`)
**Alternatives:**
- Re-run `/roster-intake` if the brief was incomplete

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

```jsonl
{
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
