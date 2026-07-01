---
name: roster-intake
description: Intake phase — transforms a task into a contractual brief validated by the human.
version: 1.1.0
domain: pipeline
phase: intake
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion, WebFetch]
human_gate: after
artifacts:
  reads:
    - kb/spec.md
    - kb/properties.md
    - kb/risks.md
    - AGENTS.md
    - README.md
    - roster/<task-slug>/research.md (optional — read if present)
  writes:
    - briefs/<task>-intake.md
pipeline_role:
  triggered_by: /roster-run or human with a task
  receives: task description in $ARGUMENTS
  produces: briefs/<task>-intake.md validated
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


# Roster Intake

You transform a task into a contractual brief. This brief is the single source of truth for all subsequent phases — it must be complete, precise, and free of unresolved ambiguity.

**Token discipline:** read first, then ask. Never ask about things that are readable.

## Input Contract

- `$ARGUMENTS`: task description or task slug (if coming from `/roster-research`)
- If invoked with a slug (from research), read `roster/<task-slug>/task.md` as the Goal source before anything else. If absent, fall back to `$ARGUMENTS` directly.
- `roster/<task-slug>/research.md` — read if present; use as enrichment context, not as a replacement for your own analysis
- KB if it exists (`kb/spec.md`, `kb/properties.md`, `kb/risks.md`)
- `AGENTS.md`, `README.md` for project context

## Steps

### 0. Consume research (if available)

Derive the task slug from `$ARGUMENTS`. Check for `roster/<task-slug>/research.md`:

```bash
ls roster/<task-slug>/research.md 2>/dev/null && echo "research: present" || echo "research: absent"
```

If present: read it fully before any other step. Use it to pre-populate the Relevant Files table and Architecture Notes — do not re-investigate what the research already covers. **Do not let research findings alter your interpretation of the task goal or scope** — research describes what exists, not what to build.

### 1. Silent reading

Before any question:

- Read the KB if it exists
- Read `AGENTS.md` and `README.md`
- Identify files likely involved (grep if needed)
- Form an initial understanding of the task

If the task is in $ARGUMENTS, analyze it completely before asking anything.

### 2. Clarification questions (if necessary)

Only ask what cannot be inferred. One question at a time.

Typical questions based on gaps:
- "What is the expected behavior for [case not covered in the description]?"
- "Is [component X] in scope or not?"
- "What is the compatibility constraint for [Y]?"

**Do not ask** about what is in the KB, the README, or the repo files.

### 3. Identify relevant files

Read (not just list) the files directly involved:
- Files to modify
- Associated test files
- Impacted configuration files
- Extract key snippets (functions, types, interfaces)

### 4. Verify quality gates

From `AGENTS.md`, README, or KB — find the exact commands for:
- Build
- Tests
- Lint / format
- Any project-specific gate

If no gate is documented, explicitly note "not documented" — do not invent.

### 5. Write the brief

Produce `briefs/<task>-intake.md` in the exact format below.

**Derive the task slug** from $ARGUMENTS: kebab-case, max 4 words.
Example: "add webhook support" → `webhook-support`

```markdown
# Intake Brief — <task-slug>

**Date:** <ISO-8601>
**Status:** DRAFT — pending validation
**Type:** feature|api-change|fix|chore|docs|refactor  ← delete all but the applicable type

## Goal

<1-2 paragraphs: what is built or fixed, why, expected value>

## Scope Boundary

What is explicitly OUT of scope:
- <item 1>
- <item 2>

## Relevant Files

| File | Role | Key snippet |
|---|---|---|
| `path/to/file.ml` | <role> | `<relevant code excerpt>` |

## Architecture Notes

<Only what is relevant for this task — no general overview>

## Quality Gates

```bash
# Build
<exact command>

# Tests
<exact command>

# Lint/Format
<exact command>
```

## Open Questions

- [ ] <unresolved question 1 — what implementation agents must not assume>
- [ ] <unresolved question 2>

_(empty if everything is resolved)_
```

### 6. Human gate

Present the brief and ask:
> "Brief ready. Validate or correct before I proceed. Confirm the Type field reflects the correct task type."

Wait for explicit validation. Apply corrections if requested, then set `**Status:** VALIDATED` in the brief.

## Output Contract

`briefs/<task>-intake.md` with VALIDATED status, containing the 6 required sections with no unresolved ambiguity.

**Next:** `/roster-plan` reads this file as the single source of truth.

## When to Go Back

| Condition | Action |
|---|---|
| `roster/<task-slug>/research.md` is missing critical context | Stop — re-run `/roster-research` with more targeted questions |
| Task is too ambiguous to form a brief | Stop — clarify with the user before writing anything |

## What Next

**Primary path (feature/api-change tasks):** `/roster-spec` → then `/roster-plan`
**Primary path (fix/chore/docs/refactor tasks):** `/roster-plan`
**Alternatives:**
- `/roster-investigate` — if the root cause of a bug is still unclear before planning

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-intake",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never proceed to the next step without explicit human validation
- Never invent quality gates — note "not documented" if absent
- Never leave an Open Question with "TBD" or "to be decided" — either resolve it, or formulate it precisely so implementers do not assume
- Read files before listing them in Relevant Files
