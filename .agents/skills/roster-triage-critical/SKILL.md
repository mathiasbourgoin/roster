---
name: roster-triage-critical
description: Critical-route triage — property elicitation, priority ordering, backend proposal, cost disclosure. Dispatched by roster-run when --critical is chosen. Checkpoints to briefs/<slug>-formal-triage.md.
version: 1.0.0
domain: pipeline
phase: null
preamble: true
friction_log: true
artifacts:
  reads: []
  writes: ["briefs/<slug>-formal-triage.md"]
---

---
name: roster-preamble
version: 1.6.0
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


# Roster Triage Critical

You run Stages 2–5 of the `--critical` pipeline route: property elicitation, priority ordering, backend proposal, and cost disclosure. Your only job is to produce `briefs/<slug>-formal-triage.md`. You do not implement anything.

## Input Contract

- The target component (file path, module, or description) provided as your argument.
- Task slug (derive from the component name: lowercase kebab-case, ≤4 significant words).

## Steps

### Stage 2 — Property elicitation

**2a. Read-only scan.** Read the target component's source file(s). Identify candidate properties based on code shape:

| Signal | Suggests |
|---|---|
| Pure function, mathematical ops, field arithmetic | Rocq |
| Explicit state variants + transition function | Quint |
| Existing `.qnt` or `.v` file adjacent | Respective backend |
| Called from auth/signing/verification paths | Rocq |
| Lifecycle keywords (draft/pending/accepted/validated) | Quint |

Propose a candidate property list. Each entry has three fields:

```
[P1] <name>          <Rocq|Quint>   ★★★ HIGH
     What it checks:  "<ELI5 sentence — plain language, no jargon, no tool names>"
     Why tests miss it: "<one sentence — what tests can't cover and why>"
```

**ELI5 rule:** "What it checks" must be understandable by a developer who knows their domain but has never heard of Rocq or Quint. If they can't understand what would go wrong if the property was violated, rewrite it. No formal notation.

**2b. Ask the five elicitation questions.** These questions are fixed — do not regenerate them. They are NOT the intake validation quiz (that runs later in roster-spec-formal). No consistency-check question here.

Present them to the human using the interactive question tool if available, or as a numbered list:

1. Must this be correct for *all* possible inputs, or only for inputs your system produces?
2. Are there temporal properties — things that once true must stay true, or orderings that must always hold?
3. (Closed choice — determines severity score directly):
   **If this is wrong, what is the worst realistic consequence?**
   a) An attacker gains a capability they should not have
   b) A downstream formally-verified system is invalidated
   c) Persistent data is corrupted, but no security impact
   d) The output is wrong, but no lasting impact
4. Is there a paper, RFC, or reference implementation that defines what "correct" means?
5. What does failure look like — silent wrong answer, crash, security breach, invalid proof?

**Q3 maps directly to severity_score: a→4, b→3, c→2, d→1. No LLM interpretation step.**

Fold answers into the property list: refine, add, or remove properties based on responses.

### Stage 3 — Priority ordering

Assign each property a `severity_score` from Q3's answer (4/3/2/1). Map to priority:
- HIGH = score 4 or 3
- MED = score 2
- LOW = score 1

Sort by severity_score descending. For ties, apply advisory tie-breakers:
- Detectability gap: combinatorial/all-input properties score higher than unit-testable ones
- Core vs edge: central invariant > edge case

### Stage 4 — Backend proposal

Based on the top-priority properties, propose Rocq, Quint, or both. Argue each recommendation in plain language (≤150 words), anchored to the ELI5 descriptions. Explain:
- Why the recommended tool fits the top properties
- What the other tool would miss and why
- If recommending both, why each backend covers a distinct property type

Present as:

```
BACKEND RECOMMENDATION
───────────────────────
Recommendation: <Rocq|Quint|Both>

Why <tool> for <P1, P2>:
  [plain-language argument]

Why not <other tool> for <P1, P2>:
  [honest limitation explanation]

Decision: accept <tool> / override with your choice
```

The human decides. This is a proposal, not a gate.

### Stage 5 — Cost disclosure

Present the cost template for the chosen backend(s). Use the fixed template below — do not regenerate it. Fill `[ESTIMATE]` slots based on the component's complexity (simple/medium/complex); all figures are advisory.

```
COST OF --critical (<backend>)
All figures are estimates — actual cost depends on component complexity.

Implementation effort
  Spec writing       [ESTIMATE: 1–3 days]. AI drafts; you validate at the quiz gate.
  Proof development  [ESTIMATE: days to weeks — simple: ~2d; complex: 1–2wk+].
  Correspondence     [ESTIMATE: ~2d with certified extraction; less but weaker
                     with manual correspondence].     ← Rocq only

  Spec writing       [ESTIMATE: hours to 1 day].       ← Quint only
  Driver             [ESTIMATE: 1–2 days] for connect Driver + State impl.

Token cost           [ESTIMATE: ~3–5× a standard Full run — first-principles guess].  ← Rocq
                     [ESTIMATE: ~1.5–2× a standard Full run — first-principles guess]. ← Quint

CI changes           ⚠ CI/CD change — requires human approval per escalation.md.
                     Rocq: add rocq compile + coqchk gate. Build time: [ESTIMATE: 30s–5min].
                          Prerequisite: Rocq/Coq in CI image.
                     Quint: Quint must be in PATH in CI (quint-connect/Rust).
                           ocaml-quint-connect: pre-committed ITF traces — no Quint at CI time.

Ongoing              Rocq: proof may need updating on implementation changes.
                     Quint: driver must stay in sync with implementation.
```

For `--critical=both`: additive of both, `[ESTIMATE: ~4.5–7× a Full run]`.

## Output Contract

Write `briefs/<slug>-formal-triage.md` before exiting. Schema:

```markdown
---
slug: <component-slug>
date: <ISO date>
component: <file or module path>
backend_recommendation: <rocq|quint|both>
human_decision: null
downgrade_reason: null
---

## Properties

| ID | Name | Backend | Priority | Severity | ELI5 | Why tests miss it |
|---|---|---|---|---|---|---|
| P1 | <name> | Rocq | HIGH | 4 | "<eli5>" | "<why>" |
...

## Backend Argument

<argued recommendation, ≤150 words>

## Q3 Answer

<letter and full text of the chosen consequence>
```

The human's backend decision (or downgrade reason) is filled in by the intake gate, not here. Leave as `null`.

## Rules

- Read-only scan only — never modify source files
- Q3 is closed-choice; do not paraphrase or reinterpret the answer
- The five elicitation questions are fixed; do not regenerate them
- This skill does not run the intake validation quiz — that is roster-spec-formal's job
- If the human declines --critical entirely, log `"event": "critical_declined"` in friction.jsonl (separate from suggestion_type)

## When to Go Back

| Condition | Action |
|---|---|
| Task is Express-classified | Stop — skip triage entirely; critical is incompatible with Express scope |
| Human declines `--critical` after seeing triage output | Stop — log `"event": "critical_declined"` in friction.jsonl; route to `--full` |
| Cannot read target component (file absent, path ambiguous) | Escalate — ask for the correct path before scanning |
| Q3 answer is outside a/b/c/d | Re-ask with the closed-choice options; do not interpret open-ended answers |

## What Next

**Primary path:** `/roster-spec` (then `/roster-spec-formal` immediately after)
**If human declines --critical:** `/roster-run --full` — resume the standard pipeline

> **Note:** `roster-triage-critical` has `phase: null` — it does not append to `briefs/<task>-state.json`. The critical task runs as `mode: full` in the ledger; triage, spec-formal, and formal-verify are `phase: null` helpers that run between Full phases without participating in ledger sequencing.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-triage-critical",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null,
  "event": null
}
```
