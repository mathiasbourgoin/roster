---
name: roster-workflow-build
description: Translates a validated plan JSON into a CWR workflow file using the matching mode template (mechanical template-fill — template steps are copied verbatim). Triggered automatically by roster-run after plan COMPLETED when no workflow file exists yet.
version: 1.0.0
domain: pipeline
phase: null
capability: workflow-builder
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: during
artifacts:
  reads:
    - briefs/<task>-plan.json
    - workflows/templates/<mode>.cwr.json
  writes:
    - workflows/<task>.cwr.json
pipeline_role:
  triggered_by: roster-run after plan COMPLETED (when workflows/<task>.cwr.json absent)
  receives: briefs/<task>-plan.json + workflows/templates/<mode>.cwr.json
  produces: workflows/<task>.cwr.json (disposition determined by Gate 1)
---

---
name: roster-preamble
version: 1.6.0
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
  `ship`: `COMPLETED` or `BLOCKED`; `implement`: `COMPLETED` or `PARTIAL`;
  `question`/`research`/`plan`: `COMPLETED`. Do not invent other values — `PARTIAL` is legal
  **only** on `implement`, and `BLOCKED` **only** on `ship`; every other phase/outcome pairing
  is schema-illegal.
- **Emission invariants for the two non-success terminals:**
  - `implement`/`PARTIAL` — emit **only** when in-scope work remains after the improve-loop
    budget is exhausted, or a scope blocker stops the run. Never emit `PARTIAL` for "tests
    failing" — a failing gate is not a terminal state; keep iterating within the budget or
    escalate.
  - `ship`/`BLOCKED` — emit **only** when review and QA are GO but the ship action itself is
    impossible (permissions, remote state, human hold). A NO-GO gate is not `BLOCKED`.
  - Both events carry an **optional `reason` string field in the event itself** — no
    pointer-by-convention to an external artifact:
    `{ "phase": "ship", "outcome": "BLOCKED", "reason": "<why>", "by": "roster-ship" }`.
  - **Artifact writes happen BEFORE the event append.** Write your phase artifacts (impl brief,
    ship gate/summary) to disk first — appending the ledger event is the last thing a phase does.
- **Resume semantics** (read by `/roster-run` Step 1.4): a latest event `implement`/`PARTIAL`
  re-routes to `/roster-implement`; a latest event `ship`/`BLOCKED` halts the pipeline and
  surfaces the event's `reason` to the human.
- **Append-only audit trail.** Always push a *new* event — never rewrite or delete a prior one.
  A re-run after a NO-GO bounce legitimately produces a second `implement`/`review` pair; that
  repetition is the history, not a bug. Set `current_phase` to your phase (the latest completed).
- `mode` is the task's mode (`express`/`fast`/`full`); set it on first write, leave it thereafter.
- Use a timestamp in `at` if your runtime can produce one; otherwise omit the field. `by` is your
  skill name (or `human-gate` for a gate decision).


# Roster Workflow Build

You translate a validated plan JSON into a CWR workflow file. You are `phase: null` — you do not write to the pipeline state ledger. Gate 1 (privacy gate) fires before writing anything to disk.

**Token discipline:** read the plan mode, pick the template, fill once, gate.

## Input Contract

Read `briefs/<task>-plan.json`. Stop with a clear error if:

```bash
[ -f briefs/<task>-plan.json ] || { echo "⛔ briefs/<task>-plan.json not found. Run /roster-plan first."; exit 1; }
```

Validate `schema_version`:
```bash
jq -e '.schema_version == "1.0"' briefs/<task>-plan.json >/dev/null 2>&1 || \
  echo "⛔ Unsupported plan.json schema_version: $(jq -r '.schema_version' briefs/<task>-plan.json) (expected 1.0)"
```

Confirm the mode template exists:
```bash
[ -f workflows/templates/<mode>.cwr.json ] || \
  echo "⛔ Template not found: workflows/templates/<mode>.cwr.json"
```

If any check fails: stop. Do not write any file.

## Steps

### 1. Read inputs

Read `briefs/<task>-plan.json` in full. Extract: `task`, `mode`, `steps[]` (each with `id`, `skill`, `inputs`, `outputs`, `hook`).

Read `workflows/templates/<mode>.cwr.json`. Note the `_roster_version` field — this becomes `_roster_template_version` in the instance.

### 2. Generate workflow JSON

Copy `steps[]` verbatim from `workflows/templates/<mode>.cwr.json` — do not regenerate from plan.json. The template steps carry the curated prompts and are the canonical step definitions for this mode.

If plan.json `steps[].skill` list diverges from the template `steps[].id` list, emit a warning and continue (do not block):

```bash
PLAN_IDS=$(jq -r '[.steps[].skill] | join(",")' briefs/<task>-plan.json)
TMPL_IDS=$(jq -r '[.steps[].id] | join(",")' workflows/templates/<mode>.cwr.json)
[ "$PLAN_IDS" != "$TMPL_IDS" ] && echo "⚠ WARN: plan.json step IDs ($PLAN_IDS) differ from template ($TMPL_IDS) — using template steps"
```

Produce the CWR workflow object:

```json
{
  "name": "<task>",
  "_roster_version": "1.0.0",
  "_roster_template_version": "<source template _roster_version>",
  "_doc": "Generated by roster-workflow-build from template <mode>.cwr.json",
  "steps": "<steps[] copied verbatim from workflows/templates/<mode>.cwr.json>"
}
```

The `${TASK}` placeholders in template step prompts are expanded at CWR runtime (the `cwr run` path exports `TASK=<slug>`; the `cwr to-claude-workflow` path also exports `TASK=<slug>`). Do not substitute `${TASK}` here — leave placeholders as-is in the generated file.

### 3. Gate 1 — Privacy gate (synchronous, no default)

Present AskUserQuestion with three options. Do not pre-select any option. Do not proceed until the user selects one.

**Options:**
- **commit** — write file to `workflows/<task>.cwr.json`, then `git add workflows/<task>.cwr.json`
- **local-only** — write file to `workflows/<task>.cwr.json`, do not stage
- **execution-only** — write file to `workflows/<task>.cwr.json.tmp`, rename for use; roster-run deletes after dispatch

**Non-interactive fallback** (no TTY detected): default to execution-only and log:
```
[non-interactive: workflow execution-only — no commit]
```

### 4. Write workflow file

**commit or local-only:**
Write the generated JSON to `workflows/<task>.cwr.json`.
If commit: `git add workflows/<task>.cwr.json`.

**execution-only:**
Write to `workflows/<task>.cwr.json.tmp`, then rename to `workflows/<task>.cwr.json`.
The `.tmp` file is written first so that a crash between write and rename leaves only an orphaned `.tmp` (treated as absent by roster-run's presence check).
After rename, write an empty `workflows/<task>.cwr.json.ephemeral` sidecar — this is the deletion signal that roster-run reads after dispatch to clean up the file automatically.

### 5. Verify output

```bash
jq empty workflows/<task>.cwr.json 2>/dev/null && echo "workflow: valid JSON ✓" || echo "workflow: invalid JSON ✗"
```

If `cwr` is available: `cwr lint workflows/<task>.cwr.json`

## Output Contract

`workflows/<task>.cwr.json` — a CWR workflow file with:
- `name`: task slug
- `_roster_version`: `"1.0.0"`
- `_roster_template_version`: source template's `_roster_version`
- `steps[]`: one `kind: agent` step per plan step, with hook invocations embedded when `hook: true`
- Disposition: committed / local-only / execution-only temp (per Gate 1 decision)

**Next:** roster-run continues dispatch after this skill completes.

## When to Go Back

| Condition | Action |
|---|---|
| `briefs/<task>-plan.json` absent | Stop — run `/roster-plan` first |
| Unsupported `schema_version` in plan.json | Stop — re-run `/roster-plan` to regenerate with current schema |
| Mode template file absent | Stop — check `workflows/templates/` is present; run `/roster-doctor` |
| Gate 1 selection cancelled or interrupted | Stop — report to user; workflow file not written |

## What Next

Roster-run dispatches after this skill:
- CWR CLI available, default (cabal runtime): `TASK=<slug> cwr run workflows/<task>.cwr.json`
- CWR CLI available, Claude Code Workflow tool target: `cwr to-claude-workflow workflows/<task>.cwr.json` → Workflow tool
- CWR absent: manual skill chain (existing roster-run behavior)

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-workflow-build",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never write to the pipeline state ledger (`briefs/<task>-state.json`) — phase: null
- Gate 1 is synchronous — roster-run does not dispatch until Gate 1 resolves
- Never pick a default option at Gate 1 in interactive mode
- If any input check fails, stop immediately with a clear error — do not produce partial output
- The generated workflow must be valid JSON (verify with `jq empty` before reporting done)
