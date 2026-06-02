# Skill Hooks

## 1. Introduction

Skill hooks are declarative automation files that run **before** (`pre`) or **after** (`post`) a skill is dispatched by `roster-run`. They let you add guard checks, post-run cleanup, or agentic feedback loops to any skill — without modifying the skill itself.

Skill hooks are distinct from **tool-level hooks** (which intercept Bash/Edit/Write tool calls in `settings.json`). Skill hooks operate at the pipeline level: they are executed by the LLM agent reading a `.md` file and interpreting its `steps:` YAML block. There is no separate process runner.

**Typical use cases:**

- Guard a spec step behind a validated intake brief (pre-hook)
- Run tests after implementation and retry if they fail (post-hook)
- Log start/end timestamps around slow skills (pre + post)
- Validate a precondition and emit a user-readable error if it fails (pre-hook with `on_error: stop`)

---

## 2. Quick Start

Create the hook file at `.harness/hooks/skills/<skill-name>/pre.md`:

```markdown
---
name: spec-intake-guard
version: 1.0.0
event: pre
skill: roster-spec
on_error: stop
description: Abort spec if intake brief is absent or not validated.
---

Ensures that a validated intake brief exists before roster-spec runs.

\`\`\`yaml
steps:
  - run: "[ -f briefs/$(echo $TASK)-intake.md ] && grep -q 'Status: VALIDATED' briefs/$(echo $TASK)-intake.md"
    on_error: stop
  - log: "✓ intake brief validated — proceeding to spec"
\`\`\`
```

That is a complete, working pre-hook. When `roster-run` routes to `roster-spec`, it will:

1. Find `roster-spec`'s `name:` frontmatter field (`roster-spec`).
2. Check for `.harness/hooks/skills/roster-spec/pre.md`.
3. Execute the steps above.
4. If the `run:` step exits non-zero, print an abort message and skip the skill dispatch.

---

## 3. Hook File Format

### Frontmatter Fields

| Field | Required | Values | Default |
|---|---|---|---|
| `name` | ✅ | kebab-case string | — |
| `version` | ✅ | bare semver `X.Y.Z` | — |
| `event` | ✅ | `pre` \| `post` | — |
| `skill` | ✅ | target skill `name:` field | — |
| `on_error` | ✅ | `stop` \| `warn` \| `skip` \| `ignore` | `stop` (pre) / `warn` (post) |
| `description` | ⬜ | one-line summary | — |

### Discovery Path

`roster-run` discovers hooks using the `name:` frontmatter field of the target skill file as the lookup key:

```
.harness/hooks/skills/<skill-name>/pre.md    ← pre-hook
.harness/hooks/skills/<skill-name>/post.md   ← post-hook
```

If neither file exists, the skill runs without hooks. If both exist, `pre` runs before, `post` runs after.

### Body Format

After the frontmatter, the hook body has two optional sections:

1. **Prose documentation** — what the hook does, why it exists, any caveats.
2. **Steps block** — a fenced ` ```yaml ` block containing a `steps:` array.

---

## 4. DSL Reference

### `run:`

Execute a shell command via the Bash tool.

```yaml
- run: "npm test"
  on_error: stop        # step-level override (optional)
```

- Non-zero exit code = failure.
- `on_error:` at step level overrides the hook-level default.

---

### `prompt:` + `agent:`

Invoke a named skill or agent with a text prompt.

```yaml
- prompt: "Tests failed. Fix and retry."
  agent: roster-implement
  on_error: warn
```

- `agent:` is **required** on every `prompt:` step.
- **`ABORT:` sentinel:** The step fails if the **entire** first non-empty line of agent output equals (after stripping leading whitespace):
  ```
  ABORT: <reason>
  ```
  Any other occurrence of the word "ABORT" in the response is ignored.

---

### `on_error:`

Controls what happens when a step fails. Can be set at hook level (frontmatter) or step level (overrides hook default).

| Value | Behavior |
|---|---|
| `stop` | Abort hook; for pre-hooks, cancel skill dispatch with user-visible message |
| `warn` | Log the failure and continue |
| `skip` | Skip the current step, continue |
| `ignore` | Silently continue |

> For a real retry loop, use the dedicated `retry:` step type (with optional `backoff:`) — see the step-type table — rather than an `on_error` value.

**Defaults by phase:**
- `pre` hooks: `stop`
- `post` hooks: `warn`

---

### `test:`

Run a Bash command as a boolean branch.

```yaml
- test: "[ -f .harness/hooks/skills/roster-spec/pre.md ]"
  on_true:
    - log: "pre hook exists"
  on_false:
    - run: "mkdir -p .harness/hooks/skills/roster-spec"
```

- Exit 0 = true → execute `on_true:` steps.
- Non-zero = false → execute `on_false:` steps.
- `on_true:` and `on_false:` are sub-lists of steps with the same DSL.

---

### `loop:`

Execute a list of steps repeatedly.

```yaml
- loop:
    steps:
      - run: "npm test"
      - prompt: "Fix test failures"
        agent: roster-implement
    until: "npm test"
```

- `steps:` is required.
- `until:` is optional — a Bash command; exit 0 = done, stop looping.
- **Without `until:`, the loop runs indefinitely.** This is intentional and allowed, but the linter will warn. Do not use unbounded loops in production pre-hooks without explicit understanding of termination conditions.

> ⚠️ Do not copy-paste loops without understanding their termination conditions. An unbounded pre-hook will hang every skill dispatch.

---

### `goto:` + `label:`

Jump to a named position in the same hook.

```yaml
- label: retry-point
- run: "some-command"
  on_error: skip
- goto: retry-point    # loops back to label (use with care)
```

- `label:` marks a position — no-op execution.
- `goto:` jumps to the named `label:` in the **same file**.
- In **post-hooks only**, `goto:` may also target a roster pipeline step name (e.g., `goto: roster-implement`). **This skips mandatory pipeline phases — use with full understanding of the consequences.** The linter will warn.
- `goto:` in **pre-hooks** to pipeline steps is flagged by the linter (warning, not error).

---

### `timeout:`

Advisory time budget in milliseconds.

```yaml
- timeout: 5000
```

- **LLM best-effort only — not enforced.** The agent notes the budget and uses judgment.
- No hard timer, no automatic abort.

---

### `log:`

Print a message to the user.

```yaml
- log: "Running pre-hook validation..."
```

---

### `retry:` + `backoff:`

Retry the **previous** step up to N times.

```yaml
- run: "flaky-command"
- retry: 3
  backoff: 1000    # optional: ms between retries
```

- `backoff:` is optional (ms).
- Retry applies to the step immediately preceding `retry:` in the steps list.

---

### `include:`

Include a shared hook fragment. **Build-time only** — `sync-harness.sh` inlines the content before runtime. There are no runtime file reads for `include:` steps.

```yaml
- include: shared/validate-brief.md
```

- Path is relative to `.harness/hooks/shared/`.
- `sync-harness.sh` replaces the `include:` line with the file's content and writes a `.inlined.md` variant alongside the original.
- `roster-run` reads `.inlined.md` if present, falling back to the original.

---

### `output:`

Note that this step produces structured output under a named key.

```yaml
- output: test-results
```

- Purely declarative in v1 — informs downstream agents reading hook output.

---

### `parallel:`

> ⚠️ **Not true concurrency.** In v1, `parallel:` is a prose-parallelism hint only. The LLM executes agents **sequentially**. `first-wins` and `collect-all` are no-ops.

```yaml
- parallel:
    agents:
      - roster-implement
      - roster-review
    on_error: collect-all    # no-op in v1
```

The linter will warn whenever `parallel:` appears in a hook file.

---

## 5. Worked Example 1: Pre-Hook Guard for `roster-spec`

**Goal:** Abort `roster-spec` if the intake brief is absent or not validated. Prevent invalid spec runs from wasting pipeline cycles.

**File:** `.harness/hooks/skills/roster-spec/pre.md`

```markdown
---
name: spec-intake-guard
version: 1.0.0
event: pre
skill: roster-spec
on_error: stop
description: Abort spec if intake brief is absent or not validated.
---

Checks that `briefs/<task>-intake.md` exists and contains `Status: VALIDATED`
before allowing `roster-spec` to run. If either condition fails, the hook
stops with a user-visible message.

\`\`\`yaml
steps:
  - log: "⏳ spec-intake-guard: checking intake brief..."

  - test: "[ -n \"$TASK\" ]"
    on_false:
      - log: "ERROR: $TASK variable is not set — cannot locate intake brief"
      - run: "exit 1"

  - test: "[ -f \"briefs/${TASK}-intake.md\" ]"
    on_true:
      - log: "✓ intake brief found: briefs/${TASK}-intake.md"
    on_false:
      - log: "MISSING: briefs/${TASK}-intake.md not found — run /roster-intake first"
      - run: "exit 1"

  - test: "grep -q 'Status: VALIDATED' \"briefs/${TASK}-intake.md\""
    on_true:
      - log: "✓ intake brief is VALIDATED — proceeding to spec"
    on_false:
      - log: "BLOCKED: briefs/${TASK}-intake.md exists but Status is not VALIDATED"
      - run: "exit 1"
\`\`\`
```

**What happens at runtime:**

1. `roster-run` routes to `roster-spec` for task `my-feature`.
2. It finds `roster-spec`'s `name: roster-spec` frontmatter.
3. It loads `.harness/hooks/skills/roster-spec/pre.md`.
4. It executes the steps. If `briefs/my-feature-intake.md` is absent, the `run: "exit 1"` step exits non-zero, `on_error: stop` fires, and `roster-run` prints an abort message without dispatching `roster-spec`.

---

## 6. Worked Example 2: Post-Hook Agentic Feedback Loop for `roster-implement`

**Goal:** After implementation, run tests automatically. If they fail, invoke `roster-implement` again with the failure context. Repeat until tests pass.

**File:** `.harness/hooks/skills/roster-implement/post.md`

```markdown
---
name: implement-test-loop
version: 1.0.0
event: post
skill: roster-implement
on_error: warn
description: Run tests after implementation; retry roster-implement if tests fail.
---

Post-hook that runs `npm test` after each roster-implement invocation.
If tests fail, it asks roster-implement to fix them, then re-runs.
The loop continues until tests pass.

⚠️ WARNING: This hook uses an unbounded loop. If the implementation
consistently fails tests (e.g. due to a structural issue), this will
loop indefinitely. Only install this hook on projects where you are
confident in the feedback signal.

\`\`\`yaml
steps:
  - log: "🔁 implement-test-loop: running test suite..."

  - loop:
      steps:
        - run: "npm test"
          on_error: skip

        - test: "npm test"
          on_true:
            - log: "✓ tests pass — hook complete"
            - goto: done
          on_false:
            - log: "✗ tests failed — invoking roster-implement to fix"
            - prompt: |
                The test suite failed after your last implementation pass.
                Read the output of `npm test`, identify the root causes,
                and fix them. Do not refactor unrelated code.
              agent: roster-implement

      until: "npm test"

  - label: done
  - log: "implement-test-loop: exiting"
\`\`\`
```

**What happens at runtime:**

1. `roster-implement` completes its implementation pass.
2. `roster-run` finds `.harness/hooks/skills/roster-implement/post.md`.
3. It executes the loop: runs `npm test`, and if failing, invokes `roster-implement` again with context.
4. Loop repeats until `until: "npm test"` exits 0.
5. Post-hook `on_error: warn` means test failures are logged but do not retroactively fail the skill outcome.

---

## 7. Discovery and Linting

### Where to Put Hook Files

```
.harness/
  hooks/
    skills/
      roster-spec/
        pre.md          ← pre-hook for roster-spec
      roster-implement/
        pre.md
        post.md         ← both phases installed
    shared/
      validate-brief.md ← shared fragment for include:
```

### Running the Linter

```bash
npm run check:hooks
```

This scans `.harness/hooks/skills/` (default) or a path you pass:

```bash
node dist/scripts/check-hook-structure.js .harness/hooks/skills/
```

**Checks enforced (exit 1 on failure):**

| Check | Error |
|---|---|
| YAML frontmatter present | Missing frontmatter |
| `name` present and kebab-case | Invalid or missing name |
| `version` is bare semver | Not X.Y.Z |
| `event: pre` or `event: post` | Missing or invalid event |
| `skill` present | Missing skill target |
| Fenced ` ```yaml ` block with `steps:` | Missing steps block |
| `steps:` is non-empty array | Empty or non-array |
| Each step has exactly one operator key | Unknown operators, multiple operators |
| `prompt:` has co-occurring `agent:` | Missing agent field |
| `include:` path resolvable (if `.harness/` exists) | Fragment not found |
| `goto:` label targets match a `label:` step | Unresolved label |

**Warnings (exit 0):**

| Condition | Warning |
|---|---|
| `loop:` without `until:` | "loop without detectable termination" |
| `parallel:` step | "prose-parallelism hint — executes sequentially" |
| `goto:` from pre-hook to pipeline step | "may bypass pre-hook intent" |

**0 files found:** exits 0, prints `"0 hook files found — nothing to lint"`.

---

## 8. Health Integration

### Friction Log Fields

When a hook-enabled skill run logs to `friction.jsonl`, it emits additional fields:

```jsonl
{"skill": "roster-spec", "hook": "pre", "outcome": "abort", "duration_hint_ms": 340, "loop_iterations": 0, "type": "workaround", ...}
{"skill": "roster-implement", "hook": "post", "outcome": "loop-3", "duration_hint_ms": 4200, "loop_iterations": 3, "type": "rework", ...}
```

- `hook`: `"pre"` or `"post"`
- `outcome`: `"pass"` | `"warn"` | `"abort"` | `"loop-N"` (N = iteration count)
- `duration_hint_ms`: LLM-approximate elapsed time — no wall-clock timer is available
- `loop_iterations`: number of loop iterations completed

### `[HOOK]` Proposals in Health Reports

`roster-skill-health` proposes `[HOOK]` entries when ≥3 friction entries on the same skill have `type: workaround` and the pattern is a guard check or feedback loop:

```
**[HOOK] hooks/skills/roster-spec/pre.md**

Signal: 4 entries — "manually checked intake validated before spec" (2025-05-01, 2025-05-03, ...)
Problem: Engineers manually verify intake status before every spec run
Proposed hook: pre hook for `roster-spec` — check intake validated, abort with message if not
Expected friction reduction: 4 workaround entries eliminated
```

Hook lifecycle proposals also appear in health reports:

- **hook→skill migration:** If a hook has 100% pass rate over ≥10 logged runs, health proposes absorbing its logic into the skill's `## Steps` as a first-class step.
- **skill→hook extraction:** If a guard pattern appears verbatim in 3+ skill files, health proposes extracting it to `.harness/hooks/shared/`.

---

## 9. Reliability Caveats

> Read this section before deploying hooks in production.

### Non-Reentrance Is Convention, Not Mechanism

`roster-run` uses a prose flag `HOOK_RUNNING` to prevent hooks from firing on nested skill invocations (depth > 1). This is a **documentation-level convention enforced by LLM instruction** — there is no process-level mutex, no OS signal, and no guarantee. A sufficiently complex hook sequence could bypass this guard.

**Mitigation:** Keep hooks simple. Do not invoke skills from within hooks that themselves dispatch skills with hooks.

### `parallel:` Is Sequential in v1

`parallel:` steps execute listed agents **one at a time** in order. `first-wins` and `collect-all` modes are defined in the schema but are **no-ops in v1**. Do not design hooks that depend on true parallel execution.

### `timeout:` Is Advisory

`timeout: <ms>` sets a time budget that the LLM **notes and uses as best-effort guidance**. There is no enforced hard cutoff, no alarm, and no automatic abort. A slow hook step will run until the LLM decides to stop.

### Unbounded `loop:` Without `until:`

A `loop:` step without `until:` runs indefinitely. In a pre-hook, this means **every dispatch of the target skill will hang** until the loop is externally interrupted (or the session times out).

> Do not use unbounded loops in production pre-hooks without a termination condition.

The linter warns on every `loop:` without `until:` — heed this warning.

### `goto:` in Post-Hooks Can Skip Mandatory Pipeline Phases

`goto:` in a post-hook can jump to a named roster pipeline step. If that step is upstream of mandatory quality gates, those gates will be skipped. This is intentional governance bypass — **use only when you fully understand the pipeline consequences.** The linter warns; the tutorial warns; consider yourself warned.

---

## 10. v2 Roadmap

The following features are **planned for v2** and are **absent from v1**:

- `capture: <key>` — capture named output from a step into a variable
- `{{var}}` interpolation — reference captured values in subsequent steps

These features require a binding mechanism that was not designed in time for v1. Do not attempt to use `capture:` or `{{var}}` syntax — the linter will flag them as unknown operators.

---

## 11. Hook Executor Exit Codes

`scripts/run-hook.ts` is compiled to `dist/scripts/run-hook.js` via `npm run build:ts`. Invoke directly:

```bash
# CLI is: run-hook.js <pre|post> <skill-name>   (event + skill, NOT a file path)
npm run build:ts && node dist/scripts/run-hook.js pre roster-spec
```

It returns the following exit codes, consumed by `roster-run` to decide whether to dispatch the skill.

| Code | Meaning | roster-run behaviour |
|------|---------|----------------------|
| **0** | `pass` — all steps completed successfully | Dispatch the skill normally |
| **1** | `abort` — a `run:` step failed with `on_error: stop`, or a `retry:` exhausted all attempts | **Block** skill dispatch; print abort reason |
| **2** | `warn` — a step failed with `on_error: warn` and execution continued | Dispatch the skill; log the warning |
| **3** | `pending` — hook contains `prompt:`, `loop:`, or `parallel:` steps that require LLM interpretation | Hand remaining steps back to the LLM agent; it decides whether to proceed |
| **4** | `skip` — the re-entrance guard `ROSTER_HOOK_RUNNING` was set (hook called from within a hook) | Skip hook silently; dispatch the skill normally |

**Rule of thumb for hook authors:** if your pre-hook must block the skill on failure, use `on_error: stop` on the `run:` step. Exit 1 is the only code that prevents dispatch.
