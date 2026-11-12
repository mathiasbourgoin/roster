---
name: roster-plan
description: Decomposes a validated intake brief into sequenced, per-role sub-briefs.
when_to_use: "Use after roster-intake produces a validated brief. Trigger: 'plan this', 'roster-plan'."
version: 1.7.0
domain: pipeline
phase: plan
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, Agent, AskUserQuestion]
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

### 0. Claims projection pre-check (conditional)

Run the available claims reconciler's `check --root .`; stop on stale managed claims. Legacy
passes. Also require a task context manifest's current freshness digest.

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

Read `.harness/roadmap/model-routing.md` (source fallback `docs/model-routing.md`) once
for this planning pass. Observe native model-selection controls and available candidates
without exploring beyond the brief's scope. Plan the least costly available capable model
per mission, using relative `economy`/`standard`/`strong` tiers; unknown cost/capability stays
unknown. Explicit owner model choices, quality gates and independence requirements win.
Use direct deterministic commands where possible and same-agent sequential work when
delegation adds no value; required independent analyses/review must still remain independent.

Estimate each bounded mission's optimistic/likely/pessimistic duration in minutes using
the brief's scope, dependency/check burden and observed execution evidence. State the basis,
assumptions and unknowns; an owner deadline is not duration evidence. For roadmap planning
or a revisit, include all task ranges and a separate global-verification range (or unknown),
revising only where evidence changes the estimate. Do not move an ETA merely because of a poll.
Read `.harness/roadmap/estimates-schema.md` (source `schema/roadmap-estimates-schema.md`)
for a planner `estimates.json` update. Bind it to the accepted contract digest, current execution
revision and independent forecast revision, with writer, rationale, evidence and UTC capture.
Active remaining estimates must name the actual attempt and capture time; otherwise elapsed
time is unknown on legacy boards. Record uncertainty in the plan when evidence is unavailable;
missing historical forecasts alone do not invalidate a brief. Forecast sidecars amend no
accepted mission/model, receipt, plan-JSON schema, review gate or retry budget.

### 2. Dual-voice: two independent analyses

Run **sequentially** two independent analyses.

**Decomposition shape — prefer vertical slices.** Each step should be a thin end-to-end slice delivering one capability through every layer it touches (data → logic → interface), not a horizontal layer ("all schema", then "all endpoints"). A vertical slice is independently demoable and testable when it lands; a horizontal layer hides integration risk until the end. Both voices should flag a layered plan.

#### Voice 1 — Authorized available analysis agent (fresh context)

Use an authorized available fresh analysis agent, without assuming a vendor or an
unsupported model control. Supply its compact routing decision and this prompt, without
the conversation history. If fresh delegation is unavailable, record the limitation and
resolve the required independence through the existing gate rather than call self-analysis
an independent agent result:

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

**If an authorized independent second model is available:** run the same analysis via that
model, preserving explicit owner preferences and recording its actual selection control.

**If not available:** use an authorized fresh adversarial sub-agent with the prompt below.
Keep the two analyses separate and identify a same-model fallback honestly; do not invent
second-model availability. If this delegation is unavailable, surface the independence gap.

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

**Verify each option is reachable before presenting it.** Not "plausible" — reachable in the
current tree, checked. On 2026-08-25 four dependency mechanisms were offered to a human, and all
four shared one unmet prerequisite: the target library exposed no installable name, so none of
them could work. It was found one step after the decision, and the work done on the chosen option
was thrown away.

Two verified options beat four unverified ones, and cost less to produce. If a check would be
expensive, say what is unverified and what would settle it — never present an option whose
feasibility you have not established as though it were equal to one you have.

**Re-check reachability when the tree moves.** If an earlier step in this session changed what is
installed, exposed, or published, the option set may have changed with it. In the case above the
eventually-correct mechanism became available only because an earlier step in the same session
had made it so, and nobody revisited the decision until the human asked.

### 5. Write the plan

Produce `briefs/<task>-plan.md`:

```markdown
# Plan — <task-slug>

**Date:** <ISO-8601>
**Status: DRAFT**

## Sequential steps

1. **<step>** — <description, files involved, completion criterion>
2. **<step>** — ...

## Dependencies

<Step N must precede step M because ...>

## Duration forecast

| Mission | Optimistic / likely / pessimistic minutes, or unknown | Basis and evidence | Assumptions / dependencies |
|---|---|---|---|
| <mission> | <range or unknown> | <scope/check evidence> | <dispatch/capacity assumptions> |
| Global verification (roadmap only) | <range or unknown> | <integrated check burden> | <separate from task DoD> |

For a roadmap revisit: state what changed, preserve earlier forecast revisions and provide
the separate accepted-contract-bound estimates update. Task ETA and global ETA remain
conditional on dispatch/authorization/check outcomes; unresolved blockers stay visible.

## Model routing

| Mission / role | Runtime; requested model / tier | Native control and evidence | Selection reason; cost/uncertainty; costly exception | Actual model | Failure trigger; existing bounds; authorized fallback |
|---|---|---|---|---|---|
| <mission> | <runtime; available identifier or inherited/unknown; economy/standard/strong/unknown> | <supported control or unknown; observation and owner sources> | <capability justification; observed comparison or unknown; exception or none> | <runtime-reported identifier or unknown> | <diagnosed capacity trigger; attempt/time/cost limits; permitted alternative or none> |

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

Every sub-brief must include a self-contained `## Model routing` section with only that
mission's compact record from the plan table: request/tier/runtime control, evidence and
reason, cost unknowns/costly exception, actual model or unknown, failure trigger, existing
bounds and authorized fallback. Do not copy the full policy or another mission's analysis.
Diagnose environment/context/spec issues and ordinary red tests before model escalation;
do not repeat unchanged expensive attempts or relax gates/budgets. If an accepted roadmap
is involved, a different `topology.model` requires its revised accepted board process,
preserving history and consumed attempts; this table cannot silently reroute it.
Include only the mission's duration/remaining range, evidence basis, assumptions and any
attempt/time anchor in its sub-brief. Use the separate forecast sidecar for roadmap updates;
unknown timing must not become a promise or cause a weaker completion criterion.

### 7. Human validation quiz

Write the full plan to `briefs/<task>-plan.md` first, then run a 3-question quiz per the `human-validation.md` protocol. Plan-specific question targets:

1. **Comprehension** — the ordering or dependency between the two highest-risk steps.
2. **Clarification** — an implicit decision (batching order, rollback strategy, migration approach); the user's answer is binding — update the plan accordingly.
3. **Consistency-check** — target the highest-risk step (e.g. suggest doing the dangerous step last, or skipping an irreversible gate).

Gate per `human-validation.md` rules; wait for answers before finalizing sub-briefs.

### 8. Final human gate

Present the sub-briefs with their paths. Request validation before spawning execution agents. After approval, set `**Status: VALIDATED**` in `briefs/<task>-plan.md` **and** in each sub-brief — the Output Contract and roster-run's routing both key on a validated plan.md.

### 8.5. Write plan JSON (after VALIDATED only)

After approval, write `briefs/<task>-plan.json` atomically:

1. **Detect the mode:**
```bash
if [ -f briefs/<task>-formal-triage.md ]; then TASK_MODE="critical"
else TASK_MODE=$(jq -r '.mode // "full"' briefs/<task>-state.json 2>/dev/null || echo "full")
fi
```
Use `$TASK_MODE` as the `"mode"` field. Triage-brief existence is the critical signal — applies to both full triage briefs and minimal placeholder briefs from `--critical=rocq`/`--critical=quint`. Otherwise the mode comes from the state ledger (`mode` is set on the ledger's first write — pipeline preamble); a missing ledger defaults to `full`, the only non-critical route that reaches this skill.

2. Build the JSON:
```json
{
  "task": "<slug>",
  "mode": "full|critical",
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

Append one entry at phase exit — when this skill finishes, not at session end. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-plan"`.

## Rules

- The brief is the single source of truth — do not read the codebase
- USER-CHALLENGE is never auto-decided — always present to the human
- Do not spawn execution agents — produce sub-briefs only
- If a plan step is not covered by the brief → note as assumption, do not invent
- Sub-briefs must be self-contained: the receiving agent cannot assume access to the current context
