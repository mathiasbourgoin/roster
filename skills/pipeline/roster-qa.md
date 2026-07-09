---
name: roster-qa
description: Runs deterministic quality gates and produces a GO/NO-GO verdict.
when_to_use: "Use after roster-review returns GO, before shipping. Trigger: 'run QA', 'roster-qa'."
version: 1.4.0
domain: pipeline
phase: qa
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: after
tunables:
  require_tmux_matrix_for_tui: true
  run_full_suite: true
  code_intel_gate_timeout: 120
artifacts:
  reads:
    - briefs/<task>-review.json
    - briefs/<task>-qa-scope.md
    - briefs/<task>-impl.md
  writes:
    - briefs/<task>-qa.md
pipeline_role:
  triggered_by: /roster-review with GO status
  receives: briefs/<task>-review.json GO + implementation on branch
  produces: briefs/<task>-qa.md GO or NO-GO
---

# Roster QA

You run deterministic checks and produce a GO/NO-GO verdict. No code writing — observe, measure, report.

**Token discipline:** raw output, no paraphrase. Link to logs if long.

## Input Contract

Read `briefs/<task>-review.json` in full.

**Check the mode** from `review.json` field `mode`:
- **Express**: skip QA entirely — `/roster-ship` directly after review GO. QA is not needed when there is no spec/KB impact.
- **Fast** or **Full**: run full QA below.

**BLOCK** if:
- status is `NO-GO` in review.json
- review.json is absent

```
⛔ BLOCKED: review.json is NO-GO or absent.
Resolve review issues before running QA.
```

## Steps

### 1. Read context

- `briefs/<task>-review.json` — note reviewer's points of attention
- `briefs/<task>-impl.md` — exact scope of implementation

Derive the quality-gate commands from `briefs/<task>-intake.md` Quality Gates section.
If no intake brief (Fast/Express mode), read quality-gate commands from `briefs/<task>-impl.md` Quality Gates section instead.

### 2. Deterministic quality gates

Run the gates in sequence (order and pass/fail semantics: see Rules).

```bash
# Gate 1: Build
<build command from intake or impl brief>

# Gate 2: Tests (full suite)
<test command>

# Gate 3: Format / Lint — run the FULL linter here (the per-edit hook only fast-checks
# formatting). For Rust this is where clippy belongs: cargo fmt -- --check && cargo clippy
# -- -D warnings. Use the project's documented lint command.
<format + full-lint command>

# Gate 4: Project-specific tests (if documented in intake brief)
<specific command>
```

For each gate: record the exact result (exit code, duration, number of tests).

If a gate fails:
- Record the full error log
- Immediate status: NO-GO
- Do not continue to subsequent gates
- Include in the report without softening

### 3. Spec runnable checks (conditional)

```bash
# Replace <task> with the actual task slug (e.g. "auth-feature")
TASK_SLUG="<task>"
[ -f "specs/${TASK_SLUG}.md" ] && echo "spec: present" || echo "spec: absent"
```

If spec present: extract `## Runnable Checks` section. For each CHECK-N:
- Run the command
- Verify against the expected output
- Mark PASS / FAIL / N/A (with justification)

At least one FAIL with no justification = QA NO-GO.

### 3.5 Code-intel invariant gate (conditional)

Deterministic gate over the machine-checkable invariants declared in `kb/properties.md`
(the fenced `code-intel` block — envelope documented in `schema/kb-schema.md`). Gate packs
are resolved purely from SKILL.md frontmatter per the seam contract in
`schema/skill-schema.md` (`capability: code-intel` + `provides: gate` + `entry`) — never
from the registry or `harness.json`.

```bash
node scripts/code-intel-resolve.js gate --timeout ${code_intel_gate_timeout:-120}
```

In the roster repo the resolver lives at `scripts/code-intel-resolve.js`. In consumer
projects, locate it via the installed roster checkout. If it is unavailable, perform the
documented equivalent inline — keep it deterministic:

1. Resolve gate packs: grep `capability: code-intel` + `provides: gate` from
   `.agents/skills/*/SKILL.md`, then `.opencode/skills/*/SKILL.md` (dedupe by skill
   directory name, `.agents` wins — seam contract, `schema/skill-schema.md`).
2. Extract the fenced `code-intel` block from `kb/properties.md` to a temp file
   (malformed JSONL → treat as exit 2 below).
3. Run each matching pack's `entry` command in lexicographic skill-name order, cwd =
   project root, `SKILL_DIR` set to the absolute skill dir, the block-file path as the
   sole argument, timeout `code_intel_gate_timeout` (expiry = exit 3).

Outcome semantics (mirror the resolver's exit codes and `RESULT:` line):

| Resolver outcome | QA behavior |
|---|---|
| `RESULT: skip` (no gate pack installed, or no `code-intel` block) | Step skipped — the skip MUST be recorded in `briefs/<task>-qa.md` (one line, e.g. `Code-intel gate: skipped (no code-intel block)`). Never silent in the report; no verdict impact. |
| Exit 1 (`RESULT: fail` — invariant violated) | Immediate **NO-GO** — stop, include the full raw gate log in the report, keeping the per-pack `GATE <pack>: exit N` attribution lines. |
| Exit 2 (`RESULT: malformed`) | Immediate **NO-GO** with the explicit malformed-declaration message — a malformed `code-intel` block is a loud failure, never a skip. |
| Exit 0 with `RESULT: degraded` (crash, timeout, missing index) | Record `Code-intel gate: DEGRADED (<reason>)` from the `DEGRADED:` line(s); verdict unaffected. |
| Exit 0 with `RESULT: pass` | Record pass; include the `0 invariants` note when the resolver emits it. |

Multiple gate packs: the resolver already runs all of them in lexicographic order — the
report MUST attribute the result per pack (the `GATE <name>: exit N` lines).

### 4. TUI check (if applicable)

If the scope contains a TUI interface and `tunables.require_tmux_matrix_for_tui: true`:

```bash
# Launch the application in a tmux session
tmux new-session -d -s qa-check -x 220 -y 50
tmux send-keys -t qa-check "<launch command>" Enter
sleep 3

# Capture the display
tmux capture-pane -t qa-check -p
```

Verify:
- The application starts without error
- The display is consistent at standard dimensions (80x24, 120x40, 220x50)
- Basic interactions work (navigation, selection)

```bash
tmux kill-session -t qa-check
```

### 4.5 Cross-runtime QA re-verification (auto-on if a second runtime CLI is present)

The runtime that implemented and reviewed should not be the only one verifying. Detect a
**different** runtime CLI on `PATH`:

```bash
command -v codex >/dev/null 2>&1 && echo "codex available"
command -v opencode >/dev/null 2>&1 && echo "opencode available"
```

If none is present (or the only one is the host runtime), **skip silently**. Otherwise shell
out non-interactively (`codex exec` / `opencode run`, as in `skills/media/image-generation.md`)
and have the second runtime **independently re-run the deterministic gates** (step 2's
commands and, if it ran in the primary pass, the step 3.5 code-intel gate command —
`node scripts/code-intel-resolve.js gate --timeout ${code_intel_gate_timeout:-120}`) and
re-check the implementer's handoff claims — it does not see the primary QA
result first. Record its outcome in the report under a `## Cross-runtime QA` section.

**Block on discrepancy:** if the second runtime reports a gate FAIL or a disputed claim that
the primary run passed (a CRITICAL/HIGH discrepancy), the verdict is **NO-GO** — a gate that
only passes under one runtime is not a pass. Surface the exact divergence.

### 5. Write the QA report

**Report format contract (load-bearing):** the verdict line MUST be exactly `**Status:** GO ✅` or `**Status:** NO-GO ❌`, at the start of a line — the ship-gate hook greps `^\*\*Status:\*\* GO`. Do not inline the status into another sentence, indent it, or reword it; a report that fails this grep is rejected by the gate even if the verdict is GO.

**Manual hook invocation:** the pre/post skill hooks require the task slug via the `TASK` environment variable — e.g. `TASK=<slug> node dist/scripts/run-hook.js pre|post <skill>`. Without `TASK` the hook aborts.

Produce `briefs/<task>-qa.md`:

```markdown
# QA Brief — <task-slug>

**Date:** <ISO-8601>
**Status:** GO ✅ / NO-GO ❌

## Quality Gates

| Gate | Command | Result | Duration |
|---|---|---|---|
| Build | `<cmd>` | ✅ PASS / ❌ FAIL | <Xs> |
| Tests | `<cmd>` | ✅ <N> passed / ❌ <N> failed | <Xs> |
| Format | `<cmd>` | ✅ PASS / ❌ FAIL | <Xs> |

## Tests: detail

- New tests added: <N>
- Existing tests: <N> pass, <N> skip, <N> fail
- Regression detected: YES / NO

## Code-intel gate

<one line: pass (incl. "0 invariants" when emitted) / skipped (<reason>) / DEGRADED (<reason>) — plus the per-pack `GATE <pack>: exit N` lines when packs ran>

## TUI (if applicable)

- Dimensions tested: 80x24 / 120x40 / 220x50
- Result: ✅ OK / ❌ Issue detected
- Capture: <description of what was observed>

## NO-GO issues (if applicable)

<Full error log — no summary, the raw log>

## Verdict

**GO** — ready for `/roster-ship`
**NO-GO** — return to `/roster-implement` for: <precise reason>
```

### 6. Human gate

Present the report and request validation.
If NO-GO: suggest returning to `/roster-implement` with the exact reason.

## Output Contract

`briefs/<task>-qa.md` with GO or NO-GO status documented.

**If GO:** `/roster-ship` can start.
**If NO-GO:** return to `/roster-implement` with the error log in the brief.

## When to Go Back

| Condition | Action |
|---|---|
| Automated gate fails (build, tests, lint) | Stop — return to `/roster-implement` with the exact error log |
| Manual verification reveals a regression not caught by tests | Stop — return to `/roster-implement` |

## What Next

**Primary path (GO):** `/roster-ship`
**Primary path (NO-GO):** `/roster-implement` — include the QA brief with failing gates
**Alternatives:**
- `/roster-review` — if QA uncovered issues that warrant re-review

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-qa"`.

## Rules

- Never write code — observe and measure only
- Never summarize error logs — the raw log in the report
- Never GO if a gate fails
- Never skip a gate — all in order
- If a gate command is missing from the brief → note "not documented" and ask
