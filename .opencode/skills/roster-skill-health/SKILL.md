---
name: roster-skill-health
description: Clusters accumulated friction-log patterns into improvement proposals.
when_to_use: "Use every 5-10 pipeline cycles or when a friction-count reminder fires. Trigger: 'analyze friction'."
version: 1.7.0
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
    - skills-meta/cost.jsonl (optional — advisory context only, see Step 4.5)
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
node scripts/check-friction-shape.js --log skills-meta/friction.jsonl --report
cat skills-meta/friction.jsonl
```

Run the shape check first (`--report` — never let it abort the analysis). Its violations are
themselves a finding: entries missing `classes`, or carrying `other` with no `class_note`, are
the log failing to be an instrument. Report the count in §5 under **Instrument health** — an
analysis run over a log that does not conform is reporting on a broken measurement, and must say
so rather than quietly clustering what happens to be there.

Extract all entries. Entries with `"frictions": []` **and** `"classes": []` count as clean runs
(positive signal) but do not generate clusters. `positive-signal` classes are not frictions:
exclude them from clustering, and count them separately.

### 2. Clustering by theme

**Cluster by `classes` first.** The class is the stable key — it is what makes "is this the same
problem again?" a question the log can answer rather than an impression. Group entries by
coherent theme within a class:
- Same class + same skill
- Same repeated workaround
- Same `suggestion_type`
- Same functional domain

Calculate for each cluster:
- Frequency (number of entries; an entry carrying the class anywhere in `classes` counts once)
- Its class, and the affected skills
- Dominant estimated effort (small / medium / large)
- **Date span** — first and last entry. A class recurring across weeks is a different problem
  from one that produced five instances in a single afternoon.

### 2.5 Recurrence check — `CLASS-NOT-CLOSED`

**Run this for every cluster before writing any proposal.** This is the step that distinguishes
"a new problem" from "the same problem, again" — and it is the whole point of the `classes` field.

For each cluster's class:

```bash
grep -l "class: <class>" skills-meta/health-*.md
```

Then, for each prior report found, determine two facts:

1. **Did a previous report propose against this class?** Every proposal carries a `class:` line
   (see §4) — that is what makes this greppable rather than a re-reading exercise.
2. **Did that proposal ship?** Check the report's human gate (`**APPROVED**`) and then verify the
   change is actually present on disk — the named skill version, the named script, the named
   rule. An approved-but-unshipped proposal is a *closure* failure and is reported as such.

| Prior proposal against this class? | Shipped? | Verdict |
|---|---|---|
| No | — | Normal cluster. Propose per §4. |
| Yes | No | **`CLOSURE-PENDING`** — do not re-propose. Name the open proposal, its report, and its age. Escalate it at the human gate instead of adding a second proposal to the queue. |
| Yes | Yes | **`CLASS-NOT-CLOSED`** — the fix shipped and the class recurred anyway. |

**A `CLASS-NOT-CLOSED` cluster may not be answered with another instance fix.** The evidence
that instance fixes do not close this class is that one already shipped. Required instead is a
proposal that changes what *produces* the class:

- a check that fires on the whole class rather than on the instance that was found;
- a contract change that makes the class unrepresentable;
- or, if neither is available, an explicit written statement that the class is **accepted** —
  named, bounded, and re-examined next run. An accepted class is a decision; an unmentioned
  recurring class is a blind spot.

Mark the proposal `CLASS-NOT-CLOSED` and state, in one line, why the shipped fix did not
generalise. That sentence is the actual finding.

> **Why this matters.** A closing loop and a recurring problem are not contradictory. Proposals
> can ship reliably while the operator's experience is still "the same problems, every time" —
> because the instrument counts instances and the recurrence lives at the class level. Reporting
> a healthy approval rate while a class recurs is the failure mode this step exists to prevent.

### 3. Filter relevant signals

Threshold: `tunables.min_entries_for_signal` occurrences in a cluster.
Below threshold → note in the report, do not propose action.

**Exception — `CLASS-NOT-CLOSED` has no threshold.** A class that recurs *at all* after a shipped
fix is a signal on the first recurrence: the prior instances are already in the evidence, in the
earlier report. Waiting for three more is waiting to re-learn something already known.

### 4. Produce proposals

Seven categories — **S first, then A–F**, in recommended priority order. **This S + A–F tag
list is the shared contract with `/roster-skill-evolve`** — every tag emitted here has a
matching handler there; a change to this list is a change to both skills.

### The subtraction test — run it on every cluster before emitting A–F

For each cluster, answer in writing: **would removing or shortening something have prevented
this?** Emit `[SIMPLIFY]` when the answer is yes, and fall through to A–F only when it is no.

This is a different question from §3's class check, and both are required. The class check asks
whether this class recurred despite a shipped fix. The subtraction test asks whether the fix
should be a removal at all. A `CLASS-NOT-CLOSED` cluster answered with a removal satisfies both:
a removal is one way to change what *produces* the class rather than patch its latest instance.

Categories A–F are all additions — new skills, new tools, new prose, new hooks, new agents. A
taxonomy that offers only additions produces only additions, whatever the data says. `[SIMPLIFY]`
exists to break that. Three shapes recur often enough to check by name:

| shape | question |
|---|---|
| The step exists but is manual and multi-part | can the parts become one command? A ritual fails on whichever part is forgotten |
| The same fact is stated in N artifacts | can it be stated once and referenced? N places to write is N places to be wrong together |
| A skill's own template or heuristic works against its stated rule | can the offending clause be deleted rather than qualified? |

**Three hard rules, because this is where the bias hides:**

- An `[ADAPT]` that adds prose to a skill MUST state why the prose already in that skill was not
  followed. "The rule was missing" and "the rule was there and ignored" call for opposite
  remedies, and only the first is served by adding text.
- A proposal whose remedy is *more* tracking of a bypassed step MUST first consider whether the
  step was bypassed because the path is too long for the case at hand. Instrumenting a bypass is
  an addition; shortening the path is a removal.
- **Every proposal MUST cite the file(s) it would change, verified to exist.** Approval given on
  a guessed target is not informed approval, and the cost lands entirely on the apply phase. On
  2026-08-26 four of eight approved proposals named the wrong place: one target did not exist in
  any skill, one would have deleted a load-bearing gate, and two described mechanisms that were
  already present.

Prefer removals also when the data is thin: a removal that turns out unnecessary costs once, an
addition costs on every future run.

#### S. Simplifications and removals

Signal: any cluster where a removal, a shortening, or a merge into an existing mechanism prevents
the friction — regardless of cluster size, since the cost of a removal is bounded.

```
**[SIMPLIFY] <what is removed, shortened, or merged>**
class: <friction-class>
Signal: <N> occurrences — <friction ids>
Cause shape: process too long / duplicated statement / self-defeating clause / manual ritual
Target: <file(s) that change, verified to exist>
Removal: <what stops existing, or what replaces N steps with one>
What it stops costing: <the recurring cost that disappears>
Effort: <XS/S/M>
```

An `[ADAPT]` or `[HOOK]` that folds a guard into a mechanism **that already runs** (an existing
pre-commit hook, an existing Makefile target, an existing canonical command) is a simplification,
not an addition — tag it `[SIMPLIFY]` and name the mechanism that absorbs it.

#### A. New skills

Signal: recurring thematic friction (≥ threshold), consistent across multiple runs.

```
**[SKILL] roster-<suggested-name>**
class: <friction-class>
Signal: <N> occurrences across <affected skills>
Frictions covered: <list>
Description: <what the skill would do>
Estimated effort: small / medium / large
```

#### B. Deterministic tools (scripts, binaries)

Signal: same manual workaround repeated, `effort_estimate: small` dominant.

```
**[TOOL] scripts/<name>.sh**
class: <friction-class>
Signal: <N> occurrences of workaround "<workaround>"
Proposed tool: <description>
Impact: <friction eliminated>
Effort: small (~<N>h)
```

#### C. Adaptations of existing skills

Signal: friction tied to a specific step of an identified skill.

```
**[ADAPT] roster-<skill-name> → v<X.Y+1>**
class: <friction-class>
Friction: "<description>"
Adaptation: <what changes>
Impacted section: <Steps N / Rules / Input Contract>
```

#### D. Skill hooks

Signal: `min_entries_for_signal` (default: 3) friction entries on the same skill whose `frictions[]` strings describe a manual workaround, where the workaround pattern is a guard check (validate precondition before running), a post-run cleanup, or a feedback loop (run → check → fix → retry). (The friction record has no `type` field — classify from the `frictions[]` text.)

```
**[HOOK] .harness/hooks/skills/<skill-name>/<pre|post>.md**

class: <friction-class>
Signal: <cite 1–2 friction entries>
Problem: <what recurring manual step / guard / feedback loop is being done by hand>
Proposed hook: <phase> hook for `<skill-name>` — <one-sentence description of what the hook automates>
Expected friction reduction: <count> workaround entries eliminated
```

**`[HOOK]` trigger signals:**
- ≥ `min_entries_for_signal` friction entries on the same skill whose `frictions[]` strings describe the same manual workaround
- The workaround is a guard check (`effort_estimate: small`) or feedback loop (`effort_estimate: medium`)
- A linter pass or metric-based signal is a bonus, not required

**Hook lifecycle proposals (sub-section):**
- **hook→skill migration:** If a hook has 100% pass rate over ≥10 runs logged in `friction.jsonl`, propose absorbing its logic into the skill's `## Steps` section as a first-class step, then deleting the hook.
- **skill→hook extraction:** If a guard or cleanup prose pattern appears verbatim in 3+ skill files, propose extracting it to a shared hook fragment in `.harness/hooks/shared/`.

**Additional `friction.jsonl` fields for hook-enabled runs:**
```jsonl
{"hook": "pre | post", "outcome": "pass | warn | abort | pending", "duration_ms": 1200, "loop_iterations": null}
```
These records are appended automatically by the hook runner — **this skill is a read-only consumer; `scripts/run-hook.ts` is the single writer**. They carry `classes: ["other"]` with a `class_note` saying so: the runner cannot classify semantically, since the class of a hook abort depends on what the guard was guarding. **Exclude records with a `hook` key from the `other`-rate** in §5 — counting them would swamp the signal that tells you the vocabulary is going stale. `outcome: skip` is never logged (nothing executed); `loop-N` outcomes and non-null `loop_iterations` are reserved for future native loop execution. `duration_ms` is real wall-clock time measured by the runner. Health analysis may filter on `"hook": "pre"` to identify pre-hook friction separately from skill friction.

#### E. New dedicated agents

Signal: `suggestion_type: "agent"` repeated, `effort_estimate: large`.

```
**[AGENT] <agent-name>**
class: <friction-class>
Signal: <N> occurrences, large effort
Domain: <domain>
Role: <description>
Next step: recruiter + skill-creator
```

#### F. Workflow template promotion

Signal: ≥ `min_entries_for_signal` workflow instances (`workflows/*.cwr.json`, excluding
`templates/`) sharing the same divergence — **structural or prompt-level** — vs. their
source template. Instances are generated as verbatim template copies, so any divergence
comes from manual edits to persisted (commit/local-only) instances; that hand-tuning is
precisely the signal this category promotes back into the template. Prompt-level edits
are the common case; structural edits are rare. Detection here is
cheap — list the instances and group them by source template (match each instance's step
sequence against `workflows/templates/*.cwr.json`; the version string alone does not
identify a template). Emit the proposal only when one group reaches the threshold, and mark
it *unconfirmed* — the precise per-step diffing happens in `/roster-skill-evolve`'s handler:

```bash
ls workflows/*.cwr.json 2>/dev/null | grep -v 'templates/'
```

```
**[WORKFLOW] workflows/templates/<mode>.cwr.json**
class: <friction-class>
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

## Class distribution

| Class | Entries | Date span | Prior proposal | Verdict |
|---|---|---|---|---|
| <class> | <N> | <first> → <last> | <report or —> | normal / CLOSURE-PENDING / CLASS-NOT-CLOSED |

`other`: <N> entries (<N>% of classified). List their `class_note` lines verbatim — they are the
evidence for extending the vocabulary. A rising `other` rate means the vocabulary is going stale,
not that the work got stranger.

## Instrument health

<`--log` violations: N. Entries missing `classes`: N. `other` without `class_note`: N.>
<Per-task entry coverage, if the ledger makes it computable: tasks that shipped with fewer
entries than phases — the P1 shape of a log written late.>

Say plainly whether this report is measuring the work or measuring a gap in the log. If most of
the period is unlogged, that is the finding, and it outranks every cluster below.

## Proposals (strong signals)

<proposals: [SIMPLIFY] first, then A–F — each carries its `class:` line and its verified target>

## Withdrawn by the subtraction test

<any A–F proposal the subtraction test replaced, with the removal that replaced it. An empty
section on a report carrying several additions is itself a warning sign: it means the test was
not run.>

## Weak signals (< threshold — to monitor)

<entries below threshold>

## Cost context (advisory — omitted if skills-meta/cost.jsonl is absent)

<which task/skill/cluster carried the most recorded (approximate) spend — context only, never a
signal that changed any proposal above>

## Stability

<N> clean runs — stable skills: <list>
<N> `positive-signal` entries — mechanisms that worked, and what they caught.
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
| A cluster is `CLOSURE-PENDING` (prior proposal approved, never shipped) | Do not re-propose — escalate the open proposal at the human gate |
| The log's last entry predates the period being analyzed | Stop clustering. Report the gap first; a log that stopped is not evidence that the work went quiet |

## What Next

**Primary path (proposals exist):** `/roster-skill-evolve` — pass the health report as input
**Optional — after proposals approved:** `/improvement-loop-planner` — converts approved proposals into bounded, measurable improvement loops with explicit success signals, guard conditions, and iteration budgets. Run this when ≥2 proposals are APPROVED and you want structured execution plans rather than open-ended implementation.
**Primary path (no proposals):** Done — re-run after more pipeline cycles

> 💡 Run after every 5–10 pipeline cycles to maintain a healthy improvement metabolism.

## Rules
- Run the subtraction test on every cluster before emitting any A–F proposal, and show its
  result in the report — including the additions it withdrew
- Cite a verified target file for every proposal; never propose a hook, tool, or runner into a
  directory whose executor does not exist, and say how you verified that it runs
- Clean runs are a positive signal to name explicitly
- Cluster by `classes` before anything else — the class is the recurrence key
- A `CLASS-NOT-CLOSED` cluster is never answered with another instance fix, and never waits for
  the threshold; either a systemic proposal or an explicit written acceptance
- `other` is reported every run, with its `class_note` lines quoted; a rising rate is a signal
  about the vocabulary, and extending it is a deliberate act, not a per-entry improvisation
- Never report a proposal-approval rate as evidence of health without the class distribution
  beside it — a loop can close reliably while the same class recurs
- Cost context (`skills-meta/cost.jsonl`) is advisory only — it never changes `min_entries_for_signal`, cluster ranking, or any proposal; absent cost data never changes clustering either
