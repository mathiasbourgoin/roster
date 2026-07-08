---
name: roster-spec-formal
description: Formal spec phase — extends roster-spec output to produce a Rocq (.v) or Quint (.qnt) formal specification artifact. Runs after roster-spec, never instead of it.
version: 1.0.0
domain: pipeline
phase: null
preamble: true
friction_log: true
artifacts:
  reads: ["specs/<slug>.md", "briefs/<slug>-formal-triage.md"]
  writes: ["specs/<slug>.v OR specs/<slug>.qnt"]
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


# Roster Spec Formal

You extend the output of `roster-spec` by producing a formal specification artifact: a Rocq (`.v`) or Quint (`.qnt`) file. You run **after** `/roster-spec`, never instead of it. The adversarial spec machinery (user stories, challenge sub-agent, resolution loop) has already run — your input is the validated `specs/<slug>.md`.

**You do not replace the Markdown spec. You add a formal layer on top of it.**

## Input Contract

Verify both artifacts exist before starting:

```bash
[ -f specs/<slug>.md ]                   && echo "spec: ✅" || echo "spec: ❌ — run roster-spec first"
[ -f briefs/<slug>-formal-triage.md ]    && echo "triage: ✅" || echo "triage: ❌ — run roster-triage-critical first"
```

If either is absent, stop and report — do not proceed.

Read both in full:
- `specs/<slug>.md` — the validated user stories (US-1, US-2, …), acceptance criteria
- `briefs/<slug>-formal-triage.md` — property list (P1…Pn), ELI5 sentences, backend decision, Q3 severity answers

**Abbreviated triage brief check.** When `--critical=rocq` or `--critical=quint` was passed directly (skipping `roster-triage-critical`), the triage brief exists but has placeholder Properties (no P-rows, no ELI5, no Q3 answer). Detect this:

```bash
# If Properties table has no data rows (no P1/P2/... entries), the brief is a placeholder
grep -q "^| P[0-9]" briefs/<slug>-formal-triage.md && echo "properties: ✅" || echo "properties: PLACEHOLDER — must elicit"
```

If placeholder: run property elicitation (Stages 2a–2b from `roster-triage-critical`) **before proceeding** — ask the five elicitation questions, build the P-row table with ELI5 sentences and Q3 severity scores, then update the triage brief with the results. Without P-rows and ELI5, the formal spec artifact cannot be drafted, the human validation quiz cannot be built, and the E0 evidence claim has no traceability basis.

## Steps

### 1. Map properties to user stories

Each formal proposition must trace to a parent user story (US-N) from `specs/<slug>.md`. Establish the mapping:

```
P1 (no_overflow)    → US-1: "The NTT function produces the correct DFT output"
P2 (ntt_correct)    → US-1
P3 (stage_order)    → US-2: "The computation stages execute in the correct sequence"
```

A property that cannot be traced to a user story is a gap — either map it to an existing story or surface it to the human before proceeding.

### 2. Draft the formal spec artifact

**For Rocq (`.v`):**

```coq
(* specs/<slug>.v — generated by roster-spec-formal *)
(* Each proposition traces to a parent user story (US-N) *)

(* Type definitions matching the implementation's domain *)
...

(* US-1: <ELI5 sentence from triage brief> *)
Definition <property_name> (<params>) : Prop :=
  forall ...,
    ...

(* Acceptance criterion: <plain-language restatement> *)
Definition <slug>_verified (...) :=
  <prop1> /\ <prop2>.
```

Each proposition is preceded by a comment: `(* US-N: <ELI5 sentence> *)` — this is the traceability link used in the ship artifact and the quiz.

**For Quint (`.qnt`):**

```quint
module <slug> {
// Formal model for <component>.
// Each invariant traces to a parent user story (US-N).

// US-1: <ELI5 sentence>
// ...

type ... = { ... }

var ...: ...

action init: bool = { ... }

action <action_name>(...): bool = all { ... }

// US-N: <ELI5 sentence — the invariant in plain language>
val <invariant_name>: bool =
  ...
}
```

### 3. Human validation quiz (mandatory)

**This quiz is generated fresh each run. It is NOT the same as the Stage-2 elicitation questions (those are fixed and have no consistency-check). This quiz follows human-validation.md in full.**

**Why two quizzes:** `roster-spec` ran a quiz against the Markdown spec. This quiz gates a different artifact (the formal propositions in `.v`/`.qnt`). Because the formal file is unreadable by a non-expert, this quiz is the only way to verify the human understands what has been committed to. It is not redundant — it targets a qualitatively different risk.

Build quiz questions from two sources, not one:
- **ELI5 sentence** (from triage brief) — frames the property in plain language
- **Parent user story** (from `specs/<slug>.md`) — at least one comprehension question per HIGH-priority property must be answerable from the user story text independently of the ELI5

This breaks the circularity risk: if the ELI5 mistranslates the proposition, a question grounded in the user story will catch it.

**Quiz structure (per human-validation.md):**
- 3–5 questions
- 1–2 comprehension questions (one grounded in ELI5, at least one in the user story for HIGH properties)
- 1–2 clarification questions (decisions implicit in the spec that need making explicit)
- 1 consistency-check question — a deliberately wrong recommendation targeting the highest-risk decision; varied framing each run; never labeled as a trap; uniform format with other questions

Gate on correct answers before proceeding. If a comprehension question is answered incorrectly, offer one clarification, then re-ask. If still wrong, stop — the spec is unclear and must be revised.

**Residual risk (acknowledged):** If the ELI5 faithfully paraphrases the proposition but both are wrong (the proposition doesn't capture the story's intent), no mechanical check catches this. The story-grounded question is the primary mitigation. The ship artifact records that E0p/E0m claims are conditioned on the accuracy of the proposition-to-story mapping.

### 4. Write the formal spec artifact

Write `specs/<slug>.v` (Rocq) or `specs/<slug>.qnt` (Quint).

These files are indexed as `component_type: "formal-spec"` by the build index — they are tracked as opaque artifacts (path + type + parent story refs), not text-indexed. They are excluded from the cross-spec consistency grep in `roster-spec` (which is `.md`-only).

## Output Contract

`specs/<slug>.v` or `specs/<slug>.qnt` — formal spec artifact with:
- One proposition/invariant per HIGH-priority property at minimum
- Each proposition preceded by `(* US-N: <ELI5> *)` (Rocq) or `// US-N: <ELI5>` (Quint) traceability comment
- Human validation quiz passed

**Next:** `/roster-formal-verify` reads this artifact and the triage brief.

## Rules

- Never run instead of roster-spec — always after it
- Never skip the human validation quiz — it is mandatory
- The intake validation quiz (this skill) and the Stage-2 elicitation questions (roster-triage-critical) are two separate question sets; do not conflate them
- Traceability (proposition → US-N) is required for every HIGH-priority property
- If the triage brief's `human_decision` is null, fill it with the backend chosen in this run

## When to Go Back

| Condition | Action |
|---|---|
| `specs/<slug>.md` absent | Stop — run `/roster-spec` first |
| `briefs/<slug>-formal-triage.md` absent | Stop — run `/roster-triage-critical` first (or check if `--critical=rocq` or `--critical=quint` was passed, in which case the triage brief should have been written by `roster-run`) |
| A HIGH-priority property cannot be traced to any user story | Stop — surface the gap to the human; either map it to an existing story or add a new one before continuing |
| Human fails a comprehension quiz question after one clarification | Stop — the spec or ELI5 is unclear; revise before re-running |
| Human answers the consistency-check question incorrectly | Do not proceed until the conflict is explicitly resolved (per `human-validation.md`) |

## What Next

**Primary path:** `/roster-formal-verify`
**If quiz fails (spec unclear):** return to `/roster-spec` to revise the user story or `/roster-triage-critical` to revise the ELI5

> **Note:** `roster-spec-formal` has `phase: null` — it does not append to `briefs/<task>-state.json`. The critical task runs as `mode: full` in the ledger; triage, spec-formal, and formal-verify are `phase: null` helpers that run between Full phases without participating in ledger sequencing.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-spec-formal",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null,
  "event": null
}
```
