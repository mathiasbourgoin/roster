---
name: roster-run
description: Pipeline entry point — detects context and routes to the right skill.
when_to_use: "Default entry point for any task — classifies Express/Fast/Full and routes. Trigger: '/roster-run', 'work on X', or any task with no obvious phase."
version: 1.7.0
---

# Roster Run

You are the entry point of the roster pipeline. Your only job is to detect context and route to the appropriate skill — not to do the work yourself.

## Three modes — pick before anything else

**Read the task first. Classify it. Then route.**

| Mode | When | Pipeline |
|---|---|---|
| **Express** | No spec/KB impact — typo, rename, formatting, config tweak, dependency bump, doc fix, pure refactor with no behaviour change | implement → review → ship |
| **Fast** | Quick task with potential spec/KB impact — bug fix, small behaviour change, adding a missing case, performance fix | implement → review → qa → (update KB/specs/friction log) → ship |
| **Full** | New capability, API change, design decisions, multi-file refactor with trade-offs, anything the user asks to spec first | question → research → intake → spec → plan → implement → review → qa → ship |

**When in doubt between Express and Fast, pick Fast.** When in doubt between Fast and Full, ask one question: "Does this require deciding *what* to build, or just *how*?" — if only *how*, stay Fast.

> Express and Fast are not shortcuts on quality — review is always mandatory. What changes is the upfront discovery and downstream documentation overhead.

### Express signals (all must apply)

- No new behaviour — same inputs produce same outputs after the change
- No spec, KB, or friction log update needed
- Change is self-evident from the task description alone

### Fast signals (any one is enough)

- Fix to existing behaviour (bug, edge case, missing guard)
- Small addition that doesn't change the overall design
- User says "quickly", "fast", "small", "just fix"
- Task ≤ 20 words and unambiguous but has some spec/KB impact

### Full signals (any one is enough)

- New capability that doesn't exist yet
- API or interface change affecting callers
- Multiple design trade-offs to resolve
- User says "feature", "spec", "design", "plan", "implement from scratch", or asks a question about *what* to build

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
6. If `on_error: skip` — suppress this step's failure and continue.
7. If `on_error: ignore` — silently continue. (For a real retry loop use the dedicated `retry:` step type, not an `on_error` value.)

### Post-Hook Execution

1. After the skill completes (regardless of skill outcome), check for `.harness/hooks/skills/<name>/post.md`.
2. If present and `HOOK_RUNNING` is not set: execute similarly to pre-hook.
3. Pass skill outcome as implicit context (available in `prompt:` steps).
4. Default `on_error:` for post-hooks is `warn` (log and continue — do not retroactively affect skill outcome).

### Step-Type Dispatch

The hook executor (`scripts/run-hook.ts`, CLI: `node dist/scripts/run-hook.js <pre|post> <skill>`) enforces real execution for shell steps. Call it before routing for pre-hooks and after the skill completes for post-hooks.

**Export `TASK=<task-slug>` when invoking** — pipeline hooks reference `${TASK}` to locate
`briefs/<task>-*` artifacts (e.g. the spec/qa/ship gates). The runner inherits the
environment, so set it on the same command; a hook that needs `$TASK` aborts with a clear
message if it is unset.

```bash
TASK=<task-slug> node dist/scripts/run-hook.js pre <skill-name>
# exit 0=pass  1=abort (skip dispatch)  2=warn  3=pending_llm_steps  4=skip (no hook)
```

For steps the runner returns in `pending_llm_steps` (prompt:, loop:, parallel:), execute them as LLM-interpreted steps after reading the JSON output.

| Step operator | Executed by | Behaviour |
|---|---|---|
| `run: <cmd>` | **Runner (real shell)** | Enforced exit code, real timeout via AbortController, retry loop |
| `test: <cmd>` | **Runner** | Real exit code → on_true / on_false branch |
| `timeout: <ms>` | **Runner** | Updates shell timeout for all subsequent `run:` steps |
| `retry: N` + `backoff:` | **Runner** | Real retry loop with setTimeout backoff |
| `log: <text>` | **Runner** | process.stderr.write — always fires |
| `label: <name>` | **Runner** | Jump target (index-based) |
| `goto: <label>` | **Runner** (intra-hook) / **LLM** (pipeline) | Intra-hook: index jump. Pipeline target: returned in pending_llm_steps |
| `on_error: stop/warn/skip/ignore` | **Runner** | Enforced by exit code logic |
| `prompt:` + `agent:` | **LLM** (pending_llm_steps) | Returned by runner, executed by agent |
| `loop:` | **LLM** (pending_llm_steps) | Returned by runner, executed by agent |
| `parallel:` | **LLM** (pending_llm_steps) | Sequential in v1 |
| `include:` | Build-time (sync-harness.sh) | Already inlined as `.inlined.md` variant |
| `output:` | Metadata | Noted, not enforced |

## Routing

**Step 1 — classify the task (Express / Fast / Full).** Do this before checking briefs/.

**Explicit mode override.** If the task text contains a mode flag — `--express`, `--fast`, or
`--full` — or an explicit instruction to force a mode ("do this full", "spec it first"),
honor it verbatim and skip inference. Strip the flag from the task before routing. An explicit
`--full` always wins even on a task that looks trivial; an explicit `--express`/`--fast` is
honored **unless** classification detects a Full signal that would skip a mandatory phase (a
new public API, an unspecced design decision) — in that case, surface the conflict and ask
before downgrading. Otherwise infer the mode from the signals below.

**Step 1.4 — resume from durable state (all modes, before per-mode routing).**
If this task has already run one or more phases, the append-only ledger `briefs/<task>-state.json`
is the authoritative position — read it **here**, before the per-mode routing below, so Express
and Fast tasks resume too (not only Full). Split existence from parse-and-schema validity so a
corrupt or malformed ledger never silently degrades to a stale resume:

```bash
# Canonical ledger-schema gate — IDENTICAL in roster-doctor `status` mode. Keep them in sync.
LEDGER_SCHEMA='
  {express:["implement","review","ship"],
   fast:["implement","review","qa","ship"],
   full:["question","research","intake","spec","plan","implement","review","qa","ship"]} as $seq
  | {intake:["VALIDATED"],spec:["VALIDATED","SKIPPED","BOUNCED"],
     review:["GO","NO-GO"],qa:["GO","NO-GO"],ship:["COMPLETED"],
     question:["COMPLETED"],research:["COMPLETED"],plan:["COMPLETED"],implement:["COMPLETED"]} as $vocab
  | .current_phase as $cp | .mode as $m | (.events[-1]) as $last
  | (.task == $t)
    and ($seq[$m] != null)
    and ($cp|type=="string")
    and (.events|type=="array") and ((.events|length)>0)
    and ($last.phase == $cp)
    and (($seq[$m]|index($cp)) != null)
    and (($vocab[$last.phase] // []) | index($last.outcome) != null)
'
if [ -f briefs/<task>-state.json ]; then
  if jq -e --arg t "<task>" "$LEDGER_SCHEMA" briefs/<task>-state.json >/dev/null 2>&1; then
    jq -r '"phase=\(.current_phase) mode=\(.mode)"' briefs/<task>-state.json
  else
    echo "CORRUPT: briefs/<task>-state.json is invalid JSON or fails the ledger schema"
  fi
else
  echo "no state"
fi
```

The `jq` gate validates the **complete** ledger schema in one predicate: valid JSON; `.task`
equals this task's slug (a copied/misnamed ledger must not authoritatively resume another task);
`.mode ∈ {express,fast,full}`; `.current_phase` is a string **and a member of that mode's
sequence** (an express ledger claiming `spec` is corrupt, not resumable); `.events` is a non-empty
array; the last event's `phase` equals `current_phase`; and the last event's `outcome` is legal
for its phase per the preamble vocabulary (a `ship`/`NO-GO` ledger is corrupt). Nothing downstream
re-checks membership — the gate is authoritative.

- **`CORRUPT`** → **stop.** Do not fall back to brief-file detection or classification — the
  authoritative position is untrustworthy. Report it; tell the user to run
  `/roster-doctor status <task>` or repair/delete the ledger. Resuming from stale briefs risks
  re-running or skipping a phase.
- **`no state`** → fresh task (or one predating state tracking). Skip this step; use the Step 1
  classification and route per the per-mode rules below (Full uses the Detection brief-file table).
- **A `phase=… mode=…` line** → **resume.** The recorded `mode` is authoritative — it overrides
  Step 1 classification (the task already committed to a mode):
  - **express:** `implement → review → ship`
  - **fast:** `implement → review → qa → ship`
  - **full:** `question → research → intake → spec → plan → implement → review → qa → ship`

  (Membership of `current_phase` in this sequence is already enforced by the schema gate above —
  a ledger that fails it never reaches here; it was reported `CORRUPT` and stopped.)

  **If the user passed an explicit `--mode` flag on this resume invocation that *differs* from the
  recorded mode**, do not silently mix a new mode with an old ledger — surface the conflict and
  ask (via the interactive question tool) whether to continue under the recorded mode or restart
  the task under the new mode. The ledger's mode wins unless the user explicitly elects to restart.

  Compute the route from `current_phase` **within that mode's sequence**:

  1. **Terminal.** If `current_phase` is the last phase of its mode's sequence (`ship`), the task
     is **complete** — report done, do not invent a next phase; start a new cycle only if asked.
  2. **Outcome-bearing phases are verdict-aware, not positional.** `intake`, `spec`, `review`, and
     `qa` can complete with a non-success outcome, so do not advance on ledger position alone —
     read that phase's brief and route by its verdict, scoped to the recorded mode. **The verdict
     artifact must exist and carry a recognized verdict** (`briefs/<task>-intake.md` status,
     `briefs/<task>-spec.md` status, `briefs/<task>-review.json` `.status`, `briefs/<task>-qa.md`
     status); if it is absent or unreadable, **stop** with `BLOCKED: missing verdict artifact for
     <phase>` rather than guessing a route.
     - `intake` VALIDATED → next phase in sequence (intake has no other terminal status)
     - `spec` VALIDATED **or** SKIPPED → next phase in sequence (`plan`); `spec` BOUNCED → `/roster-intake`
     - `review` GO → next phase in *this mode's* sequence (express → `ship`; fast/full → `qa`);
       `review` NO-GO with `no_go_reason.type == "spec-ac-failure"` → `/roster-spec` (full only —
       express/fast have no spec phase, so their NO-GO always routes to implement);
       `review` NO-GO (any other reason) → `/roster-implement`
     - `qa` GO → next phase (`ship`); `qa` NO-GO → `/roster-implement`
  3. **Otherwise** (`question`, `research`, `plan`, `implement` — always `COMPLETED`) → the
     positional successor in the mode's sequence.

  Then run **Step 1.5** before re-entering `/roster-implement`. Announce:
  `→ resuming <task> after <current_phase> (<mode> mode)`. roster-run never writes the ledger —
  each phase appends its own event (preamble *Pipeline State*); roster-run only reads it.

**Step 1.5 — environment readiness pre-flight (before any code/test work).**
The moment you are about to route to a phase that builds, tests, or edits code
(`/roster-implement`, and any Full-mode route that leads there), first confirm the project's
dev environment is actually runnable. Invoke `/roster-doctor preflight` (skip only for
pure-doc Express tasks that touch no code, build, or tests).

- If it returns `READY` → continue routing.
- If it returns `NOT-READY: <reasons>` → **stop routing.** Surface the reasons and the
  doctor's install/configure options to the user. Do not enter `/roster-implement` until the
  environment is ready or the user explicitly accepts proceeding. Discovering a missing test
  runner or linter here is far cheaper than failing at the quality gate mid-implementation.

If **Express** mode: announce and route directly through **implement → review → ship**.

If **Fast** mode: announce and route through **implement → review → qa → ship** in sequence. After QA, update KB/specs and friction log if impacted.

If Full mode: check briefs/ state and use the routing table below.

### Full-mode routing table

| Detected signal | Route to |
|---|---|
| No brief, new feature, vague or multi-file task | `/roster-question` (then research → intake) |
| `briefs/<task>-intake.md` VALIDATED + `**Type:**` is feature/api-change + `briefs/<task>-spec.md` absent | `/roster-spec` |
| `briefs/<task>-spec.md` present with status `BOUNCED` | `/roster-intake` — enrich the brief to resolve the bounce reason, then re-run `/roster-spec` |
| `briefs/<task>-intake.md` exists and is validated | `/roster-plan` |
| `briefs/<task>-plan.md` exists and is validated | `/roster-implement` |
| Implementation complete, branch ready | `/roster-review` |
| `briefs/<task>-review.json` with GO status | `/roster-qa` |
| `briefs/<task>-review.json` with NO-GO + `no_go_reason.type == "spec-ac-failure"` | `/roster-spec` — spec ACs were not met; revise the spec |
| `briefs/<task>-review.json` with NO-GO (any other reason) | `/roster-implement` — pass review.json as context |
| `briefs/<task>-qa.md` with GO status | `/roster-ship` |
| Complex bug with unclear root cause, no obvious fix | `/roster-investigate` |
| New project or existing project without harness | `/roster-init` |
| Periodic analysis, friction patterns | `/roster-skill-health` |
| No signal matches | Stop — ask the user: "What are we doing?" before routing |

### Detection

This is the **fresh-task** path for Full mode (no durable ledger — a resumable task is handled
earlier and authoritatively by **Step 1.4** when `briefs/<task>-state.json` exists). It is also
the brief-file source of truth that Step 1.4 reads when routing an outcome-bearing phase
(intake/spec/review/qa) by verdict.

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
> "→ [EXPRESS|FAST|FULL] mode: <route> because <reason in 5 words max>"

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
