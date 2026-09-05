---
name: roster-question
description: Decomposes a task into neutral research questions with the intent hidden.
when_to_use: "Use as the first roster-run step before any research happens. Trigger: 'roster-run', new task with no scoping yet."
version: 1.4.0
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
    - roster/<task-slug>/questions.manifest.json
pipeline_role:
  triggered_by: /roster-run (always, as first step)
  receives: task description in $ARGUMENTS
  produces: roster/<task-slug>/questions.manifest.json plus a Markdown review view (task intent hidden)
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
- **Resume semantics** (read by `/roster-run` Step 3): a latest event `implement`/`PARTIAL`
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

Derive the canonical slug per the preamble's *Pipeline State* rule (it must be byte-identical across every phase). Example: "add webhook retry logic" → `webhook-retry-logic`.

### 3. Spawn question-generation sub-agent

Spawn a sub-agent with this exact prompt:

```
You are a research planner. You will receive a task description.
Your job: produce 3–7 neutral research questions about the EXISTING codebase,
PLUS 1–2 neutral ecosystem questions about the EXISTING outside world, tagged `[ecosystem]`.

Rules:
- Questions must describe what EXISTS — never what to BUILD
- No question may reveal the feature or change being requested
- This is a pure text transformation of the task description below. You have no
  file access — do NOT read, grep, or glob the codebase to generate questions.
- Each codebase question must be answerable by reading code (grep, glob, read) —
  that describes the downstream researcher's job, not yours
- Each `[ecosystem]` question must be answerable by web search: how existing tools,
  libraries, standards, or community practice handle the task's domain. Same
  disclosure level as the codebase questions — a domain is revealed, never a solution
- Questions must be specific enough to direct a reader to the right areas

Good: "How does the middleware chain handle request authentication, and where are auth policies defined?"
Bad: "What's the best way to add a new authenticated endpoint?"

Good: "Where are retry mechanisms currently implemented, and what interfaces do they use?"
Bad: "How should we implement webhook retry logic?"

Good: "[ecosystem] How do established HTTP client libraries implement retry/backoff, and what interfaces do they expose?"
Bad: "[ecosystem] Which retry library should we adopt?"

A question must ask what EXISTS. Any question a reader could only answer by predicting,
imagining, or reasoning about consequences is out of contract, even when it discloses nothing —
the researcher's job is documentary. Reject "what would happen if", "what could make", "why
might".

Bad: "What would make this gate pass while measuring nothing?"
Good: "List every assertion this gate makes, and for each, state whether it is conditional on
its input being non-empty."

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
<!-- No title. The path roster/<task-slug>/questions.md already identifies this
     file, and a descriptive slug in an H1 briefs the researcher on the very
     thing this skill requires be withheld. The mandated title contradicted the
     skill's own zero-disclosure rule. -->

_Generated: <ISO-8601>_
_DO NOT include the task description in this file or share it with the researcher._

1. <neutral question>
2. <neutral question>
3. <neutral question>
4. [ecosystem] <neutral ecosystem/prior-art question>
...
```

The `[ecosystem]` tag is load-bearing: `/roster-research` keys its external (web)
research on it. Keep it verbatim at the start of the question text.

Write `roster/<task-slug>/task.md` with the full task description (this is the durable record downstream phases read to recover the goal if context is lost):

```markdown
# Task — <task-slug>

<full task description, verbatim from the user>
```

Do not create the neutral manifest until the human has approved the questions.

### 5. Human review gate

Present the questions to the user:

> "Research questions ready for `<task-slug>`. Review before I hand them to the researcher:
>
> <list questions>
>
> Approve, edit, or ask me to regenerate?"

Apply any corrections. Wait for explicit approval before proceeding. Then write
`roster/<task-slug>/questions.manifest.json` as the researcher's machine input:

```json
{
  "questions": ["<question 1>", "<question 2>"],
  "technical_ids": ["<only paths, symbols, or other technical IDs already present in the approved questions>"],
  "digests": {"questions": "<lowercase SHA-256 of the canonical questions array>"}
}
```

These are the only three allowed top-level keys. Do not include task text, normative statements,
lifecycle, authority, recommendations, rationale, titles, timestamps, or user-profile data.
Canonicalize strings to NFC/LF, sort object keys and set-like `technical_ids`, serialize compact
JSON, and hash the `questions` array. If a claims reconciler exists at
`scripts/claims-reconcile.js` or `.harness/bin/claims-reconcile.js`, validate the manifest with its
`manifest-neutral` subcommand and stop on failure.

### 6. Dispatch or announce next step

If the human approved inline (same turn), immediately invoke `/roster-research
roster/<task-slug>/questions.manifest.json` as a `Skill` call in that same turn — do not keep
working under this skill's name. Otherwise, end the turn cleanly with:

> "Questions approved. Run `/roster-research roster/<task-slug>/questions.manifest.json` to continue."

Rationale (accounting, not style): per-skill cost is measured from one `Skill` call to
the next, so any work after approval that isn't itself a `Skill` call gets billed to
`roster-question` instead of the phase actually running.

## Output Contract

`roster/<task-slug>/questions.md` — human-readable approved questions.

`roster/<task-slug>/questions.manifest.json` — closed, validated neutral input for research.

**Next:** `/roster-research` reads this file as its only input.

## When to Go Back

| Condition | Action |
|---|---|
| Task too vague to form any question | Stop — ask the user to clarify the task before proceeding |
| Questions keep revealing the solution intent | Regenerate with stricter prompt; if still failing, reformulate the task with the user |

## What Next

**Primary path:** `/roster-research roster/<task-slug>/questions.manifest.json`
**Alternatives:**
- Skip research and go directly to `/roster-intake` — only for trivial single-file tasks with no codebase exploration needed

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

Append one entry at phase exit — when this skill finishes, not at session end. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-question"`.

## Rules

- Never skip the human review gate — questions shape the quality of all downstream research
- Always include 1–2 `[ecosystem]` questions unless the task domain genuinely has no outside prior art (rare — say so explicitly if you omit them)
- If the task is in a domain with no existing codebase (greenfield), note this and generate architectural questions about conventions and tooling instead
