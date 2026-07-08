---
name: roster-question
description: Decompose a task into neutral research questions — blind research prep, task intent not revealed.
version: 1.0.0
domain: pipeline
phase: question
preamble: true
friction_log: true
allowed_tools: [Read, Write, Agent, AskUserQuestion, Bash]
human_gate: after
artifacts:
  reads:
    - AGENTS.md
    - README.md
  writes:
    - roster/<task-slug>/questions.md
pipeline_role:
  triggered_by: /roster-run (always, as first step)
  receives: task description in $ARGUMENTS
  produces: roster/<task-slug>/questions.md (neutral questions, task intent hidden)
---

---
name: roster-preamble
version: 1.6.2
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
is `null` (the standalone skills — e.g. doctor, audit, investigate, init, skill-health; the `phase:` field itself is the rule, not this list) or there is no task
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
- Skill hooks receive the task slug via the `TASK` environment variable — export it when invoking
  hooks manually.


# Roster Question

You decompose a task into neutral research questions. Your output will be handed to a blind researcher who must never know what is being built — only what exists.

**Critical principle:** `questions.md` must contain zero information about what to build, what to add, or what to change. Questions describe what IS, not what SHOULD BE.

## Input Contract

- `$ARGUMENTS`: task description (any length)
- `AGENTS.md`, `README.md` for project context

## Steps

### 1. Read context

Read `AGENTS.md` and `README.md` silently. Do not read the codebase yet.

### 2. Derive the task slug

Kebab-case, max 4 words from $ARGUMENTS. Example: "add webhook retry logic" → `webhook-retry-logic`.

### 3. Spawn question-generation sub-agent

Spawn a sub-agent with this exact prompt:

```
You are a research planner. You will receive a task description.
Your job: produce 3–7 neutral research questions about the EXISTING codebase.

Rules:
- Questions must describe what EXISTS — never what to BUILD
- No question may reveal the feature or change being requested
- Each question must be answerable by reading code (grep, glob, read)
- Questions must be specific enough to direct a code reader to the right areas

Good: "How does the middleware chain handle request authentication, and where are auth policies defined?"
Bad: "What's the best way to add a new authenticated endpoint?"

Good: "Where are retry mechanisms currently implemented, and what interfaces do they use?"
Bad: "How should we implement webhook retry logic?"

Task description (DO NOT include this in the output):
<$ARGUMENTS>

Produce: a numbered list of 3–7 neutral research questions only.
No introduction, no conclusion, no mention of what is being built.
```

### 4. Create output directory and write questions.md + task.md

```bash
mkdir -p roster/<task-slug>
```

Write `roster/<task-slug>/questions.md`:

```markdown
# Research Questions — <task-slug>

_Generated: <ISO-8601>_
_DO NOT include the task description in this file or share it with the researcher._

1. <neutral question>
2. <neutral question>
3. <neutral question>
...
```

**Do not include the task description in this file.**

Write `roster/<task-slug>/task.md` with the full task description (this is the durable record downstream phases read to recover the goal if context is lost):

```markdown
# Task — <task-slug>

<full task description, verbatim from the user>
```

### 5. Human review gate

Present the questions to the user:

> "Research questions ready for `<task-slug>`. Review before I hand them to the researcher:
>
> <list questions>
>
> Approve, edit, or ask me to regenerate?"

Apply any corrections. Wait for explicit approval before proceeding.

### 6. Announce next step

> "Questions approved. Run `/roster-research roster/<task-slug>/questions.md` to continue."

## Output Contract

`roster/<task-slug>/questions.md` — neutral questions only, no task intent, human-approved.

**Next:** `/roster-research` reads this file as its only input.

## When to Go Back

| Condition | Action |
|---|---|
| Task too vague to form any question | Stop — ask the user to clarify the task before proceeding |
| Questions keep revealing the solution intent | Regenerate with stricter prompt; if still failing, reformulate the task with the user |

## What Next

**Primary path:** `/roster-research roster/<task-slug>/questions.md`
**Alternatives:**
- Skip research and go directly to `/roster-intake` — only for trivial single-file tasks with no codebase exploration needed

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-question",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never include the task description or solution intent in `questions.md`
- Never skip the human review gate — questions shape the quality of all downstream research
- If the task is in a domain with no existing codebase (greenfield), note this and generate architectural questions about conventions and tooling instead
