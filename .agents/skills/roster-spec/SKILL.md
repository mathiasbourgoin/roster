---
name: roster-spec
description: Adversarial spec phase — derives user stories with concrete GWT scenarios, surfaces challenges, formalizes FR-NNN requirements, produces structured contract with runnable checks.
version: 2.0.2
domain: pipeline
phase: spec
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, Agent, AskUserQuestion, WebFetch]
human_gate: after
tunables:
  min_user_stories: 2
  min_gwtscenarios_per_story: 3
  min_challenges_per_story: 1
  max_questions_to_user: 5
  require_runnable_checks: true
artifacts:
  reads:
    - briefs/<task>-intake.md
    - specs/*.md (existing specs for consistency check)
    - kb/ (if present)
  writes:
    - specs/<task-slug>.md
    - briefs/<task>-spec.md
pipeline_role:
  triggered_by: roster-run (feature/api-change tasks only)
  receives: briefs/<task>-intake.md (VALIDATED)
  produces: specs/<task-slug>.md + briefs/<task>-spec.md
---

---
name: roster-preamble
version: 1.5.0
description: Shared preamble injected into every roster skill that declares preamble true. Not a standalone command.
---

# Roster Preamble

This preamble is injected into every roster skill that declares `preamble: true`.
It encodes the non-negotiable principles that govern all skill runs.

---

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
A short-term shortcut is rarely faster than a complete solution.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

A false positive (checking for something that didn't exist) costs seconds.
A false negative (building something that already existed) costs hours and creates debt.

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction:
→ present the recommendation
→ explain why you both think it is better
→ state what context you might be missing
→ ask

Never act unilaterally in this case. The decision belongs to the user.

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

At the end of each run, honestly record:
- frictions encountered (workarounds, long searches, ambiguities)
- methods used
- any suggestion for a tool, skill, or adaptation

This is not a performance review. It is cross-run memory.
Format: see `skills-meta/friction.jsonl`.

### Pipeline State

If your skill's `phase:` frontmatter field is **non-null** (i.e. you are one of the staged
pipeline phases) **and** you are operating on a task with a `briefs/<task>-` context, append one
event to `briefs/<task>-state.json` when you finish — this is the durable, resumable record
`/roster-run` reads to resume and `/roster-doctor status` renders. Skip entirely if your `phase:`
is `null` (standalone skills: doctor, audit, investigate, init, skill-health) or there is no task
context. Create the file if absent; preserve every prior `events` entry:

```json
{
  "task": "<slug>",
  "mode": "express|fast|full",
  "current_phase": "implement",
  "events": [
    { "phase": "implement", "outcome": "COMPLETED", "at": "<ISO-8601 or omit>", "by": "roster-implement" }
  ]
}
```

Rules for writing your event:

- **`task` is the canonical slug**, derived once from the task description and reused identically
  by every phase: lowercase, kebab-case, the ≤4 most significant words (the same rule
  `/roster-question` and `/roster-intake` use to name `briefs/<task>-*`). The first phase to run
  — `roster-implement` in Express/Fast, `roster-question`/`roster-intake` in Full — fixes the slug;
  every later phase, and `/roster-run`'s resume check, MUST derive the byte-identical slug or the
  ledger will not be found. When in doubt, reuse the slug already present on existing
  `briefs/<task>-*` files for this task rather than re-deriving.
- **`phase` MUST be your skill's own `phase:` frontmatter value, verbatim** — one of the legal
  tokens: `question`, `research`, `intake`, `spec`, `plan`, `implement`, `review`, `qa`, `ship`.
  Never invent a synonym (`implementation`, `code-review`, …); resume matches on these exact tokens.
- **`outcome` is per phase, from this fixed vocabulary** — `intake`: `VALIDATED`; `spec`:
  `VALIDATED`, `SKIPPED` (non-spec'd task types), or `BOUNCED`; `review`/`qa`: `GO` or `NO-GO`;
  `ship`: `COMPLETED`; `question`/`research`/`plan`/`implement`: `COMPLETED`. Do not invent other
  values.
- **Append-only audit trail.** Always push a *new* event — never rewrite or delete a prior one.
  A re-run after a NO-GO bounce legitimately produces a second `implement`/`review` pair; that
  repetition is the history, not a bug. Set `current_phase` to your phase (the latest completed).
- `mode` is the task's mode (`express`/`fast`/`full`); set it on first write, leave it thereafter.
- Use a timestamp in `at` if your runtime can produce one; otherwise omit the field. `by` is your
  skill name (or `human-gate` for a gate decision).


# Roster Spec

You produce a structured contract for the feature described in the intake brief. This is an adversarial process — find what is wrong with the requirements before implementation begins.

**Anti-sycophancy rule:** Challenge every assumption. Surface every gap. The spec is only complete when challenges are resolved, not when requirements are listed.

## Input Contract

Read `briefs/<task>-intake.md` **in full** before doing anything.

If the brief is absent or lacks VALIDATED status:
> ⛔ Intake brief absent or not validated. Re-run `/roster-intake` first.

If required sections are missing (Goal, Scope Boundary, Relevant Files, Quality Gates):
> ⛔ Incomplete brief — missing section(s): <list>. Complete the brief before speccing.

## Trigger Check

Read `briefs/<task>-intake.md`. Find the `**Type:**` line.

- If Type is `fix`, `chore`, `docs`, or `refactor`:
  > ℹ️ Spec phase skipped for `<type>` tasks. Writing completion marker.
  Write `briefs/<task>-spec.md` with `**Status:** SKIPPED — type: <type>`.
  Stop.

- If Type is `feature` or `api-change`: continue.

- If `**Type:**` line is missing:
  > ⛔ Intake brief has no Type field. Re-run `/roster-intake` and ensure
  > the Type field is set before proceeding.
  Stop.

## Idempotency Check

If `specs/<task-slug>.md` already exists:
> "A spec already exists for `<task-slug>`. Overwrite, review, or skip?"
Wait for user decision. If skip: write completion marker and stop.

## Steps

### 1. Research Sub-Agent

Spawn a sub-agent (fresh context) with this prompt:

```
You are a codebase researcher. Read the codebase and surface everything relevant to this feature. Do NOT suggest what to build — only document what EXISTS.

Find and report (with file:line citations):
1. All existing code paths relevant to this feature
2. Similar features already implemented — what patterns do they use?
3. Existing tests covering adjacent behavior
4. Existing specs in specs/ referencing the same entities or feature area
5. KB entries (kb/) relevant to this feature's domain
6. Potential conflicts: code that assumes the opposite of what this feature proposes

Brief:
<full content of briefs/<task>-intake.md>
```

Use the research output to pre-populate the spec's context — do not re-investigate what it covers.

### 2. Clarification Elicitor

Spawn a sub-agent with this prompt:

```
You are a requirements clarifier. Surface and resolve every material ambiguity before story drafting begins.

For each ambiguity: state it precisely, answer from brief/research if knowable, else mark [OPEN].

Produce a Q&A table of 4–8 items covering:
- Unclear scope boundaries (in vs out)
- Behavioral edge cases the brief omits
- Naming/definition inconsistencies between brief and existing code
- Architecture-implied constraints not stated in the brief

Format:
| Q | A |
|---|---|
| <precise question> | <answer or "[OPEN]"> |

Brief: <full content of briefs/<task>-intake.md>
Research: <research sub-agent output summary>
```

Track `questions_asked_step2` = number of [OPEN] items resolved by asking the user. Resolve all [OPEN] items before proceeding — re-read sources or ask the user one question at a time.

### 3. Story Generation

From the brief's Goal, clarification Q&A, and research, derive 2–N user stories. Each must be:
- **Independent**: delivers value without requiring other stories in this brief
- **Specific**: names actor, action, and observable outcome
- **Falsifiable**: a test can prove it works or fails

For each story supply:
- **Priority** (P0/P1/P2) with justification
- **Scope**: what this story does NOT cover
- **Independent Test**: one sentence on how to verify in isolation
- **Acceptance Scenarios**: ≥`tunables.min_gwtscenarios_per_story` GWT scenarios, each with a specific actor/state (not "a user"), concrete action with real values, and observable outcome

Format:
```
### US-1: <title> (Priority: P0|P1|P2)
As a [role], I want [action] so that [outcome].
**Why this priority**: ...
**Scope**: This story does NOT cover [explicit exclusion].
**Independent Test**: ...
**Acceptance Scenarios**:
1. **Given** [concrete state], **When** [action], **Then** [observable outcome]
2. **Given** [concrete state], **When** [action], **Then** [observable outcome]
3. **Given** [error/boundary state], **When** [action], **Then** [observable outcome]
```

If fewer than 2 independent stories are derivable: write `briefs/<task>-spec.md` with `**Status:** BOUNCED`, report what is missing, and stop.

### 4. Challenge Sub-Agent (adversarial)

Spawn a sub-agent with this prompt:

```
You are an adversarial requirements engineer. Find every challenge that must be resolved before these stories can be implemented.

Rules:
- Never accept a story as valid without a challenge
- A challenge is a question, contradiction, edge case, or missing constraint that — if unresolved — makes the implementation ambiguous or wrong
- Reference the story number and exact ambiguity; at least 1 challenge per story

Produce:
1. Numbered challenges C-1, C-2, ... each citing its story. No solutions — only challenges.
2. ## Edge Cases: EC-N [US-N]: [edge condition] → [expected behavior, or "behavior unspecified"]

Stories: <US-N with acceptance scenarios>
Research context: <research sub-agent summary>
Brief: <goal + scope boundary + architecture notes>
```

### 5. Adversarial Resolution (human gate)

Classify each challenge:
- **Resolvable from research/KB or brief**: resolve immediately, document resolution.
- **Requires user input**: add to questions list.

Ask questions **one at a time**. Remaining budget: `max_questions_to_user − questions_asked_step2`. Do NOT ask questions answerable by reading code or the brief.

If unresolved challenges exceed the remaining budget: write `briefs/<task>-spec.md` with `**Status:** BOUNCED — unresolved challenges: [list]` and stop.

### 6. Requirements Formalizer

Spawn a sub-agent with this prompt:

```
You are a requirements formalizer. Produce FR-NNN MUST/MUST NOT statements — one normative requirement per distinct behavioral obligation, grouped by story.

Each FR must:
- Use MUST, MUST NOT, SHALL, or SHALL NOT
- Map to at least one acceptance scenario or runnable check
- Name the actor, trigger, and observable outcome
- Be marked [US-N]

No implementation details. No FRs untraceable to an accepted story or resolved challenge.

Format:
#### <Feature Area from US-N>
- **FR-001** [US-1]: System MUST <normative statement>
- **FR-002** [US-1]: <actor> MUST be able to <action> resulting in <observable>
- **FR-003** [US-2]: System MUST NOT <prohibited behavior> when <condition>

Stories + acceptance scenarios: <all US-N>
Challenge resolutions: <challenge/resolution table>
```

### 7. Cross-Spec Consistency Check

```bash
ls specs/*.md 2>/dev/null | head -20
```

If existing specs found: grep their `## Entities` sections for names that appear in your draft entities. For each definition mismatch, report the conflict and ask the user which definition is canonical. Update accordingly.

### 8. Write Spec File

Write `specs/<task-slug>.md`:

```markdown
---
name: roster-spec
type: spec
status: live
feature: <feature name from brief goal>
brief: briefs/<task>-intake.md
date: <ISO-8601>
version: 1.0.0
---

# Spec — <feature name>

## Clarifications

| Q | A |
|---|---|
| <question> | <answer> |

## User Stories

### US-1: <title> (Priority: P0|P1|P2)
As a [role], I want [action] so that [outcome].
**Why this priority**: ...
**Scope**: This story does NOT cover [explicit exclusion].
**Independent Test**: ...
**Acceptance Scenarios**:
1. **Given** [concrete state], **When** [action], **Then** [observable outcome]
2. **Given** [concrete state], **When** [action], **Then** [observable outcome]
3. **Given** [error/boundary state], **When** [action], **Then** [observable outcome]

### US-2: ...

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | <challenge> | <resolution> |

## Functional Requirements

#### <Feature Area from US-1>
- **FR-001** [US-1]: System MUST <normative statement>
- **FR-002** [US-1]: <actor> MUST be able to <action> resulting in <observable>

#### <Feature Area from US-2>
- **FR-003** [US-2]: System MUST NOT <prohibited behavior> when <condition>

## Acceptance Criteria

- AC-1 [US-1, C-1]: [behavior] → [expected outcome]
- AC-2 [US-1 happy path]: [behavior] → [expected outcome]

## Edge Cases

- EC-1 [US-1]: [edge condition] → [expected behavior]
- EC-2 [US-2]: [edge condition] → [expected behavior]

## Runnable Checks

- CHECK-1 [AC-1]: `<command>` → expected: <exit code / output>
- CHECK-2 [AC-2]: `<command>` → expected: <what success looks like>

## Entities

- `<EntityName>`: <one-sentence definition>
```

If `tunables.require_runnable_checks` is true and no concrete checks can be written: mark them as `CHECK-N: manual — <description>`.

### 9. Human validation

Present `specs/<task-slug>.md` and run the quiz per the human-validation.md protocol (≥1 comprehension + 1 consistency-check question). Do not write `Status: VALIDATED` until explicit approval is received. If the human requests changes: apply them, then re-ask the quiz before writing VALIDATED.

### 10. Write Completion Artifact

Write `briefs/<task>-spec.md` **only after Step 9 approval**:

```markdown
# Spec Brief — <task-slug>
**Date:** <ISO-8601>
**Status:** VALIDATED
**Spec file:** specs/<task-slug>.md
**User stories:** <count>
**Clarifications:** <count>
**Challenges resolved:** <count>/<total>
**Functional requirements:** <count>
**ACs:** <count>
**Runnable checks:** <count>
```

### 11. Announce

> "Spec complete for `<task-slug>`. [N] stories, [N] clarifications, [N] challenges resolved, [N] FRs, [N] ACs, [N] runnable checks. Run `/roster-plan` to continue."

## Output Contract

- `specs/<task-slug>.md` — permanent indexed contract
- `briefs/<task>-spec.md` — pipeline completion marker (VALIDATED | SKIPPED | BOUNCED)

## When to Go Back

| Condition | Action |
|---|---|
| Cannot derive ≥2 independent user stories | BOUNCED → user must clarify brief with `/roster-intake` |
| >max_questions challenges unresolved after research | BOUNCED → re-run `/roster-intake` with challenge list |
| Entity conflict with existing spec, user cannot resolve | STOP — ask user to amend existing spec first |
| Type field missing from intake brief | STOP — re-run `/roster-intake` |

## What Next

**Primary path:** `/roster-plan`
**If bounced:** `/roster-intake` — brief must be enriched before re-running roster-spec

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-spec",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never write the spec before resolving all challenges
- Never ask questions answerable by reading code or the brief
- Never produce a spec with 0 runnable checks unless explicitly marked manual
- Anti-sycophancy: challenge every requirement, including ones that seem obvious
- If both sub-agents agree a brief direction is wrong → USER-CHALLENGE, never auto-change
