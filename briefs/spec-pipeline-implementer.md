# Implementer Brief — spec-pipeline

**Date:** 2026-05-25T12:20:00+02:00
**Status:** VALIDATED

## Goal

Implement the `roster-spec` pipeline phase and all its wiring. 13 sequential steps across TypeScript
source, pipeline skills, auditor skills, agents, and documentation. The centerpiece is
`skills/pipeline/roster-spec.md` — a multi-sub-agent adversarial mini-pipeline that produces
structured spec files based on user stories and challenges.

## Scope Boundary

- Do NOT modify `agents/management/planner.md` (inline-paste agent, separate concern)
- Do NOT touch OCaml components
- Do NOT implement LanceDB/vector changes
- Do NOT implement roster-spec `--amend` command

## Files to Modify

| File | Change | Key detail |
|---|---|---|
| `scripts/lib/types.ts:1` | Add `\| "spec"` to ComponentType | Must be part of atomic Step 1 |
| `scripts/lib/infer.ts:~35` | Add `specs/` prefix → `"spec"` before `return "other"` | Atomic Step 1 |
| `scripts/build-index.ts:93` | Add `"specs"` to roots array | Atomic Step 1 |
| `skills/pipeline/roster-intake.md` | Add `**Type:** <type>` line to brief template | After `**Status:**` line |
| `skills/pipeline/roster-run.md` | Add spec phase to routing table + canonical route | After intake-validated row |
| `skills/pipeline/roster-review.md` | Structured no_go_reason + spec specialist row | Lines ~145,176,80-88 |
| `skills/kb/spec-compliance-auditor.md` | Add $ARGUMENTS input contract for custom spec path | Default: kb/spec.md |
| `skills/pipeline/roster-qa.md` | Add conditional spec read + Runnable Checks checklist | After review.json read |
| `skills/kb/ambiguity-auditor.md` | Add cross-spec entity consistency step | New step after existing KB checks |
| `agents/management/architect.md` | Add specs/<slug>.md to conditional reads | Before design flagging step |
| `skills/management/improvement-loop-planner.md` | Add Tool Opportunities output section | After ## Recommendation |
| `skills/kb/harness-validator.md` | Make spec-compliance conditional on specs/ existing | In required auditor list |
| `README.md` | Add roster-spec row to pipeline table | After roster-intake row |
| `AGENTS.md` | Update Skills count 15→16, add roster-spec to table | ## Skills section |
| `docs/agents.md` | Add roster-spec to pipeline skills table | Pipeline skills section |

## Files to Create

| File | Content |
|---|---|
| `skills/pipeline/roster-spec.md` | Full new skill — see design below |

## Step-by-Step Implementation

### Step 1 — TypeScript indexer (atomic, do all three together)

```typescript
// scripts/lib/types.ts — line 1
export type ComponentType = "agent" | "skill" | "rule" | "hook" | "kb" | "spec" | "other";

// scripts/lib/infer.ts — before final `return "other"`
if (normalized.startsWith("specs/")) return "spec";

// scripts/build-index.ts — line 93
const roots = ["agents", "skills", "rules", "hooks", "kb", "recruiter", "governor", "specs"];
```

Verify immediately: `npm test && npm run build:index` — must pass.

### Step 2 — roster-intake.md brief template

In `skills/pipeline/roster-intake.md`, find the brief template section (Step 5). Add this line
immediately after `**Status:** DRAFT — pending validation`:

```markdown
**Type:** feature|api-change|fix|chore|docs|refactor  ← delete all but the applicable type
```

Also add to Step 6 (human gate) instructions: "Confirm the Type field reflects the correct task type."

### Step 3 — Create `skills/pipeline/roster-spec.md`

**Full design — write this exactly:**

```markdown
---
name: roster-spec
description: Adversarial spec phase — derives user stories, surfaces challenges, produces structured contract with runnable checks.
version: 1.0.0
domain: pipeline
phase: spec
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, Agent, AskUserQuestion, WebFetch]
human_gate: after
tunables:
  min_user_stories: 2
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

# Roster Spec

You produce a structured contract for the feature described in the intake brief.
This is not a transcription phase — it is an adversarial process. Your job is to
find what is wrong with the requirements before any implementation begins.

**Anti-sycophancy rule:** Never validate a requirement just because it was stated.
Challenge every assumption. Surface every gap. The spec is only complete when
challenges are resolved, not when requirements are listed.

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
You are a codebase researcher. You will be given a task brief.
Your job: read the actual codebase and surface everything relevant to this feature.

Do NOT suggest what to build. Only document what EXISTS.

Find and report (with file:line citations):
1. All existing code paths touched by or relevant to this feature
2. Similar features already implemented — what patterns do they use?
3. Existing tests that cover adjacent behavior
4. Any existing specs in specs/ that reference the same entities or feature area
5. KB entries (kb/) relevant to this feature's domain
6. Potential conflicts: code that assumes the opposite of what this feature proposes

Brief:
<full content of briefs/<task>-intake.md>
```

Read the research output. Use it to pre-populate the spec's context — do not re-investigate
what the research covers.

### 2. Story Generation

From the brief's Goal and research findings, derive 2–N user stories. Each story must be:
- Independent: delivers value without requiring other stories in this brief
- Specific: names the actor, the action, and the observable outcome
- Falsifiable: there exists a test that could prove it works or fails

Format:
```
US-1: As a [role], I want [action] so that [outcome].
US-2: ...
```

If you cannot derive at least 2 independent user stories from the brief, write
`briefs/<task>-spec.md` with `**Status:** BOUNCED` and return to the user:
> ⛔ Spec bounced: cannot derive independent user stories from the brief.
> The brief describes [what it describes]. Missing: [what would make it specifiable].
Stop.

### 3. Challenge Sub-Agent (adversarial)

Spawn a sub-agent with this prompt:

```
You are an adversarial requirements engineer. You receive user stories and research context.
Your job: find every challenge that must be resolved before these stories can be implemented.

Rules:
- Never accept a story as valid without a challenge
- A challenge is a question, contradiction, edge case, or missing constraint
  that — if unresolved — would make the implementation ambiguous or wrong
- Challenges must be specific: reference the story number and the exact ambiguity
- At least 1 challenge per story

Stories:
<list of US-N>

Research context:
<summary of research sub-agent output>

Brief:
<goal + scope boundary + architecture notes from intake brief>

Produce: a numbered list of challenges (C-1, C-2, ...) each citing its story.
No solutions. Only challenges.
```

### 4. Adversarial Resolution (human gate)

Review the challenges. Classify each:

- **Resolvable from research/KB**: resolve immediately, document resolution.
- **Resolvable from brief**: resolve immediately, document resolution.
- **Requires user input**: add to questions list.

Ask the user questions **one at a time** (max `tunables.max_questions_to_user`).
Do NOT ask questions answerable by reading code or the brief.

If more than `max_questions_to_user` challenges remain unresolved after research:
> ⛔ Spec bounced: <N> challenges remain unresolved after research. Returning to intake.
> Unresolved: [list challenges]
Write `briefs/<task>-spec.md` with `**Status:** BOUNCED — unresolved challenges: [list]`.
Stop.

### 5. Cross-Spec Consistency Check

```bash
ls specs/*.md 2>/dev/null | head -20
```

If existing specs found: grep their `## Entities` sections for entity names that also
appear in your draft entities. For each match, compare the definitions. If they differ:

> ⚠️ Entity conflict: `<EntityName>` defined as `<X>` in `specs/<existing>.md` but
> as `<Y>` in this spec. Resolve before proceeding.

Ask user which definition is canonical. Update accordingly.

### 6. Write Spec File

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

## User Stories

- US-1: As a [role], I want [action] so that [outcome].
- US-2: ...

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | <challenge description> | <how resolved> |
| C-2 | US-2 | <challenge description> | <how resolved> |

## Acceptance Criteria

<!-- One AC per resolved challenge + one per story's happy path -->
- AC-1 [US-1, C-1]: [behavior] → [expected observable outcome]
- AC-2 [US-1 happy path]: [behavior] → [expected observable outcome]
- AC-3 [US-2, C-2]: ...

## Edge Cases

<!-- Explicitly scoped in or out -->
- EC-1: [error path / auth boundary / concurrency scenario] → [expected behavior]
- EC-2: [limit / rate / size constraint] → [expected behavior]

## Runnable Checks

<!-- Concrete shell/curl/pytest assertions — one per AC -->
<!-- Format: CHECK-N [AC-N]: `<exact command>` → expected: <what success looks like> -->
- CHECK-1 [AC-1]: `<curl/pytest/bash command>` → expected: <exit code / response / output>
- CHECK-2 [AC-2]: `<command>` → expected: <what success looks like>

## Entities

<!-- Domain entities referenced by this spec — for cross-spec consistency -->
- `<EntityName>`: <one-sentence definition>
- `<EntityName2>`: <one-sentence definition>
```

If `tunables.require_runnable_checks` is true and no concrete checks can be written
(e.g., feature is pure documentation): mark them as `CHECK-N: manual — <description>`.

### 7. Write Completion Artifact

Write `briefs/<task>-spec.md`:

```markdown
# Spec Brief — <task-slug>

**Date:** <ISO-8601>
**Status:** VALIDATED
**Spec file:** specs/<task-slug>.md
**User stories:** <count>
**Challenges resolved:** <count>/<count total>
**ACs:** <count>
**Runnable checks:** <count>
```

### 8. Announce

> "Spec complete for `<task-slug>`. [N] user stories, [N] challenges resolved, [N] ACs,
> [N] runnable checks. Run `/roster-plan` to continue."

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
```

### Step 4 — Update roster-run.md

In the routing detection table, add **before** the "intake validated → plan" row:

```
| `briefs/<task>-intake.md` VALIDATED + `**Type:**` is feature/api-change + `briefs/<task>-spec.md` absent | `/roster-spec` |
```

Update the canonical route string to:
`/roster-question → /roster-research → /roster-intake → /roster-spec → /roster-plan → ...`

Add detection bash:
```bash
[ -f briefs/<task>-spec.md ] && echo "spec: present" || echo "spec: absent"
grep '\*\*Type:\*\*' briefs/<task>-intake.md | head -1
```

### Step 5 — Update roster-review.md

Replace `"no_go_reason": null` with:
```json
"no_go_reason": {
  "type": "spec-ac-failure | code-plan-failure | null",
  "failed_acs": []
}
```

Add to the findings instructions: when findings have `category: "spec"` and severity CRITICAL/HIGH,
set `no_go_reason.type = "spec-ac-failure"` and populate `failed_acs` with the AC identifiers.

Add to routing instructions: if `no_go_reason.type == "spec-ac-failure"` → return to `/roster-spec`.

Add to conditional specialists table:
```
| spec-compliance (per-feature) | specs/<task-slug>.md exists | Invoke spec-compliance-auditor with spec path as $ARGUMENTS |
```

### Step 6 — Parameterize spec-compliance-auditor.md

Add at top of skill body:
```
## Input Contract

- If `$ARGUMENTS` contains a file path to a spec: use that file as the spec source
- Default (no $ARGUMENTS): read `kb/spec.md`
- Fail gracefully if neither exists: report "No spec source available" and exit
```

Update Step 1 of the auditor to:
```bash
SPEC_PATH="${ARGUMENTS:-kb/spec.md}"
[ -f "$SPEC_PATH" ] || { echo "No spec at $SPEC_PATH — skipping"; exit 0; }
```

### Step 7 — Update roster-qa.md

After reading `briefs/<task>-review.json`, add:
```markdown
### 2b. Read spec checks (conditional)

TASK_SLUG=$(basename briefs/<task>-spec.md -spec.md 2>/dev/null || echo "")
[ -f "specs/${TASK_SLUG}.md" ] && echo "spec: present" || echo "spec: absent"

If spec present: extract `## Runnable Checks` section. For each CHECK-N:
- Run the command
- Verify against the expected output
- Mark PASS / FAIL / N/A (with justification)

At least one FAIL with no justification = QA NO-GO.
```

### Step 8 — Update ambiguity-auditor.md

Add new step after existing KB checks:

```markdown
### Step 7 — Cross-Spec Entity Consistency (conditional)

\`\`\`bash
ls specs/*.md 2>/dev/null
\`\`\`

If specs found:
1. For each spec file, extract all lines under `## Entities`
2. Build a map: entity_name → {definition, source_file}
3. For any entity_name appearing in more than one spec with different definitions:
   - Report as CRITICAL finding: "Entity `<name>` defined differently in <file1> vs <file2>"
   - Include both definitions in the report
4. For any AC in a new spec referencing an entity not defined in its `## Entities` section:
   - Report as WARNING: "AC references undefined entity `<name>`"

Write findings to `kb/reports/ambiguity-report.md` under new section `## Cross-Spec Entities`.
```

### Step 9 — Update architect.md

Add to `artifacts.reads` (conditional):
```yaml
- specs/<task-slug>.md (if present — read before flagging design issues)
```

Add to architect's review workflow (before the finding classification step):
```markdown
### Spec Contract Check (conditional)
If `specs/<task-slug>.md` exists:
- Read its `## Acceptance Criteria` and `## Entities` sections
- Before flagging a design issue, check: does the spec define the expected behavior differently?
- If yes: cite the spec in the finding rather than asserting opinion
- If the implementation contradicts the spec AC: classify as CRITICAL (spec violation)
```

### Step 10 — Update improvement-loop-planner.md

Add after `## Recommendation` section, before `## Rules`:

```markdown
## Tool Opportunities

For each loop proposed above, identify patterns that could become deterministic tools
instead of LLM judgment. Optional section — only include if a genuine opportunity exists.

Format:
\`\`\`
[TOOL] <tool description> — replaces: <the LLM judgment or manual step it eliminates>
       Trigger: <when this tool would run — CI, pre-commit, post-edit>
       Output: <what it produces — exit code, report, annotation>
\`\`\`

Examples:
- [TOOL] Custom linter rule for missing auth guards — replaces: reviewer manually checking auth on each new endpoint
- [TOOL] Schema diff checker — replaces: LLM comparing API responses to spec definitions
\`\`\`
```

### Step 11 — Update harness-validator.md

In the required auditor list (lines 22-28), change spec-compliance-auditor to conditional:

```markdown
Required auditors (all must be present in the harness):
- `ambiguity-auditor.md` — always required
- `code-quality-auditor.md` — always required
- `harness-validator.md` — always required (self-referential check)
- `spec-compliance-auditor.md` — required only if `specs/` directory exists in project root
  ```bash
  [ -d specs ] && echo "spec-compliance required" || echo "spec-compliance optional"
  ```
```

### Step 12 — Documentation

**README.md** — In `## The Pipeline` table, add after the roster-intake row:
```
| `/roster-spec` | Spec | Adversarial spec phase: user stories, challenges, AC, runnable checks |
```

**AGENTS.md** — Update `## Skills (15)` → `## Skills (16)`. Add to pipeline skills table:
```
| roster-spec | pipeline | Adversarial spec phase: user stories → challenges → AC → runnable checks |
```

**docs/agents.md** — Add to pipeline skills table:
```
| roster-spec | 1.0.0 | Adversarial spec: user stories, challenges, structured AC, runnable checks |
```

### Step 13 — Verification

```bash
npm test
# Must show: all N agent files pass, all N skill files pass (roster-spec included)

npm run build:index
# Create a test spec to verify indexer
mkdir -p specs
cat > specs/.test-fixture.md << 'EOF'
---
name: test-fixture
type: spec
status: live
feature: indexer test
brief: briefs/test-intake.md
date: 2026-05-25
version: 1.0.0
---
# Test fixture for AC-3 verification
## Entities
- `TestEntity`: A placeholder entity for indexer verification.
EOF
npm run build:index && grep '"component_type":"spec"' index.json | head -3
rm specs/.test-fixture.md
```

## Completion Criteria

- `npm test` passes with 0 failures (all 16 skills pass structure checks)
- `npm run build:index` + grep returns at least one spec entry
- All 11 ACs from the intake brief are satisfied
- No file in the Relevant Files table is left unmodified

## Points of Attention

- **Idempotency**: roster-spec skill must guard against re-running on same task slug
- **Atomic indexer change**: all three TypeScript files must be changed in one commit
- **improvement-loop-planner path**: `skills/management/`, NOT `skills/workflow/`
- **AGENTS.md count**: actual current count is 15, update to 16
- **spec-compliance backward compat**: default to `kb/spec.md` when no $ARGUMENTS
- **harness-validator conditional**: grep for `type: spec` in specs/, not just dir existence
