---
name: roster-qa
description: Runs deterministic quality gates and produces a GO/NO-GO verdict.
when_to_use: "Use after roster-review returns GO, before shipping. Trigger: 'run QA', 'roster-qa'."
version: 1.3.4
domain: pipeline
phase: qa
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: after
tunables:
  require_tmux_matrix_for_tui: true
  run_full_suite: true
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

Canonical entry template (append to `skills-meta/friction.jsonl`; set `"skill"` to your
skill's name — extra documented fields like `event` or `mode` are allowed):

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

Schema: `schema/skill-schema.md`.


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
commands) and re-check the implementer's handoff claims — it does not see the primary QA
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
