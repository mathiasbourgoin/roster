---
name: improvement-loop-planner
description: Propose bounded self-improvement loops from KB, code, tests, issues, and CI signals.
when_to_use: "Use to turn KB/code/test/CI signals into bounded improvement loops with success criteria. Trigger: 'plan an improvement loop', after >=2 skill-health proposals."
version: 1.2.0
domain: workflow
phase: null
preamble: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: after
pipeline_role:
  triggered_by: human (when improvement targets are unclear)
  receives: $ARGUMENTS — area or project to analyze
  produces: loop spec(s) approved by human → passed to improvement-loop
  pairs_with: improvement-loop
---

---
name: roster-preamble
version: 1.6.2
description: Shared preamble injected into every roster skill that declares preamble true. Not a standalone command.
---

# Roster Preamble

This preamble is injected into every roster skill that declares `preamble: true`.
It encodes the non-negotiable principles that govern all skill runs.

---

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
A short-term shortcut is rarely faster than a complete solution.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

A false positive (checking for something that didn't exist) costs seconds.
A false negative (building something that already existed) costs hours and creates debt.

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction:
→ present the recommendation
→ explain why you both think it is better
→ state what context you might be missing
→ ask

Never act unilaterally in this case. The decision belongs to the user.

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

### Friction Log

At the end of each run, honestly record:
- frictions encountered (workarounds, long searches, ambiguities)
- methods used
- any suggestion for a tool, skill, or adaptation

This is not a performance review. It is cross-run memory.
Format: see `skills-meta/friction.jsonl`.

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


# Improvement Loop Planner

**Pair:** this skill proposes loops; `/improvement-loop` executes them. Run this first when you don't have a loop spec yet — once the human approves a proposal, pass it as `$ARGUMENTS` to `/improvement-loop`.

Propose a small set of high-value, bounded improvement loops for the project or area described in $ARGUMENTS.

This skill is **KB-aware but not KB-dependent**:

- If `kb/` exists, use it as the highest-priority source of intent and constraints
- If no KB exists, fall back to repository evidence: tests, CI, issues, TODOs, docs, and code structure

Your job is to **discover and define** candidate loops, not to run them.

## Steps

### 1. Read Intent And Constraints

- Read `AGENTS.md`, `README.md`, `CLAUDE.md`, and any architecture/spec docs that exist
- If `kb/` exists, read at least:
  - `kb/spec.md` if present
  - `kb/properties.md` if present
  - `kb/architecture.md` if present
  - `kb/index.md` if present
- Extract:
  - desired behavior
  - non-negotiable constraints
  - forbidden areas
  - quality properties

### 2. Inspect Mechanical Signals

Prioritize evidence that can support a deterministic loop:

- failing tests
- flaky tests
- lint/type/build failures
- CI failures
- coverage gaps
- performance hotspots with measurable baselines
- issue backlog with concrete acceptance criteria
- repeated TODO/FIXME clusters
- code areas that appear inconsistent with KB or repo docs

If tools exist, use them. Examples:

- `gh issue list`
- `gh run view --log-failed`
- project test command
- lint/typecheck/build commands

### 3. Identify Candidate Loop Targets

A good loop target has all of these:

- narrow writable scope
- measurable success signal
- low to moderate blast radius
- repeatable verification command
- clear keep/discard decision

Bad loop targets include:

- vague “improve architecture”
- unbounded refactors
- subjective UI polish with no acceptance criteria
- changes that require irreversible side effects

**Guardrail — never use model consensus as the completion signal.** A loop's success/exit
signal must come from an **external, mechanical verification** (tests pass, a metric crosses a
threshold, a check exits 0) — *not* from an LLM (or N copies of one model) judging its own work
"done." Agreement among same-model passes is **circular**: they converge on a confidently-wrong
"finished" with no outside ground truth. (Adversarial review by a *different* model is fine as a
*finding* generator; it is not a completion oracle. The done-condition stays mechanical.) This is
the one durable lesson from "until-done" autonomous loops — bound the loop by a verifiable signal,
never by self-assessed consensus.

## Proposal Format

Propose **1 to 5** loops, ordered by expected value and safety.

For each loop, use exactly this structure:

```markdown
## Loop <N> — <short name>

- Objective: <what this loop is trying to improve>
- Why now: <evidence from KB, tests, issues, CI, or code>
- Confidence: high | medium | low
- Writable scope: <specific files, directories, or globs>
- Read-only context: <files/docs/tests/issues to consult but not modify>
- Metric: <single primary metric or binary pass condition>
- Verify: `<command>`
- Guard: `<command or none>`
- Max iterations: <integer between 3 and 5; pick lower for high-risk scopes>
- Risk: low | medium | high
- Keep rule: <when a change is kept>
- Discard rule: <when a change is reverted or abandoned>
- KB basis: <spec/properties/architecture refs, or “none”>
```

After the proposals, add:

```markdown
## Recommendation

- Best starting loop: <Loop N>
- Why: <why this one is the best first candidate>
- Missing setup: <anything the user should define before execution, or “none”>

## Tool Opportunities

For each loop proposed above, identify patterns that could become deterministic tools
instead of LLM judgment. Optional section — only include if a genuine opportunity exists.

Format:
```
[TOOL] <tool description> — replaces: <the LLM judgment or manual step it eliminates>
       Trigger: <when this tool would run — CI, pre-commit, post-edit>
       Output: <what it produces — exit code, report, annotation>
```

Examples:
- [TOOL] Custom linter rule for missing auth guards — replaces: reviewer manually checking auth on each new endpoint
- [TOOL] Schema diff checker — replaces: LLM comparing API responses to spec definitions
```

## Rules

- Do **not** start editing code as part of this skill
- Do **not** propose an unbounded loop by default; bounded loops only
- Prefer deterministic metrics over subjective judgment
- If no trustworthy verification signal exists, say so explicitly and refuse to propose an execution-ready loop
- If KB exists and conflicts with issues or code, note the contradiction instead of papering over it
- If confidence is low because KB is absent, say that explicitly

## When to Go Back

| Condition | Action |
|---|---|
| No measurable verification signal exists for any candidate | Stop — do not propose a loop; report to human |
| KB contradicts the proposed improvement area | Stop — surface the contradiction, do not paper over it |

## What Next

**Primary path:** pass the approved loop spec as `$ARGUMENTS` to `/improvement-loop`.
