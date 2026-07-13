---
name: roster-spec
description: Derives an adversarial, GWT-scenario spec with formalized FR-NNN requirements from an intake brief.
when_to_use: "Use for feature or API-change tasks after intake, before planning. Trigger: 'spec this', 'roster-spec'."
version: 2.4.0
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
    - roster/<task-slug>/research.md (if present — external prior-art table)
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

Read `briefs/<task>-intake.md`. Find the `**Type:**` line and the `**Trust boundary:**` line.

**Escalation-entry exception (A-10):** if you were routed here by a `design-not-converging`
verdict (roster-review/roster-run passed that context explicitly), skip the risk-based branching
below entirely and go straight to the **Minimal-Freeze Profile** — the un-encodable finding IS the
invariant gap to spec, regardless of the brief's Type or Trust boundary value.

- If Type is `feature` or `api-change`: continue to the full spec flow (Steps 0–11 below).

- If Type is `fix`, `chore`, `docs`, or `refactor` **and** `**Trust boundary:** yes`: do **not**
  skip. Continue to the **Minimal-Freeze Profile** (below) instead of the full flow.

- If Type is `fix`, `chore`, `docs`, or `refactor` **and** `**Trust boundary:** no`:
  > ℹ️ Spec phase skipped for `<type>` tasks (Trust boundary: no). Writing completion marker.
  Write `briefs/<task>-spec.md` with `**Status: SKIPPED — type: <type>**`.
  Stop.

- If Type is `fix`, `chore`, `docs`, or `refactor` **and** the `**Trust boundary:**` line is
  **absent** (legacy brief — predates this field):
  > ⚠️ Legacy brief has no Trust boundary field — skipping as today. A trust-boundary task may be
  > passing through unfrozen; consider re-running `/roster-intake` to backfill the field.
  Write `briefs/<task>-spec.md` with `**Status: SKIPPED — type: <type>**`.
  Stop. (Fail-open by design — FR-003, EC-1: a fail-closed default would break every in-flight or
  legacy task.)

- If `**Type:**` line is missing:
  > ⛔ Intake brief has no Type field. Re-run `/roster-intake` and ensure
  > the Type field is set before proceeding.
  Stop.

### Minimal-Freeze Profile

For a trust-boundary task that does not warrant full user-story ceremony (FR-004/FR-005): derive
the invariants at risk (from the brief's Goal + Relevant Files + the trust-boundary keyword that
fired at intake) and write `specs/<task-slug>.md` marked `**Profile: minimal-freeze**` containing
only:

- **Invariants** — the properties this task must not violate, one per bullet, **containing** the
  runnable checks and their annotations below (FR-081 — the base "containing only" wording is
  amended to admit the authentic-path pair and the not-feasible marker).
- **Runnable Checks** — `CHECK-N` entries, one per invariant, each with a red-command
  (see the exit convention below).
- **Acceptance Criteria** — exactly one `AC-N` paired 1:1 with each `CHECK-N` (mechanical pairing —
  `CHECK-1` ↔ `AC-1`, `CHECK-2` ↔ `AC-2`, ...), preserving the `failed_acs` traceability that
  review/QA key on.

`tunables.min_user_stories` and `tunables.min_gwtscenarios_per_story` **do not apply** to a
minimal-freeze spec — no User Stories or Challenges sections are required (FR-005).

**Authentic-path requirement (US-4, FR-080..FR-085).** A minimal-freeze invariant set MUST include
**at least one** `CHECK-N` annotated `(authentic-success-path)` — a check that reaches the real
consumer boundary, not a synthetic-only stub — **and at least one** annotated `(fail-closed-path)`.
One `CHECK-N` MAY carry both annotations when it genuinely covers both roles (EC-10). Example:

```
- CHECK-1 [AC-1] (authentic-success-path): `node checks/auth-accept.js` → real consumer accepts a validly-signed token.
- CHECK-2 [AC-2] (fail-closed-path): `node checks/auth-reject.js` → real consumer rejects a tampered token.
```

**Not-feasible marker.** When no feasible authentic path exists (e.g. the real consumer boundary is
unreachable in CI), write **`**Authentic path: not feasible — <reason>**`** instead of the pair.
Enforcement is **prose-and-human, accepted level** (FR-084) — these checks need not be
gate-executable and MUST NOT be auto-linked as ratchet red-run checks (§5.5 of roster-review.md)
unless self-contained; do not expect `scripts/check-review-convergence.js` to verify this
requirement mechanically. Step 9 below explicitly surfaces the marker for human acknowledgment.

**Existing spec file (EC-3, FR-006, FR-085):** if `specs/<task-slug>.md` already exists, **extend**
it — add the new invariants and their paired CHECK-N/AC-N, and add the authentic-path pair or the
not-feasible marker if the extension introduces new invariants — never skip on the grounds that the
file exists.

**No derivable invariant (FR-007):** if no invariant can be derived from the brief for this task,
write `briefs/<task>-spec.md` with `**Status: BOUNCED — no derivable invariant**` and stop. Do not
write a spec file.

**Red-command exit convention (A-6):** every `CHECK-N` red command in a minimal-freeze (and every
ordinary) spec MUST honor 0 = check passes, 1 = assertion fired, ≥2 = error — a plain
self-contained script (e.g. `node <check>.js`), never relying on a test runner's own exit codes
(`node --test`/jest exit 1 for both an assertion failure and a load error). This convention is
distinct from the gate script's own exit convention (`scripts/check-review-convergence.js`, where
2 = degraded input, not error).

Skip Steps 1–8 (Research/Clarification/Story/Challenge/Formalizer/Cross-Spec/Write) for the
minimal-freeze path — go directly to Step 9 (Human validation) with the minimal spec content, then
Step 10 (Write Completion Artifact).

## Idempotency Check

If `specs/<task-slug>.md` already exists:
> "A spec already exists for `<task-slug>`. Overwrite, review, or skip?"
Wait for user decision. If skip: write completion marker and stop.

**Exception — minimal-freeze and escalation-entry paths (FR-006, A-10) never offer "skip".** If
this task is on the Minimal-Freeze Profile (trust-boundary Trigger Check) or was routed here by a
`design-not-converging` escalation, an existing `specs/<task-slug>.md` is **always extended**, not
skipped — do not present the skip option in that case. Skipping would let a trust-boundary or
un-encodable-finding gap through unfrozen, which FR-006 forbids.

## Steps

### 0. Load prior art (if available)

Check for `roster/<task-slug>/research.md`. If present, read its
`## External prior art` section. This table is **load-bearing input** for Step 4:
every documented external approach that diverges from the brief's implied direction
must surface as a challenge — prior art is never merely context.

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

From the brief's Goal, clarification Q&A, and research, derive at least `tunables.min_user_stories` user stories. Each must be:
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

If fewer than `tunables.min_user_stories` independent stories are derivable: write `briefs/<task>-spec.md` with `**Status: BOUNCED**`, report what is missing, and stop.

### 4. Challenge Sub-Agent (adversarial)

Spawn a sub-agent with this prompt (substitute the resolved value of
`tunables.min_challenges_per_story` for the placeholder before sending — the sub-agent
runs in a fresh context and cannot read this skill's frontmatter):

```
You are an adversarial requirements engineer. Find every challenge that must be resolved before these stories can be implemented.

Rules:
- Never accept a story as valid without a challenge
- A challenge is a question, contradiction, edge case, or missing constraint that — if unresolved — makes the implementation ambiguous or wrong
- Reference the story number and exact ambiguity; at least <min_challenges_per_story> challenge(s) per story
- For EACH entry in the external prior-art table whose documented approach diverges
  from the direction the stories assume, raise a challenge of the form:
  "Prior art: <tool/paper> does Y (<source>); the stories assume X — justify the
  divergence or adopt Y." Prior art that is ignored without a challenge is a defect
  in YOUR output.

Produce:
1. Numbered challenges C-1, C-2, ... each citing its story. No solutions — only challenges.
2. ## Edge Cases: EC-N [US-N]: [edge condition] → [expected behavior, or "behavior unspecified"]

Stories: <US-N with acceptance scenarios>
Research context: <research sub-agent summary>
External prior art: <the External prior art table from roster/<task-slug>/research.md, or "none available">
Brief: <goal + scope boundary + architecture notes>
```

### 5. Adversarial Resolution (human gate)

Classify each challenge:
- **Resolvable from research/KB or brief**: resolve immediately, document resolution.
- **Requires user input**: add to questions list.

Ask questions **one at a time**. Remaining budget: `tunables.max_questions_to_user − questions_asked_step2`. Do NOT ask questions answerable by reading code or the brief.

If unresolved challenges exceed the remaining budget: write `briefs/<task>-spec.md` with `**Status: BOUNCED — unresolved challenges: [list]**` and stop.

### 6. Requirements Formalizer

Spawn a sub-agent with this prompt:

```
You are a requirements formalizer. Produce (1) FR-NNN MUST/MUST NOT statements — one normative requirement per distinct behavioral obligation, grouped by story — and (2) the Acceptance Criteria list.

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

Acceptance Criteria — derive one AC per story happy path, plus one per resolved
challenge that imposes an observable behavior. Each AC cites its story (and challenge
where applicable) and states behavior → expected outcome; downstream review and QA key
on these AC-N ids:
- AC-1 [US-1 happy path]: [behavior] → [expected outcome]
- AC-2 [US-1, C-1]: [behavior] → [expected outcome]

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
name: <task-slug>
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

### US-N: <title> (Priority: P0|P1|P2) — one full story block per story, format per Step 3

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

**Authentic-path marker surfacing (US-4, FR-082/FR-083).** If the spec carries
`**Authentic path: not feasible — <reason>**` (minimal-freeze or otherwise), explicitly echo the
marker and its reason in the presentation — approval given with the marker surfaced constitutes
acknowledgment of the accepted gap; do not bury it in the file body and treat silence as consent.
If the human declines to accept the marker and no feasible authentic path can be added: the phase
concludes **BOUNCED** (FR-083, EC-11) — do not write `Status: VALIDATED`.

### 10. Write Completion Artifact

Write `briefs/<task>-spec.md` **only after Step 9 approval**:

```markdown
# Spec Brief — <task-slug>
**Date:** <ISO-8601>
**Status: VALIDATED**
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
| Cannot derive ≥`tunables.min_user_stories` independent user stories | BOUNCED → user must clarify brief with `/roster-intake` |
| >max_questions challenges unresolved after research | BOUNCED → re-run `/roster-intake` with challenge list |
| Entity conflict with existing spec, user cannot resolve | STOP — ask user to amend existing spec first |
| Type field missing from intake brief | STOP — re-run `/roster-intake` |

## What Next

**Primary path:** `/roster-plan`
**If bounced:** `/roster-intake` — brief must be enriched before re-running roster-spec

## Friction Log

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-spec"`.

## Rules

- Never write the spec before resolving all challenges
- Never ask questions answerable by reading code or the brief
- Never produce a spec with 0 runnable checks unless explicitly marked manual
- Anti-sycophancy: challenge every requirement, including ones that seem obvious
- Prior art is load-bearing: an external prior-art entry that diverges from the brief's direction MUST become a challenge ("existing practice does Y; task assumes X; justify or adopt") — never silently ignored
- If both sub-agents agree a brief direction is wrong → USER-CHALLENGE, never auto-change
