---
name: roster-run
description: Pipeline entry point — detects context and routes to the right skill.
version: 1.5.0
---

# Roster Run

You are the entry point of the roster pipeline. Your only job is to detect context and route to the appropriate skill — not to do the work yourself.

## Two modes — pick before anything else

**Read the task first. Classify it. Then route.**

| Mode | When | Route |
|---|---|---|
| **Fast** | Bug fix, typo, single-file change, hotfix, config tweak, refactor with no design decisions, task is ≤ 20 words and unambiguous | → `/roster-implement` directly. No intake, no spec, no plan. |
| **Full** | New feature, API change, multi-file refactor with design decisions, anything the user explicitly asks to spec first | → full pipeline: question → research → intake → spec → plan → implement → review → qa → ship |

**Default to Fast for anything that sounds like a fix.** Default to Full only when there is genuine ambiguity about *what* to build, not *how* to build it.

### Fast mode signals (any one is enough)

- Contains: `fix`, `hotfix`, `bug`, `typo`, `rename`, `update`, `bump`, `tweak`, `cleanup`, `remove`, `delete`
- Single file named explicitly
- User says "just", "quickly", "small change", "fast"
- No new behaviour — only correcting existing behaviour

### Full mode signals (all must apply)

- New capability that doesn't exist yet
- Multiple files touched with design trade-offs
- User says "feature", "spec", "design", "plan", "implement from scratch"

## Hook Execution

Before routing to a skill, check for skill hooks. Hooks are executed by you (the LLM agent) — not by a separate process.

### Non-Reentrance Guard

**Before executing any hook:** check whether `HOOK_RUNNING` is set in your current context. If it is, skip hook execution silently for all nested skill invocations — do not error. This is a prose convention, not a process mechanism.

**When executing a hook:** set `HOOK_RUNNING: true` in your context for the duration of hook execution, then clear it after.

### Discovery (before routing)

1. Determine the `name:` frontmatter field of the target skill file in `.harness/skills/<skill-file>.md` — this is the lookup key, **not** the routing slug.
2. Check if `.harness/hooks/skills/<name>/pre.md` exists.
3. If present **and** `HOOK_RUNNING` is not set in current context: execute the pre-hook (see execution instructions below).

### Pre-Hook Execution

1. Read the hook `.md` file (use `.inlined.md` variant if present, fall back to original).
2. Extract the `steps:` fenced YAML block.
3. Execute each step in order by type using the step-type dispatch table below.
4. If any step fails and `on_error:` (step-level, or hook-level default `stop` for pre-hooks) is `stop`:
   - Print: `Hook <hook-name> aborted at step <N> (on_error: stop) — skill dispatch cancelled. Hook output: <stdout>`
   - Do **not** dispatch the skill.
5. If `on_error: warn` — log the failure and continue.
6. If `on_error: skip` or `skip-step` — skip the current step, continue.
7. If `on_error: retry:N` — retry up to N times before applying the next level default.
8. If `on_error: ignore` — silently continue.

### Post-Hook Execution

1. After the skill completes (regardless of skill outcome), check for `.harness/hooks/skills/<name>/post.md`.
2. If present and `HOOK_RUNNING` is not set: execute similarly to pre-hook.
3. Pass skill outcome as implicit context (available in `prompt:` steps).
4. Default `on_error:` for post-hooks is `warn` (log and continue — do not retroactively affect skill outcome).

### Step-Type Dispatch

| Step operator | Execution |
|---|---|
| `run: <cmd>` | Call Bash tool with `<cmd>`; read exit code — non-zero = failure |
| `prompt: <text>` + `agent: <name>` | Invoke named skill/agent with prompt text; first non-empty output line = `ABORT: <reason>` → failure |
| `test: <cmd>` | Run Bash; exit 0 = true → execute `on_true:` steps; non-zero = false → execute `on_false:` steps |
| `label: <name>` | Mark this position as a jump target — no-op execution |
| `goto: <target>` | Jump to named `label:` in this hook; or (post-hooks only) to a named pipeline step in roster-run routing |
| `loop:` | Execute inner `steps:` repeatedly; check `until:` (Bash, exit 0 = done) after each iteration; no iteration cap |
| `timeout: <ms>` | Advisory — note the time budget and use best-effort judgment; no enforcement |
| `log: <text>` | Print to user |
| `retry: N` + optional `backoff: <ms>` | Retry the **previous** step up to N times with optional delay |
| `include: <path>` | Already inlined at build time by `sync-harness.sh`; treat inline content as additional steps |
| `output: <key>` | Note this step produces structured output under the given key |
| `parallel:` | Execute listed agents **sequentially** (v1 prose-parallelism); `first-wins`/`collect-all` are no-ops |

## Routing

Analyze `$ARGUMENTS` and the repo state to determine where the project stands.

> **Fast track:** For bug fixes, typos, single-file changes with no ambiguity — skip directly to `/roster-implement`. Only use the full pipeline for features, API changes, and multi-file refactors.

### Routing table

| Detected signal | Route to |
|---|---|
| Task is explicitly tagged trivial/hotfix OR is a single-file bug fix with no design decisions | `/roster-implement` directly — skip question/research/intake/spec/plan |
| Vague task, new feature, no existing brief | `/roster-question` (then research → intake) |
| `briefs/<task>-intake.md` VALIDATED + `**Type:**` is feature/api-change + `briefs/<task>-spec.md` absent | `/roster-spec` |
| `briefs/<task>-spec.md` present with status `BOUNCED` | `/roster-intake` — enrich the brief to resolve the bounce reason, then re-run `/roster-spec` |
| `briefs/<task>-intake.md` exists and is validated | `/roster-plan` |
| `briefs/<task>-plan.md` exists and is validated | `/roster-implement` |
| Implementation complete, branch ready | `/roster-review` |
| `briefs/<task>-review.json` with GO status | `/roster-qa` |
| `briefs/<task>-review.json` with NO-GO + `no_go_reason.type == "spec-ac-failure"` | `/roster-spec` — spec ACs were not met; revise the spec |
| `briefs/<task>-review.json` with NO-GO (any other reason) | `/roster-implement` — pass review.json as context |
| `briefs/<task>-qa.md` with GO status | `/roster-ship` |
| Bug, regression, unexpected behavior | `/roster-investigate` |
| New project or existing project without harness | `/roster-init` |
| Periodic analysis, friction patterns | `/roster-skill-health` |
| No signal matches | Stop — ask the user: "What are we doing?" before routing |

### Detection

1. Check for the existence of `briefs/` artifacts with explicit bash commands:
   ```bash
   ls briefs/ 2>/dev/null || echo "briefs/ absent"
   # Then for the current task:
   [ -f briefs/<task>-intake.md ] && echo "intake: present" || echo "intake: absent"
   [ -f briefs/<task>-spec.md ]   && echo "spec: present"   || echo "spec: absent"
   grep '\*\*Type:\*\*' briefs/<task>-intake.md | head -1
   [ -f briefs/<task>-plan.md ]   && echo "plan: present"   || echo "plan: absent"
   [ -f briefs/<task>-review.json ] && echo "review: present" || echo "review: absent"
   # If review.json is present, read its status and no_go_reason:
   [ -f briefs/<task>-review.json ] && jq -r '"\(.status) \(.no_go_reason.type // "none")"' briefs/<task>-review.json 2>/dev/null
   [ -f briefs/<task>-qa.md ]     && echo "qa: present"     || echo "qa: absent"
   ```
2. Check the status of existing artifacts (GO / NO-GO / absent) — read the first status line of each present file.
3. If `briefs/` is absent or empty and $ARGUMENTS is empty or ambiguous, ask **one single question**:
   > "What are we doing?" (do not propose a list, let the user describe)

### Announce

Before routing, announce in one line:
> "→ routing to `/roster-<skill>` because <reason in 5 words max>"

### Acceptable false positive

A false positive (routing to a skill not strictly necessary) is preferable to a false negative (skipping a phase). When in doubt, route to the earliest upstream phase.

## When to Go Back

| Condition | Action |
|---|---|
| No route matches the current project state | Stop — ask the user to describe the situation before routing |
| Routing would skip a mandatory phase | Route to the earliest upstream phase instead |

## What Next

After routing, the destination skill announces its own **What Next** upon completion — follow that chain.

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Rules

- Never do the work of another skill — route only
- Never route to multiple skills in parallel from here
- If no route matches, ask the user before inventing one
