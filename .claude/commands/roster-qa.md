---
name: roster-qa
description: Runs deterministic quality gates and produces a GO/NO-GO verdict.
when_to_use: "Use after roster-review returns GO, before shipping. Trigger: 'run QA', 'roster-qa'."
version: 1.9.0
domain: pipeline
phase: qa
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: after
requires_review_bundle: ">=1.3.0"
tunables:
  require_tmux_matrix_for_tui: true
  run_full_suite: true
  code_intel_gate_timeout: 120
  max_qa_rounds: 5 # QA-side round cap (spec: specs/qa-loop-bounding.md) — deliberately a
    # distinct name from roster-review's max_no_go_rounds (C-13): tunables are
    # per-skill-namespaced either way, and the distinct name keeps cross-skill
    # grep/config unambiguous. Do not rename to match review's.
artifacts:
  reads:
    - briefs/<task>-review.json
    - briefs/<task>-qa-scope.md
    - briefs/<task>-impl.md
    - briefs/<task>-qa-state.json (prior round, if present — round/cycle/qa_no_go_round/rounds_audit source)
  writes:
    - briefs/<task>-qa.md
    - briefs/<task>-qa-state.json
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

**Light bundle check (F-7 — presence only, doctor owns the full verify):**
`[ -f scripts/xruntime-exec.sh ] && [ -f scripts/xruntime-review.js ]` (the wrapper is
intentionally 0644, always invoked via `bash` — never test `-x`). If either is missing, stop with
`stale-install`; QA cannot safely bypass the shared breaker. Roster-review's earlier preflight
normally makes this impossible, but files can disappear between phases.

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
- `briefs/<task>-qa-scope.md` — if present (Full route): the plan's QA scoping — exact
  gate commands, behaviors to validate, TUI scenarios. This is the **primary** scope
  source when it exists; its behaviors-to-validate become explicit check items in the
  report (Step 5), and its TUI scenarios drive Step 4.

Gate-command precedence: `briefs/<task>-qa-scope.md` → `briefs/<task>-intake.md`
Quality Gates section → `briefs/<task>-impl.md` Quality Gates section (Fast/Express,
where neither plan nor intake artifacts exist).

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
| Exit 0 with `GATE <pack>: unacknowledged — not executed` (execution trust model, `schema/skill-schema.md`) | Record `Code-intel gate: DEGRADED (<pack> unacknowledged — run: node scripts/code-intel-resolve.js ack <pack>)`; verdict unaffected. Extension-installed packs with intact install hashes execute automatically; a user-authored pack needs the one-time `ack` before its entry runs. |
| Exit 0 with `RESULT: pass` | Record pass; include the `0 invariants` note when the resolver emits it. |
| Any other exit (incl. 64 usage error, e.g. non-numeric `code_intel_gate_timeout`) | Record `Code-intel gate: DEGRADED (resolver error <N> — check code_intel_gate_timeout and resolver availability)`; verdict unaffected. |

Multiple gate packs: the resolver already runs all of them in lexicographic order — the
report MUST attribute the result per pack (the `GATE <name>: exit N` lines).

### 4. TUI check (if applicable)

If the scope contains a TUI interface and `tunables.require_tmux_matrix_for_tui: true`.
When `briefs/<task>-qa-scope.md` defines TUI scenarios, execute **those scenarios** in
the tmux session (in addition to the baseline checks below) and record each one's
outcome in the report:

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

If none is present (or the only one is the host runtime), **skip silently**. Otherwise run the
provider-free shared-breaker check first, using the same `--write` mode as the eventual QA
invocation:

```bash
node scripts/xruntime-review.js <runtime> --task <task-slug> --phase qa --check-availability --write
```

`status: "skipped-degraded"` means review already proved this runtime version degraded under either
standard review/QA sandbox mode: do not invoke it again, and record
`Cross-runtime QA: skipped (review breaker, unchanged runtime version)`. `status: "available"`
permits one QA attempt. A nonzero/blocked result is QA **NO-GO** because the
persisted review state cannot be trusted. `--human-retry` is the explicit override; never infer it.

When available, write the QA prompt to a scratch file and invoke via the wrapper
`bash scripts/xruntime-exec.sh <runtime> --prompt-file=<scratch-file> --write` (streams the
prompt with EOF, keeps large content out of argv, sets the runtime's flags, file-captures output,
and tree-integrity-snapshots the run — exit 3
means the second runtime mutated the tree) and have the second runtime **independently re-run the deterministic gates** (step 2's
commands and, if it ran in the primary pass, the step 3.5 code-intel gate command —
`node scripts/code-intel-resolve.js gate --timeout ${code_intel_gate_timeout:-120}`) and
re-check the implementer's handoff claims — it does not see the primary QA
result first. Remove the scratch prompt file after the wrapper returns. Record its outcome in the
report under a `## Cross-runtime QA` section.

**Block on discrepancy:** if the second runtime reports a gate FAIL or a disputed claim that
the primary run passed (a CRITICAL/HIGH discrepancy), the verdict is **NO-GO** — a gate that
only passes under one runtime is not a pass. Surface the exact divergence.

### 4.7 QA round state — derive, gate, persist (spec: specs/qa-loop-bounding.md, FR-260..286)

Bounds the review-GO → QA-NO-GO → implement loop (FR-032 residual of
`specs/pipeline-loop-convergence.md`, now superseded — see that spec's FR-032). Runs on **every**
verdict emission, GO included. Full field shapes: `schema/qa-state-schema.md`.

**1. Determine this verdict's causes** from the steps that actually ran:

| Step outcome | Cause |
|---|---|
| Step 2 gate failure | `gate-failure` |
| Step 3 spec runnable-check FAIL | `spec-check-failure` |
| Step 3.5 exit 1 (invariant violated) | `code-intel-violation` |
| Step 3.5 exit 2 (malformed block) | `code-intel-malformed` |
| Step 4 TUI failure | `tui-failure` |
| Step 4.5 cross-runtime discrepancy | `cross-runtime-discrepancy` |

A GO verdict records `causes: []`. Step 2's short-circuit (stop at first gate failure, do not
continue) means most NO-GOs carry a single cause; only a round that ran past Step 2 can accumulate
more than one (EC-4) — record every cause that applies, never just the first.

**2. Derive round/cycle** by shelling out (never re-derive in prose, FR-261):

```bash
node scripts/lib/review/review-lifecycle.js --prior briefs/<task>-qa-state.json
```

→ `{round, cycle, fresh_cycle}` (absent prior file is legitimate fresh-task input; a present-but-
invalid-JSON prior fails closed — surface the lifecycle's exit 2, do not guess). **Note:** the CLI
returns only `{round, cycle, fresh_cycle}` — it does NOT return `rounds_audit`. Read the prior
`briefs/<task>-qa-state.json` yourself (if present) and carry its `rounds_audit` forward verbatim
when `fresh_cycle` is false; start from `[]` when `fresh_cycle` is true. Carry `cross_runtime`
forward the same way (C-2, inert — QA never reads or interprets it).

**3. Compute `qa_no_go_round`** (two counters, never conflated — FR-267):
- GO verdict → reset to `0` (cycle-final budget reset).
- NO-GO verdict → prior `qa_no_go_round` (0 on a fresh cycle) **+ 1 iff** at least one recorded
  cause is qualifying (`gate-failure`, `spec-check-failure`, `code-intel-violation`,
  `tui-failure` — see the `[NEEDS-HUMAN]` note in `scripts/lib/qa/qa-convergence-rules.js` for the
  C-4 interpretation this rests on), else unchanged (`cross-runtime-discrepancy` /
  `code-intel-malformed` alone never increment it, FR-269/FR-270).

**4. Append the `rounds_audit` entry** (append-only within the cycle, FR-265):
`{round, date, verdict, causes, qualifying}` where `qualifying` is whether step 3's `+1` fired.

**5. Compose the draft, gate it, before persisting anything** (fixed order, C-5):

Write the composed state to `briefs/<task>-qa-state.json.draft`, then:

```bash
node scripts/check-qa-convergence.js briefs/<task>-qa-state.json.draft --max-rounds <tunables.max_qa_rounds>
```

- **Exit 0** — proceed to step 6.
- **Exit 1** (`cause: "qa-round-cap"`) — the loop-back to `/roster-implement` is **BLOCKED**
  (FR-273). Record `escalation: "qa-not-converging"` in the persisted state. This is a **human
  decision point, non-overridable** (FR-275 — no `streak_override` analogue exists for QA):
  present the `rounds_audit` trail and recorded causes, and offer the exits — revise the spec via
  `/roster-spec` (Fast mode: stated explicitly as restart-under-full, FR-277), re-review via
  `/roster-review`, or split/abandon the task. **MUST NOT** auto-route to any of them (FR-274).
- **Exit 2** — degraded input (schema-invalid or malformed draft). Fail-closed: block the
  route-back, surface the gate's stderr message to the human, stop.
- **Exit 3** (`process-incomplete-only` — the draft's `rounds_audit` is missing/incomplete for the
  current round) — repair the draft per the violation detail and re-gate, bounded to **2 attempts
  total**; do not bump `round` again (no re-invocation of the lifecycle CLI). If still exit 3 after
  2 attempts, stop and surface to the human. This cause never reaches routing.

**6. Persist, in this fixed order** (FR-286 — a crash between these two writes leaves the
persisted state authoritative and the report stale, never the reverse): write the gated draft to
`briefs/<task>-qa-state.json` exactly once, remove the `.draft` file, **then** write
`briefs/<task>-qa.md` (step 5) last.

### 5. Write the QA report

**Report format contract (load-bearing):** the verdict line MUST be exactly `**Status:** GO ✅` or `**Status:** NO-GO ❌`, at the start of a line — the ship-gate hook greps `^\*\*Status:\*\* GO`. Do not inline the status into another sentence, indent it, or reword it; a report that fails this grep is rejected by the gate even if the verdict is GO.

**Manual hook invocation:** the pre/post skill hooks require the task slug via the `TASK` environment variable — e.g. `TASK=<slug> node .harness/bin/run-hook.js pre|post <skill>`. Without `TASK` the hook aborts.

Produce `briefs/<task>-qa.md`:

```markdown
# QA Brief — <task-slug>

**Date:** <ISO-8601>
**Status:** GO ✅ / NO-GO ❌
**Round:** <N> (qualifying <k>/<max_qa_rounds>)

## Round state

<one line: fresh cycle round 1, or "round N in this cycle, qa_no_go_round k/<max_qa_rounds>
(causes: <list>)". On a qa-round-cap escalation, state it explicitly here as well as in Verdict.>

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
**NO-GO, qa-round-cap hit** — STOP. The QA loop has not converged after `<max_qa_rounds>`
qualifying rounds. This is a non-overridable human decision point (FR-275) — do NOT return to
`/roster-implement`. Present the `rounds_audit` trail and offer: revise the spec (`/roster-spec`),
re-review (`/roster-review`), or split/abandon the task.
```

### 6. Human gate

Present the report and request validation. Surface `**Round:**` and, on a `qa-round-cap`
escalation, the full `rounds_audit` trail with recorded causes (FR-266) — this is the only
information the human decision point has to work with.
If NO-GO (not cap-hit): suggest returning to `/roster-implement` with the exact reason.
If NO-GO (cap-hit): present the exits per the Verdict section above; do not pick one.

## Output Contract

`briefs/<task>-qa.md` with GO or NO-GO status documented, and `briefs/<task>-qa-state.json` with
the persisted round state (schema: `schema/qa-state-schema.md`).

**If GO:** `/roster-ship` can start.
**If NO-GO:** return to `/roster-implement` with the error log in the brief.
**If NO-GO with `qa-not-converging` escalation:** STOP at the human decision point — no automatic
route (FR-274).

## When to Go Back

| Condition | Action |
|---|---|
| Automated gate fails (build, tests, lint) | Stop — return to `/roster-implement` with the exact error log |
| Manual verification reveals a regression not caught by tests | Stop — return to `/roster-implement` |
| `scripts/check-qa-convergence.js` exits 1 (`cause: "qa-round-cap"`) | STOP — human decision point (non-overridable): `/roster-spec`, `/roster-review`, or split/abandon. Never auto-route. |

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
- Always gate the composed `qa-state.json.draft` with `scripts/check-qa-convergence.js` BEFORE
  persisting `qa-state.json`, and persist `qa-state.json` BEFORE writing `qa.md` (C-5/FR-286) —
  never the reverse
- The `qa-round-cap` escalation is never overridable — no override field is honored, by the skill
  or the gate (FR-275)
