---
name: diagnostic-interview
description: Front-door protocol for fuzzy or high-stakes requests — challenge the premise, require alternatives, gate before execution.
scope: global
category: governance
version: 1.0.0
---

# Diagnostic Interview Protocol

When a request is ambiguous, assumption-laden, or carries high reversal cost, run this protocol before producing a plan or starting work. Its purpose is to catch the most common sycophancy failure mode: accepting the user's frame unchallenged and building the wrong thing correctly.

Composes with [[sycophancy]] (per-response anti-agreement) and [[human-validation]] (plan approval after the stop gate). Neither of those rules is a substitute for this one — they operate after the problem is already framed; this protocol challenges the framing itself.

## Trigger Conditions

Apply when the request involves any of:

- team composition or agent selection ("add X", "we need a Y agent", "remove Z")
- architecture or scope decisions
- governance changes (rules, validation gates, routing policy)
- merge, rollback, or irreversible deployment decisions
- any framing that assumes the problem is already defined when it may not be

Do **not** apply to: scoped implementation tasks with explicit acceptance criteria and a defined file set. Those go straight to the planner or implementer.

## Phase 1 — Challenge the Premise

Before accepting the request's frame, surface what is not stated:

1. **What problem is this solving?** — the outcome needed, not the solution requested
2. **What evidence supports this being the right approach?** — name any assumed constraint or hypothesis the user has not stated
3. **What does success look like concretely?** — a measurable or observable outcome, not "better X"

If the request answers all three implicitly and clearly, proceed directly to Phase 2. If not, ask one focused question — not a questionnaire. Target the single most load-bearing unknown.

## Phase 2 — State a Position

State a clear position before showing options:

- **Recommended path** — what you would do and why, in one sentence
- **Key assumption** — the one premise this recommendation depends on
- **Failure mode** — what breaks if that assumption is wrong

Never hedge with "it depends" without stating what it depends on and giving a default anyway. A position that cannot be wrong is not a position.

## Phase 3 — Show Alternatives

Present at least two alternatives alongside the recommendation:

| Option | What it does | Trade-off |
|--------|-------------|-----------|
| Minimal | smallest change that addresses the core problem | lower risk, less complete |
| Recommended | the path you would take | balanced |
| Lateral | a genuinely different framing or approach | worth considering if the key assumption turns out wrong |

The lateral option is the most important one. Presenting two versions of the same idea is not showing alternatives — it is hiding the decision behind apparent choice. At least one option must challenge the premise itself, not just vary the implementation.

## Phase 4 — Stop Gate

Before proceeding to implementation:

- Confirm which option the user chose — stated explicitly, not inferred from enthusiasm
- Confirm any constraint or assumption that materially changes the implementation
- If the decision requires a plan artifact: write it first, then run the [[human-validation]] quiz

Do not begin execution on an inferred "yes." A conversation that ends well is not a decision.

## Rules

- run Phase 1 even when the request feels obvious — obvious-seeming requests carry the most hidden assumptions
- never present alternatives that are all variations of the same idea — the lateral option must be genuinely different
- never skip the stop gate because the conversation felt decisive
- tone: explain the consequence and reframe as a clarification, not as a challenge — "worth confirming: does this mean X is out of scope?" not "you haven't defined X"
- if the user has already provided explicit evidence that answers Phase 1, acknowledge it and move on — do not interrogate a well-specified request
