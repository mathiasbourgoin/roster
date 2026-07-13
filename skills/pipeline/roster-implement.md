---
name: roster-implement
description: Executes an assigned implementation sub-brief using TDD, the improve loop, and sub-agents.
when_to_use: "Use after roster-plan produces sub-briefs, or directly for Express/Fast tasks. Trigger: 'implement this', 'roster-implement'."
version: 1.7.0
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

**Token discipline:** one thing at a time.

**Surgical discipline:** produce the smallest diff that **fully** satisfies the brief —
completeness first (every requirement met), then minimality (no smaller diff would also satisfy
it). Minimality is relative to the brief: a broad change the brief requires *is* minimal. Leverage
existing abstractions before introducing new ones. No unsolicited refactors: if you see an
out-of-scope improvement, note it in the Friction Log and the impl brief's "Identified
out-of-scope" section — never apply it. Removal is permitted only for code your own change
orphaned and for dead code within files on the task manifest; anything else is flag, don't fix.
This does not weaken thoroughness: complete work within scope remains mandatory.

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

### 1.5 File manifest lifecycle (Full mode only)

Skip this section in Express/Fast mode (`briefs/<task>-implementer.md` absent by design — no
manifest exists, the freeze hook stays fail-open and the review scope gate skips silently).

**Derive the manifest before touching any code — and capture the header (base + dirty) before
running the baseline quality gates of step 1:** a mutating baseline (e.g. a build regenerating
tracked files) would otherwise be misrecorded as pre-task dirt and permanently excluded from the
scope gate. All manifest and slot operations use **Bash only** — the freeze hook
(`hooks/safety/enforce-file-manifest.md`) denies Edit/Write to both control files, including
your own.

**Pinned grammar** for `briefs/<task>-manifest.txt` — the writer (this skill), the reader script
(`scripts/check-scope-diff.sh`), and the freeze hook use this format verbatim:

```
base=<full sha>     ← one line: git rev-parse HEAD at phase start
dirty=<path>        ← zero or more lines: one pre-task dirty file per line
---                 ← literal separator line
<entry>             ← one per line: exact repo-relative path, or directory prefix ending in /
```

No glob wildcards. A `dir/` entry matches every path under it (string-prefix match).

**Derivation rules:**

1. Entries = the implementer brief's Files list — files to modify **and** files to create
   (including test files named in plan steps) — plus the pipeline artifact paths `briefs/`,
   `roster/<task>/`, this task's spec artifacts (expand to concrete paths at derivation time,
   e.g. `specs/<task-slug>.md` — the grammar has no globs; never all of `specs/`),
   `skills-meta/friction.jsonl`, plus the collateral prefixes mandated by the project's quality
   gates (e.g. projections regenerated by a sync script).
2. Never derive a prefix broader than a directory named in the Files list or the quality gates
   (e.g. `src/`, `./`) without explicit human approval.
3. Files list empty or unparseable → escalate to the human; do not guess.

```bash
{ echo "base=$(git rev-parse HEAD)";
  git status --porcelain -uall | sed 's/^...//' | sed 's/^/dirty=/';
  echo "---";
  # <derived entries, one per line>
} > "briefs/<task>-manifest.txt"
```

(A pre-task rename line `R old -> new` becomes two `dirty=` lines — one per path — and porcelain
quoting is stripped; adjust the `sed` output by hand in that rare case.)

**Activate the slot:** if `briefs/ACTIVE_TASK` already exists with a *different* slug → escalate
to the human (overwrite or abort?); never overwrite silently. Otherwise:
`printf '%s\n' "<task>" > briefs/ACTIVE_TASK`.

**Loop-back re-derivation** (re-entry after a review NO-GO): new manifest = original entries ∪
file paths of **OPEN** `briefs/<task>-review.json` findings **∪ this round's declared ratchet
check paths** (amended A-5/FR-018 — a RESOLVED finding's path stops widening the scope gate; only
OPEN findings and the checks you are about to add this round join the manifest), **except** paths
of `category: "scope"` findings — those join only if their finding status is ACCEPTED. The
expected fix for a non-accepted scope finding is reverting the file (`git checkout <base> --
<path>`, Bash — needs no Edit/Write access), not legitimizing it.

**Deactivate at phase end** — after `briefs/<task>-impl.md` is written with Status COMPLETED:
`rm -f briefs/ACTIVE_TASK`. A PARTIAL outcome keeps the slot active (resume expected). A crashed
session leaves a stale slot; recovery is `rm briefs/ACTIVE_TASK` via Bash after human
confirmation.

**Sub-agents:** worktree-isolated sub-agents cannot see the gitignored control files — the hook
is fail-open there (documented gap). Pass the manifest entries in the sub-brief as a prose scope
constraint; the review scope gate remains the backstop.

### 2. Context detection

**If OCaml scope and complex module (> `tunables.ocaml_specialist_threshold` lines of logic):**
→ Spawn the `ocaml-dune-specialist` sub-agent with the sub-brief as context.
  Reference path: `.claude/agents/ocaml-dune-specialist.md`
  The sub-agent implements; you integrate and verify.

**If non-OCaml scope (scripts, docs, JS/TS):**
→ Spawn the `implementer` sub-agent for the non-OCaml parts.
  Reference path: `.claude/agents/implementer.md`

**If mixed scope:** sequence — OCaml first, rest after.

**Isolation decision rule (choose BEFORE spawning):**

| Condition | Sub-agent isolation |
|---|---|
| Task operates on uncommitted working-tree files | non-isolated general agent (worktree cannot see them) |
| A file manifest is active (`briefs/ACTIVE_TASK` set) | non-isolated general agent (control files are gitignored — absent in worktrees, freeze hook fail-opens there) |
| Committed base + disjoint write scope | worktree-isolated `implementer` — with the base-freshness check below |

When a worktree agent is used while a manifest exists, pass the manifest entries in the
sub-brief as a prose scope constraint — the review scope gate is the backstop.

**Note — worktree isolation:** the `implementer` sub-agent type isolates in a git worktree; it cannot see uncommitted changes in the main working tree. **Base freshness:** before delegating tree-wide edits to a worktree-isolated agent, verify the worktree is based on the *current* HEAD (a stale base silently applies the sweep to old sources); if it is not, have the agent rebase first or use a non-isolated agent.

### 3. TDD if required

If `tunables.enforce_tdd: true` **or** if the brief specifies tests to write:
→ Invoke the `/tdd-workflow` skill with the description of the behavior to implement.
  Do not write production code before a failing test.

### 3.5 Ratchet checks (loop-back rounds only)

On a re-entry after a review NO-GO, every HIGH+ finding you fix that already survived one
loop-back round (`resolved_round > first_seen_round` once review records it) needs a linked,
proven-red check before it can be marked RESOLVED (spec FR-012). Skip this section entirely on a
task's first round — there is nothing to ratchet yet.

**New-file rule (FR-016).** A ratcheted check MUST be a **new, self-contained file** — either a
new test file, or a new `CHECK-N` command in `specs/<task-slug>.md` when a spec exists for this
task. Modifying an existing file's assertions does NOT satisfy the ratchet, even if the
modification is correct and sufficient as a test.

**Where it lands (FR-019).** If `specs/<task-slug>.md` exists for this task, prefer a new
`CHECK-N` there. If no spec artifact exists (non-trust-boundary task with no spec), the check
lands as a new file in the test suite — do not create a spec file just to host it.

**Red-command convention (A-6).** The check must be runnable directly, honoring: `0` = passes,
`1` = assertion fired (the bug is still present), `≥2` = error/setup failure. A plain
self-contained wrapper, never a test runner's own exit code (`node --test`/jest exit 1 for both an
assertion failure and a load error — indistinguishable, so don't rely on it):

```js
// checks/<finding-slug>.js — runnable directly (`node checks/<finding-slug>.js`) AND
// includable from the test suite (the same file may serve both roles when it honors
// this convention when executed directly).
const assert = require('node:assert');
try {
  // ... exercise the specific behavior the finding was about ...
  assert.ok(conditionThatOnlyHoldsOnceFixed);
  process.exit(0); // pass
} catch (e) {
  process.exit(1); // assertion fired — bug still present
}
```

**Declare it in `## Ratchet` (FR-017).** Before writing the impl brief (step 6), for every new
ratchet check add one entry to the impl brief's `## Ratchet` section: the finding it addresses,
the check's path, its red command, and — only if no deterministic check is possible for this
finding — `check_encodable: false` with a one-line reason. roster-review consumes this section
into `review.json`; do not invent a path there without declaring it here first.

**Self-containment (EC-12).** If the check needs fixtures (including fake-secret-like content),
assemble them at runtime inside the check file — never commit a real-looking secret (push
protection will block it).

### 4. Iterative implementation

For each unit of work in the plan:

1. Implement the minimum to satisfy the brief
2. Run quality gates
3. If gates fail:
   - Max `tunables.max_improve_iterations` correction attempts
   - If still broken after N attempts → invoke `/improvement-loop` with bounded scope
   - If `/improvement-loop` fails → escalate to the human

**Loop-back rounds only (FR-020, amended A-4):** on a re-entry after a review NO-GO, also run —
as part of the quality gates in step 2 above — every non-`manual` spec `CHECK-N` command and every
prior round's already-ratcheted check. A check you are introducing **this round** is expected to
be red mid-round (that's TDD) and is excluded from this gate until the round's fix lands; failures
of a current-round check do not consume `tunables.max_improve_iterations`. `CHECK-N: manual — ...`
entries are never run mechanically.

### 5. Final verification

```bash
<build command>     # must pass
<test command>      # must pass — all tests, not just new ones
<format command>    # must pass
```

**Round-commit rule (FR-040, A-3):** in Fast/Full mode, commit this round's work before handing
off to review — `git status --porcelain` must be empty when you finish. This is what lets
roster-review record a trustworthy `pre_fix_sha` (HEAD) for any new HIGH+ finding at the next
NO-GO; a dirty tree forces `pre_fix_sha: null` with reason `"dirty-tree"`, and the ratchet cannot
red-verify a finding whose baseline is unknown. Express mode is exempt (uncommitted-tree work is
expected there — the residual is accepted, FR-034).

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

## Ratchet

<One entry per new ratchet check this round — omit the section entirely on a task's first round>
- **Finding:** <fingerprint from briefs/<task>-review.json>
  **Check:** `<path to the new self-contained check file, or spec CHECK-N id>`
  **Red command:** `<exact command, honoring 0=pass/1=assertion-fired/>=2=error>`
  **check_encodable:** true | false (<reason if false>)
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
- Produce the smallest diff that fully satisfies the brief — out-of-scope improvements are flagged, never applied
- Control files (`briefs/ACTIVE_TASK`, `briefs/<task>-manifest.txt`) are written via Bash only — never Edit/Write
- Never modify a test to make it pass — fix the implementation
- Never commit code that breaks existing gates
- A ratchet check must be a new self-contained file — never satisfy the ratchet by editing an existing file
- In Fast/Full mode, never hand off to review with a dirty tree — commit the round's work first
