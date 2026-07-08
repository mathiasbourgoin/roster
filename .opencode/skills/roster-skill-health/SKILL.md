---
name: roster-skill-health
description: Periodic friction analysis — proposes new skills, deterministic tools, and adaptations.
when_to_use: "Use periodically (every 5-10 pipeline cycles) to cluster friction-log patterns into improvement proposals. Trigger: 'analyze friction', friction-count reminder."
version: 1.3.0
domain: meta
phase: null
preamble: true
friction_log: false
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: after
tunables:
  health_schedule: manual
  min_entries_for_signal: 3
artifacts:
  reads:
    - skills-meta/friction.jsonl
  writes:
    - skills-meta/health-<date>.md
pipeline_role:
  triggered_by: human (periodic or after friction accumulation)
  receives: skills-meta/friction.jsonl
  produces: skills-meta/health-<date>.md with approved proposals
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


# Roster Skill Health

You analyze accumulated frictions in the project to propose systemic improvements: new skills, deterministic tools, adaptations of existing skills, or new agents.

Only propose what is justified by the data. No speculative proposals.

## Input Contract

Read `skills-meta/friction.jsonl`.

### Cold start (file absent or empty)

If `skills-meta/friction.jsonl` does not exist or is empty:

1. Create the file:
```bash
mkdir -p skills-meta
touch skills-meta/friction.jsonl
```

2. Ask the user an open question:
> "The friction log is empty — the metabolism is starting now.
>
> Are you encountering frictions in your work with AI agents on this project?
> For example:
> - analyses you do manually that could be automated?
> - repetitive workarounds you apply every time?
> - missing tools for your domain (red teaming, TUI, OCaml, ...)?
>
> Describe freely — I will structure this and add it to the log."

3. If the user describes frictions → structure them into JSONL entries and add them.
4. Produce a report `skills-meta/health-<date>.md` with proposals from these initial frictions.
5. If no frictions described → note "no initial frictions" and suggest re-running after a few cycles.

## Steps (normal run)

### 1. Parse the log

```bash
cat skills-meta/friction.jsonl
```

Extract all entries. Entries with `"frictions": []` count as clean runs (positive signal) but do not generate clusters.

### 2. Clustering by theme

Group entries by coherent theme:
- Same skill + same friction type
- Same repeated workaround
- Same `suggestion_type`
- Same functional domain

Calculate for each cluster:
- Frequency (number of occurrences)
- Affected skills
- Dominant estimated effort (small / medium / large)

### 3. Filter relevant signals

Threshold: `tunables.min_entries_for_signal` occurrences in a cluster.
Below threshold → note in the report, do not propose action.

### 4. Produce proposals

Six categories (A–F), in recommended priority order. **This A–F tag list is the shared
contract with `/roster-skill-evolve`** — every tag emitted here has a matching handler there;
a change to this list is a change to both skills.

#### A. New skills

Signal: recurring thematic friction (≥ threshold), consistent across multiple runs.

```
**[SKILL] roster-<suggested-name>**
Signal: <N> occurrences across <affected skills>
Frictions covered: <list>
Description: <what the skill would do>
Estimated effort: small / medium / large
```

#### B. Deterministic tools (scripts, binaries)

Signal: same manual workaround repeated, `effort_estimate: small` dominant.

```
**[TOOL] scripts/<name>.sh**
Signal: <N> occurrences of workaround "<workaround>"
Proposed tool: <description>
Impact: <friction eliminated>
Effort: small (~<N>h)
```

#### C. Adaptations of existing skills

Signal: friction tied to a specific step of an identified skill.

```
**[ADAPT] roster-<skill-name> → v<X.Y+1>**
Friction: "<description>"
Adaptation: <what changes>
Impacted section: <Steps N / Rules / Input Contract>
```

#### D. Skill hooks

Signal: `min_entries_for_signal` (default: 3) friction entries on the same skill with `type: workaround`, where the workaround pattern is a guard check (validate precondition before running), a post-run cleanup, or a feedback loop (run → check → fix → retry).

```
**[HOOK] .harness/hooks/skills/<skill-name>/<pre|post>.md**

Signal: <cite 1–2 friction entries>
Problem: <what recurring manual step / guard / feedback loop is being done by hand>
Proposed hook: <phase> hook for `<skill-name>` — <one-sentence description of what the hook automates>
Expected friction reduction: <count> workaround entries eliminated
```

**`[HOOK]` trigger signals:**
- ≥ `min_entries_for_signal` friction entries on the same skill with `type: workaround`
- The workaround is a guard check (`effort_estimate: small`) or feedback loop (`effort_estimate: medium`)
- A linter pass or metric-based signal is a bonus, not required

**Hook lifecycle proposals (sub-section):**
- **hook→skill migration:** If a hook has 100% pass rate over ≥10 runs logged in `friction.jsonl`, propose absorbing its logic into the skill's `## Steps` section as a first-class step, then deleting the hook.
- **skill→hook extraction:** If a guard or cleanup prose pattern appears verbatim in 3+ skill files, propose extracting it to a shared hook fragment in `.harness/hooks/shared/`.

**Additional `friction.jsonl` fields for hook-enabled runs:**
```jsonl
{"hook": "pre | post", "outcome": "pass | warn | abort | pending", "duration_ms": 1200, "loop_iterations": null}
```
These records are appended automatically by the hook runner — **this skill is a read-only consumer; `scripts/run-hook.ts` is the single writer**. `outcome: skip` is never logged (nothing executed); `loop-N` outcomes and non-null `loop_iterations` are reserved for future native loop execution. `duration_ms` is real wall-clock time measured by the runner. Health analysis may filter on `"hook": "pre"` to identify pre-hook friction separately from skill friction.

#### E. New dedicated agents

Signal: `suggestion_type: "agent"` repeated, `effort_estimate: large`.

```
**[AGENT] <agent-name>**
Signal: <N> occurrences, large effort
Domain: <domain>
Role: <description>
Next step: recruiter + skill-creator
```

#### F. Workflow template promotion

Signal: ≥ `min_entries_for_signal` workflow instances (`workflows/*.cwr.json`, excluding
`templates/`) sharing the same structural diff vs. their source template. Detection here is
cheap — list the instances and group them by source template (match each instance's step
sequence against `workflows/templates/*.cwr.json`; the version string alone does not
identify a template). Emit the proposal only when one group reaches the threshold, and mark
it *unconfirmed* — the precise per-step diffing happens in `/roster-skill-evolve`'s handler:

```bash
ls workflows/*.cwr.json 2>/dev/null | grep -v 'templates/'
```

```
**[WORKFLOW] workflows/templates/<mode>.cwr.json**
Signal: <N> instances diverge from template <mode> in the same way
Divergence: <one-sentence description of the shared modification>
Proposed promotion: fold the shared diff into the template
```

### 5. Report

Produce `skills-meta/health-<YYYY-MM-DD>.md`:

```markdown
# Skill Health Report — <date>

**Entries analyzed:** <N total> (<N> with frictions, <N> clean runs)
**Clusters identified:** <N>
**Proposals:** <N>

## Proposals (strong signals)

<proposals A–F>

## Weak signals (< threshold — to monitor)

<entries below threshold>

## Stability

<N> clean runs — stable skills: <list>
```

### 6. Human gate

Present the report and ask:
> "Which proposals do you approve? I will mark them APPROVED for `/roster-skill-evolve`."

## Output Contract

`skills-meta/health-<date>.md` with approved proposals marked `**APPROVED**`.

**Next:** `/roster-skill-evolve` with the report as input.

## When to Go Back

| Condition | Action |
|---|---|
| No friction log found and user reports no frictions | Note "no initial frictions", suggest re-running after 3–5 more cycles |
| Signal clusters are below `tunables.min_entries_for_signal` | Do not propose actions — note as weak signals to monitor |

## What Next

**Primary path (proposals exist):** `/roster-skill-evolve` — pass the health report as input
**Optional — after proposals approved:** `/improvement-loop-planner` — converts approved proposals into bounded, measurable improvement loops with explicit success signals, guard conditions, and iteration budgets. Run this when ≥2 proposals are APPROVED and you want structured execution plans rather than open-ended implementation.
**Primary path (no proposals):** Done — re-run after more pipeline cycles

> 💡 Run after every 5–10 pipeline cycles to maintain a healthy improvement metabolism.

## Rules
- Cold start: create the file, query the user, do not block on missing data
- Clean runs are a positive signal to name explicitly
