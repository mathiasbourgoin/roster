---
name: roster-implement
description: Guided implementation — TDD, improve loop, sub-agents. Reads the plan, produces an impl brief.
version: 1.5.2
domain: pipeline
phase: implement
preamble: true
friction_log: true
allowed_tools: [Read, Write, Edit, Bash, Agent, Skill, AskUserQuestion]
human_gate: none
tunables:
  enforce_tdd: false
  max_improve_iterations: 3
  ocaml_specialist_threshold: 50
artifacts:
  reads:
    - briefs/<task>-plan.md
    - briefs/<task>-implementer.md
  writes:
    - briefs/<task>-impl.md
pipeline_role:
  triggered_by: /roster-plan with validated sub-briefs, or directly from /roster-run in Express/Fast mode
  receives: briefs/<task>-implementer.md (Full mode) or task description directly (Express/Fast)
  produces: briefs/<task>-impl.md + implemented code with passing quality gates
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


### Friction Log

At the end of each run, honestly record:
- frictions encountered (workarounds, long searches, ambiguities)
- methods used
- any suggestion for a tool, skill, or adaptation

This is not a performance review. It is cross-run memory.
Format: see `skills-meta/friction.jsonl`.


# Roster Implement

You implement the sub-brief you have been assigned. Follow the plan — do not reinterpret it. If the plan is insufficient or contradictory, escalate — do not assume.

**Token discipline:** one thing at a time. No unsolicited large refactors. If you see an out-of-scope improvement, note it in the Friction Log.

## Input Contract

**Mode-aware** — how you start depends on the mode `/roster-run` routed you in. Determine it from
the task context (and `briefs/<task>-impl.md`'s `mode:` on a loop-back, if present).

**Full mode** — read `briefs/<task>-implementer.md` in full before touching any code, and verify
both sub-briefs exist:

```bash
[ -f briefs/<task>-implementer.md ] && echo "implementer: ✅" || echo "implementer: ❌"
[ -f briefs/<task>-reviewer.md ]    && echo "reviewer: ✅"    || echo "reviewer: ❌"
```

If either is absent **in Full mode**:
> ⛔ Sub-brief missing: `briefs/<task>-implementer.md` and/or `briefs/<task>-reviewer.md` not found.
> Re-run `/roster-plan` to produce both sub-briefs before starting implementation.

**Express / Fast mode** — there is **no `/roster-plan` phase**, so the sub-briefs do not exist by
design. Do **not** block on them. Implement directly from the task description (and, on a NO-GO
loop-back, from `briefs/<task>-review.json`). Establish the quality gates yourself from the project
(detect the build/test/lint commands, or read `tunables`/harness) and record them in the impl brief.

In all modes, verify the quality gates are known before changing code — escalate if you cannot
determine them.

**KB invariants (conditional):**

```bash
[ -d kb ] && [ -f kb/properties.md ] && echo "KB present" || echo "KB absent"
```

If `kb/properties.md` exists, read it **before touching any code**.
Extract the invariants — keep them as a mental checklist throughout implementation.
Violating a KB invariant is a **blocker**: stop and escalate rather than breaking the invariant.

## Steps

### 1. Read and setup

- Read the complete implementer sub-brief
- Read the files referenced in "Relevant Files"
- Check repo state (`git status`)
- Run quality gates as baseline:
  ```bash
  <build command>
  <test command>
  ```
  If the baseline is broken → report before starting, do not hide it.

### 2. Context detection

**If OCaml scope and complex module (> `tunables.ocaml_specialist_threshold` lines of logic):**
→ Spawn the `ocaml-dune-specialist` sub-agent with the sub-brief as context.
  Reference path: `.claude/agents/ocaml-dune-specialist.md`
  The sub-agent implements; you integrate and verify.

**If non-OCaml scope (scripts, docs, JS/TS):**
→ Spawn the `implementer` sub-agent for the non-OCaml parts.
  Reference path: `.claude/agents/implementer.md`

**If mixed scope:** sequence — OCaml first, rest after.

**Note — worktree isolation:** the `implementer` sub-agent type isolates in a git worktree; it cannot see uncommitted changes in the main working tree. For tasks operating on uncommitted working-tree files, use a non-isolated general agent instead.

### 3. TDD if required

If `tunables.enforce_tdd: true` **or** if the brief specifies tests to write:
→ Invoke the `/tdd-workflow` skill with the description of the behavior to implement.
  Do not write production code before a failing test.

### 4. Iterative implementation

For each unit of work in the plan:

1. Implement the minimum to satisfy the brief
2. Run quality gates
3. If gates fail:
   - Max `tunables.max_improve_iterations` correction attempts
   - If still broken after N attempts → invoke `/improvement-loop` with bounded scope
   - If `/improvement-loop` fails → escalate to the human

**Never** commit code that breaks existing gates.

### 5. Final verification

```bash
<build command>     # must pass
<test command>      # must pass — all tests, not just new ones
<format command>    # must pass
```

If an existing test regresses → fix the implementation, never the test.

### 6. Write the impl brief

Produce `briefs/<task>-impl.md`:

```markdown
# Implementation Brief — <task-slug>

**Date:** <ISO-8601>
**Mode:** express | fast | full
**Status:** COMPLETED / PARTIAL (with reason if partial)

## Modified files

| File | Type of change | Reason |
|---|---|---|
| `path/to/file.ml` | addition / modification / deletion | <reason> |

## Decisions made

<Non-trivial decisions made during implementation — with justification>
<Deviations from the plan — with justification>

## Quality Gates

- [x] Build: `<command>` ✅
- [x] Tests: `<command>` ✅ (<N> tests, <N> new)
- [x] Format: `<command>` ✅

## Points of attention for review

<What the reviewer should prioritize>
<Edge cases not covered if scope did not allow it>

## Identified out-of-scope

<Improvements seen but not implemented — with reference to the Friction Log>
```

### 7. Ledger event (after the impl brief is on disk)

Per the preamble *Pipeline State*, append your event to `briefs/<task>-state.json` — **after**
`briefs/<task>-impl.md` is written (artifact first, event last):

- **Status COMPLETED** → `{ "phase": "implement", "outcome": "COMPLETED", "by": "roster-implement" }`.
- **Status PARTIAL** → `{ "phase": "implement", "outcome": "PARTIAL", "reason": "<...>",
  "by": "roster-implement" }` — the `reason` string mirrors the impl brief's `**Status:**` line
  reason verbatim. Emit `PARTIAL` **only** when in-scope work remains after the improve-loop
  budget is exhausted or a scope blocker stops the run — never for "tests failing" (keep
  iterating within the budget or escalate). On resume, `/roster-run` routes a latest
  `implement`/`PARTIAL` back to this skill.

## Output Contract

`briefs/<task>-impl.md` + implemented code with all quality gates passing.

**Next:** `/roster-review` reads `briefs/<task>-impl.md` + the current diff. If the ledger event
is `PARTIAL`, the next step is instead a re-run of `/roster-implement` (routed by `/roster-run`).

## When to Go Back

| Condition | Action |
|---|---|
| `briefs/<task>-implementer.md` or `briefs/<task>-reviewer.md` absent **in Full mode** | Stop — re-run `/roster-plan` to produce both sub-briefs (in Express/Fast they are absent by design — proceed from the task) |
| A plan step cannot be implemented as described | Stop — re-run `/roster-plan` with the blocker as input |
| Quality gates are broken at baseline before any change | Stop — report to human, do not proceed |
| Implementation reveals the brief was fundamentally wrong | Stop — re-run `/roster-intake` with the new information |

## What Next

**Primary path:** `/roster-review`
**Alternatives:**
- Re-run `/roster-plan` if a step was unimplementable as specified

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-implement",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never implement outside the brief's scope
- Never modify a test to make it pass — fix the implementation
- Never commit code that breaks existing gates
- Escalate if the brief is contradictory or insufficient — do not assume
- Out-of-scope improvements go in the Friction Log, not in the code
