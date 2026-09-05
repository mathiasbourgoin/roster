---
name: roster-audit
description: Quality and compliance audit — combines code-quality and spec-compliance into one actionable report.
when_to_use: "Use to assess existing code's quality + spec compliance with no specific change in flight. Trigger: 'audit this', 'is the code healthy'."
version: 1.3.0
domain: pipeline
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: after
tunables:
  max_function_lines: 50
  require_kb: false
  check_spec_compliance: true
  check_code_quality: true
  check_naming: true
artifacts:
  reads:
    - kb/spec.md
    - kb/properties.md
    - kb/glossary.md
  writes:
    - briefs/audit-<date>.md
pipeline_role:
  triggered_by: human or /roster-skill-health
  receives: optional scope in $ARGUMENTS (files / modules / entire repo)
  produces: briefs/audit-<date>.md with actionable findings
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
is `null` (standalone skills: doctor, audit, investigate, init, skill-health) or there is no task
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

**Write your entry when THIS phase ends — before you hand off, before you report, before you
stop.** Not at session end. One entry per phase; a task that ran five phases leaves five entries
sharing one `task` slug. Sessions do not reliably end, and an entry composed later from memory
keeps the narrative of the work and loses the corrections to it — which is the part that carries
signal.

Record honestly:
- **frictions** — workarounds, long searches, ambiguities, and every place a confident conclusion
  of yours was later refuted. A user correction is the highest-value entry there is; write it.
- **classes** — the closed vocabulary below, most load-bearing first.
- **methods** used, and any suggestion for a tool, skill, or adaptation.
- **skipped** — any mandated step this phase did not perform, as `"<step>: <reason>"`. A skipped
  step that goes unrecorded is indistinguishable from a step that ran. Omit the key if nothing
  was skipped; never omit it *instead of* admitting a skip.

A run with nothing to report is a **clean run**: `"frictions": []` and `"classes": []`. Log it.
Clean runs are the denominator — without them no rate can be computed, and "zero clean runs" is
then an artefact of the log rather than a fact about the work.

This is not a performance review. It is cross-run memory.

Canonical entry template (append to `skills-meta/friction.jsonl`; set `"skill"` to your
skill's name — extra documented fields like `class_note`, `event` or `mode` are allowed):

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",
  "task": "<task-slug>",
  "frictions": [],
  "classes": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

**Friction classes — closed vocabulary.** Pick by *remedy*, not by symptom:

`gate-vacuous` (a check passed while checking nothing) · `evidence` (a conclusion asserted
without, or against, the evidence) · `process-bypass` (a mandated step not performed, absence
unrecorded) · `missing-artifact` (a referenced file absent, untracked, or not installed) ·
`stale-tooling` (tool present but stale/misbehaving) · `agent-isolation` (worktree or
shared-checkout boundary damage) · `parallel-collision` (concurrent agents contending) ·
`schema-drift` (two artifacts disagree about a shape, or a contract is undocumented at the call
site) · `scope` (scoped too narrowly/broadly, or duplicating delivered work) · `git-mechanics`
(a git/forge operation whose real result differs from its reported one) · `human-gate` (a human
decision unavailable, deferred, or handed back) · `runtime-limits` (session limit, compaction,
killed job, rejected tool arity) · `external-dep` (third-party service or machine unavailable) ·
`positive-signal` (**not** a friction — a gate that worked, a discovery; excluded from
clustering) · `other` (requires a non-empty `class_note`).

The list above is the contract — it is injected into this skill, so it is readable wherever this
skill runs. Do not invent values: use `other` plus a `class_note`, which is how the vocabulary
earns its next entry.

Full definitions, one canonical instance per class, and the classification rules live in the
roster source at `schema/skill-schema.md` → *Friction classes*, where the vocabulary is closed
and validated by `scripts/check-friction-shape.js --log`. **That path resolves in the roster
repo, not necessarily in an installed harness** — if it is absent here, the list above is
complete and authoritative on its own; nothing above depends on opening it.


# Roster Audit

You audit code quality and its compliance with the KB. You produce actionable findings, not a style report. Every finding must cite the file and line.

**Token discipline:** concise findings. Do not paraphrase the KB — point to violations.

## Input Contract

- `$ARGUMENTS`: scope (e.g. `scripts/` or `agents/management/` or empty for the entire repo)
- KB if it exists (`kb/spec.md`, `kb/properties.md`, `kb/glossary.md`)
- If `tunables.require_kb: true` and KB absent → block and say so

Default scope if $ARGUMENTS is empty: all source code (excluding `_build/`, `node_modules/`, `dist/`).

**Mandatory scope confirmation — before any fan-out.** Confirm the scope with an explicit choice between **whole-tree** and **git-range** (e.g. `main..HEAD`) scope, using the runtime's interactive tool (`AskUserQuestion` or equivalent — see preamble *Asking Questions*). In autonomous/delegated mode where no human is available, record the chosen scope and the basis for the choice in the report header. Never re-interpret the scope mid-run — a scope change requires restarting the audit.

## Steps

### 1. Load references

If KB exists:
- Read `kb/properties.md` → invariants, thresholds, constraints
- Read `kb/glossary.md` → canonical naming
- Read `kb/spec.md` → specified behaviors
- Read `kb/architecture.md` (top-level and per-module, if present) → declared structural
  expectations: module boundaries, dependency direction, layering

If KB absent and `tunables.require_kb: false` → continue with defaults (thresholds in tunables).

**Git-range scope — branch divergence.** The canonical tool for scoping branch divergence is `git cherry <upstream> <branch>` (patch-id based): it identifies commits whose *changes* are genuinely missing from the other side, regardless of hashes. ⚠️ Raw `git diff A..B` direction misleads on cherry-pick-heavy histories — a commit cherry-picked across branches shows as a diff even though its change is already present, and the apparent direction of divergence can invert. Use `git cherry` (mind the merge-base) to establish what actually diverges before reading any diff.

### 2. Check: function size (if `check_code_quality: true`)

```bash
# Identify long functions
grep -n "^let \|^  let \|^and " <scope>/**/*.ml | head -100
# (adapt pattern to the language)
```

Threshold: `tunables.max_function_lines` lines (default 50).
Report each function that exceeds this with: file, line, estimated size.

### 3. Check: DRY violations

Look for duplicated code blocks (≥ 5 identical or near-identical lines).

```bash
# Search for repeated patterns
grep -rn "<suspect pattern>" <scope>
```

Report with both locations.

### 4. Check: naming (if `check_naming: true` and glossary available)

For each term in `kb/glossary.md`:
- Search for variants (abbreviations, synonyms, different casing)
- Report inconsistencies with both forms (canonical vs found)

### 5. Check: spec compliance (if `check_spec_compliance: true` and spec available)

For each behavior specified in `kb/spec.md`:
1. Locate the implementation
2. Verify the match
3. Verify that a test covers this behavior

Classification:
| Status | Meaning |
|---|---|
| **PASS** | Code compliant + test exists |
| **PARTIAL** | Code compliant + no test |
| **DIVERGE** | Code behaves differently |
| **MISSING** | No implementation found |

### 6. Check: invariants

For each invariant in `kb/properties.md`:
- Verify it is preserved in the code
- If not statically verifiable → note "not statically verifiable"

### 6.5. Check: structural conformance (if `kb/architecture.md` present)

For each structural expectation declared in `kb/architecture.md` (module boundaries,
dependency direction, layering, forbidden imports):

1. Locate the corresponding structure in the code (imports, module layout)
2. Verify conformance — cite file:line for each divergence
3. If an expectation is not statically verifiable → note "not statically verifiable"
   explicitly, do not assume conformance

This is the standing-codebase counterpart of the `architect` agent's diff-time review:
architecture drift with no change in flight surfaces here. Report divergences in the same
severity classes as other findings.

### 7. Report

Produce `briefs/audit-<YYYY-MM-DD>.md`:

```markdown
# Audit — <date>

**Scope:** <audited scope>
**KB used:** YES / NO (reason if no)

## Summary

| Category | Findings | Actionable |
|---|---|---|
| Function size | N | N |
| DRY | N | N |
| Naming | N | N |
| Spec compliance | PASS: N / PARTIAL: N / DIVERGE: N / MISSING: N | N |
| Invariants | N | N |

## Actionable findings

### CRITICAL / HIGH
<findings that block or risk regressions>

### MEDIUM
<important quality findings>

### LOW / INFO
<minor findings>

## Non-actionable (for reference)
<findings not statically verifiable or accepted>
```

### 8. Human gate

Present the report and ask:
> "Which findings do you want to address now? I can create a `/roster-intake` for each group."

## Output Contract

`briefs/audit-<date>.md` with classified and actionable findings.

## When to Go Back

| Condition | Action |
|---|---|
| Findings reveal the current brief or plan is mis-scoped | Stop — re-run `/roster-intake` or `/roster-plan` with findings as context |
| Audit is blocked by missing KB or spec | Stop — ask human to run `/roster-init` or provide the missing spec |

## What Next

**Primary path:** `/roster-review` or `/roster-plan` — depending on whether findings are review-level or require re-planning
**Alternatives:**
- `/roster-intake` — if findings reveal a new task worth tackling separately

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-audit",
  "task": "audit",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Every finding must cite file and line — never a generality
- "The code looks clean" is not a finding
- Without KB → apply tunable thresholds, do not invent rules
- Not statically verifiable → say so explicitly, do not assume
- Never modify code during the audit
