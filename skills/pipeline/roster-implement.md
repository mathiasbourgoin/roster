---
name: roster-implement
description: Executes an assigned implementation sub-brief using TDD, the improve loop, and sub-agents.
when_to_use: "Use after roster-plan produces sub-briefs, or directly for Express/Fast tasks. Trigger: 'implement this', 'roster-implement'."
version: 1.5.5
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

**Note — worktree isolation:** the `implementer` sub-agent type isolates in a git worktree; it cannot see uncommitted changes in the main working tree. For tasks operating on uncommitted working-tree files, use a non-isolated general agent instead. **Base freshness:** before delegating tree-wide edits to a worktree-isolated agent, verify the worktree is based on the *current* HEAD (a stale base silently applies the sweep to old sources); if it is not, have the agent rebase first or use a non-isolated agent.

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

### 5. Final verification

```bash
<build command>     # must pass
<test command>      # must pass — all tests, not just new ones
<format command>    # must pass
```

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

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-implement"`.

## Rules

- Never implement outside the brief's scope
- Never modify a test to make it pass — fix the implementation
- Never commit code that breaks existing gates
