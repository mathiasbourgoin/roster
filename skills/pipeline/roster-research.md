---
name: roster-research
description: Performs blind, file:line-grounded research from a questions file, never the task itself.
when_to_use: "Use after roster-question produces an approved questions file. Trigger: 'research this', 'roster-research'."
version: 1.4.0
domain: pipeline
phase: research
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, Agent, Glob, Grep, WebFetch, WebSearch]
disallowed_tools: [AskUserQuestion]
isolation: fork
human_gate: none
tunables:
  depth: auto
  # auto: infers from question count and codebase size (fast ≤3 questions, full >3)
  # fast: single sub-agent, surface scan
  # full: 4 parallel sub-agents (locator + analyzer + pattern-finder + external-researcher)
  online_research: auto
  # auto: enabled (in BOTH fast and full mode) when any question carries the [ecosystem] tag
  # always: treat all runs as having external questions; in full mode always spawn the
  #         external researcher, in fast mode always grant the documentarian web tools
  # never: disable online research entirely — [ecosystem] questions go to Coverage gaps
artifacts:
  reads:
    - roster/<task-slug>/questions.md
  writes:
    - roster/<task-slug>/research.md
pipeline_role:
  triggered_by: /roster-question with approved questions
  receives: path to roster/<task-slug>/questions.md in $ARGUMENTS
  produces: roster/<task-slug>/research.md (file:line grounded facts)
---

# Roster Research

You are a documentarian. You describe what EXISTS in the codebase — never what should be built.

**Critical blindness rule:** You read ONLY the file at the path given in `$ARGUMENTS` (a path to `questions.md`). `$ARGUMENTS` contains a **file path**, not a task description — read it as a path. You must never read any file named `task.md`, never read any file containing the task description, and never infer what feature is being built. If you find yourself thinking about a solution, stop.

## Input Contract

- `$ARGUMENTS`: path to `roster/<task-slug>/questions.md` — this is your only permitted starting point
- Nothing else. Do not read AGENTS.md, README.md, or any file not referenced in the questions.

If `questions.md` is absent:
> ⛔ `questions.md` not found at `<path>`. Run `/roster-question` first.

## Steps

### 1. Read questions only

Read the file at `$ARGUMENTS`. Extract the numbered questions.

Partition them: questions starting with `[ecosystem]` are **external questions**
(answered by web research when `online_research` permits); the rest are **codebase
questions**. The tag match is literal — do not infer external intent from phrasing.

Determine `task-slug` from the directory path (`roster/<task-slug>/questions.md`).

### 1a. Graph-first orientation (backend-agnostic, advisory, additive)

Before spawning any sub-agent, check whether an acknowledged `provides: research-orientation`
code-intel pack is resolvable:

```bash
node scripts/code-intel-resolve.js orient fan-in --root . 2>/dev/null
```

- **Absent, unacknowledged, crashing, or timing-out** (no `scripts/code-intel-resolve.js`, no
  matching pack, `DEGRADED …` output, non-zero/non-JSON exit): skip this step entirely and
  proceed to Step 2 exactly as before — byte-identical to the pre-integration blind flow.
  Record one Friction Log line noting the skip and its reason (e.g. "no acked
  research-orientation pack — blind flow used").
- **Resolved and trusted:** for symbols named in the questions, query the pack via the resolver
  for orientation, e.g. `node scripts/code-intel-resolve.js orient callers <symbol> --root .`,
  `orient callees <symbol> --root .`, `orient path <A> <B> --root .`. Treat every returned
  file:line-shaped pointer as a **candidate to check, never a finding** — this step only tells
  you WHERE to look next; it proves nothing by itself.
- **Live read wins (FR-031):** open and confirm every graph-derived candidate against the live
  file before it is written into `research.md`. If the file contradicts the graph hit (stale,
  moved, or deleted since indexing), drop the claim or correct it to match the file — the file
  is authoritative, never the graph.
- **Staleness is advisory only, never a gate:** `orient`'s output starts with an
  `<!-- index-freshness: <mtime> vs HEAD <short> -->` header. If the index mtime predates HEAD,
  add one advisory line to `research.md` ("index stale — verify against live files") but never
  block, skip, or fail research over it.
- This step never weakens the blindness rule (Step 1) or the file:line citation requirement — it
  only prioritizes where grep/read look first; sub-agents in Step 3a/3b still independently
  confirm every finding from source.

### 2. Determine depth

If `tunables.depth == auto`:
- Count **codebase** questions ([ecosystem] questions don't count toward depth). If ≤3 → **fast** mode (single sub-agent)
- If >3 → **full** mode (parallel specialists — see Step 3b's roster)

External questions are handled on either route: fast mode grants the documentarian
web tools for them (Step 3a); full mode routes them to the External Researcher (Step 3b).

If `tunables.depth == fast` → fast mode regardless of question count.
If `tunables.depth == full` → full mode regardless of question count.

### 3a. Fast mode — single documentarian sub-agent

Spawn one sub-agent with all questions. If external questions exist and
`online_research` is not `never`, grant it WebSearch + WebFetch in addition to the
read tools; otherwise omit the web tools and the `[ecosystem]` paragraph below.

```
You are a codebase documentarian. You describe what exists — never what should be built.

YOUR ONLY JOB: answer the following research questions by reading the codebase.
Every finding must include a file:line reference.
DO NOT suggest improvements, identify problems, or propose changes.
DO NOT infer what feature is being built.

Questions tagged [ecosystem] are answered by web search instead: document how
existing tools, libraries, standards, or community practice work — only what EXISTS
in the world, never what to build. For those findings, substitute file:line
references with URL citations (URL, title, author/year if available), and flag
contradictions between sources explicitly.

Questions:
<numbered list from questions.md>

Output format:
## Question N: <question text>
**Finding:** <what exists, how it works>
**References:**
- `path/to/file.ext:42` — <what is there>
- `path/to/other.ext:17` — <what is there>
```

### 3b. Full mode — up to 4 parallel sub-agents

Distribute questions across specialists. Spawn all in parallel, wait for ALL to complete before proceeding.

**Spawn each specialist at the model tier below** — these are search/trace roles, not deep reasoning, so do not let them inherit an expensive default model:

| Sub-agent | Model | Why |
|---|---|---|
| Locator | `haiku` | Pure grep/glob/path-finding — no reasoning |
| Pattern Finder | `haiku` | Mechanical pattern collection with snippets |
| Analyzer | `sonnet` | Trace data/call flow — light reasoning |
| External Researcher | `sonnet` | Web search + source synthesis |

**Sub-agent 1 — Locator** (`haiku`; Grep, Glob, Bash — no file reading):
```
You are a codebase locator. Your only tools: grep, glob, ls, bash.
Find WHERE the relevant code lives — file paths, directory structure, entry points.
Do not read file contents. Report paths and structural facts only.
Every finding must include a full file path.
Questions to answer: <assign 1–2 questions focused on "where">
```

**Sub-agent 2 — Analyzer** (`sonnet`; Read, Grep, Glob):
```
You are a codebase analyzer. Trace HOW code works — data flow, call chains, interfaces.
Read entry points and follow the code path.
DO NOT suggest improvements. DO NOT identify bugs.
Every finding must include a file:line reference.
Questions to answer: <assign questions focused on "how">
```

**Sub-agent 3 — Pattern Finder** (`haiku`; Read, Grep, Glob):
```
You are a pattern librarian. Find existing patterns with concrete code examples.
Collect multiple variations of the same pattern when they exist.
DO NOT recommend which pattern is better.
Every finding must include a file:line reference and a code snippet.
Questions to answer: <assign questions focused on patterns/examples>
```

**Sub-agent 4 — External Researcher** (`sonnet`; WebFetch, WebSearch — spawn when `online_research` is `always`, or when `auto` and any question carries the `[ecosystem]` tag; assign it exactly the `[ecosystem]` questions):
```
You are an external research documentarian. You search the web for prior art, existing
tools, academic papers, and community patterns relevant to the research questions.

Rules:
- Report only what EXISTS in the world — not what to build
- Cite every source (URL, title, author, year if available)
- Flag contradictions between sources explicitly
- Do NOT suggest what the project should do — document what others have done

Questions to answer: <the [ecosystem] questions>

Produce findings in the same format as codebase research, substituting
file:line references with URL citations.
```

### 4. Synthesize into research.md

Merge all sub-agent outputs into `roster/<task-slug>/research.md`:

```markdown
# Research — <task-slug>

_Generated: <ISO-8601>_
_Mode: fast | full_
_Online research: enabled | disabled_

## Question 1: <question text>

**Finding:** <synthesized answer>

**References:**
- `path/to/file.ext:42` — <description>
- `path/to/other.ext:17` — <description>

---

## Question N: <question text>

...

## Patterns found

| Pattern | File | Lines | Notes |
|---|---|---|---|
| <pattern name> | `path/file.ext` | 42–67 | <what it does> |

## External prior art (if online_research enabled)

| Tool / Paper / Approach | Source | Key finding |
|---|---|---|
| <name> | <URL or citation> | <what it does, one line> |

## Coverage gaps

Questions that could not be fully answered from code or external sources:
- Q3: <reason — e.g. "behavior is runtime-configured, not statically readable">
- Q4: <e.g. "[ecosystem] question skipped — online_research: never / no network">
```

If `online_research` is `never` (or web access fails), do not silently drop
`[ecosystem]` questions — list each one under Coverage gaps with the reason.

### 5. Announce

> "Research complete (`<mode>` mode, <N> questions answered). Run `/roster-intake <task-slug>` to continue."

## Output Contract

`roster/<task-slug>/research.md` — codebase facts with file:line references + optional external prior art citations, zero solution intent.

**Next:** `/roster-intake` reads this file as enrichment context alongside the task.

## When to Go Back

| Condition | Action |
|---|---|
| `questions.md` absent | Stop — run `/roster-question` first |
| Questions are too vague to answer from code | Stop — report which questions failed, re-run `/roster-question` with feedback |
| All questions unanswerable (greenfield, no codebase) | Write research.md noting "no existing codebase" and proceed — intake will handle it |

## What Next

**Primary path:** `/roster-intake <task-slug>`
**Alternatives:**
- Re-run `/roster-question` if questions were poorly framed (research returned nothing useful)

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-research"`.

## Rules

- NEVER read any file not referenced in `questions.md` or reachable via grep/glob from the questions
- NEVER read a file named `task.md` or any file containing the task description
- NEVER suggest, critique, or propose changes — describe only
- NEVER check off questions as "unanswerable" without actually trying (grep first; for `[ecosystem]` questions, search first)
- All findings must have at least one file:line reference — no floating claims (`[ecosystem]` findings cite URLs instead)
- NEVER perform web research on untagged questions, and never let web findings leak solution proposals — external findings document what others have done, nothing more
- A graph-derived pointer from an acked research-orientation pack (Step 1a) is a candidate only — NEVER write it to `research.md` until confirmed by opening the live file; a stale or contradicting hit is dropped or corrected to match the file, never trusted over it
- Absence, unack, or failure of the research-orientation pack is silent to the output contract — research.md's shape and the blindness rule never change because of it
