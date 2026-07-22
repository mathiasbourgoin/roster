---
name: roster-question
description: Decomposes a task into neutral research questions with the intent hidden.
when_to_use: "Use as the first roster-run step before any research happens. Trigger: 'roster-run', new task with no scoping yet."
version: 1.2.0
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

### 5. Human review gate

Present the questions to the user:

> "Research questions ready for `<task-slug>`. Review before I hand them to the researcher:
>
> <list questions>
>
> Approve, edit, or ask me to regenerate?"

Apply any corrections. Wait for explicit approval before proceeding.

### 6. Dispatch or announce next step

If the human approved inline (same turn), immediately invoke `/roster-research
roster/<task-slug>/questions.md` as a `Skill` call in that same turn — do not keep
working under this skill's name. Otherwise, end the turn cleanly with:

> "Questions approved. Run `/roster-research roster/<task-slug>/questions.md` to continue."

Rationale (accounting, not style): per-skill cost is measured from one `Skill` call to
the next, so any work after approval that isn't itself a `Skill` call gets billed to
`roster-question` instead of the phase actually running.

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

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-question"`.

## Rules

- Never skip the human review gate — questions shape the quality of all downstream research
- Always include 1–2 `[ecosystem]` questions unless the task domain genuinely has no outside prior art (rare — say so explicitly if you omit them)
- If the task is in a domain with no existing codebase (greenfield), note this and generate architectural questions about conventions and tooling instead
