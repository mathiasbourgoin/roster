---
name: context-budget
description: Context-window hygiene — checkpoint long phases to artifacts, hand off via files not conversation, compact/clear before the model degrades.
scope: global
category: workflow
version: 1.0.0
---

# Context Budget

The roster pipeline runs many phases in sequence; context accumulates. A degraded context
produces worse work than a fresh one. Treat the context window as a budget, not a free resource.

## Thresholds

- **Degradation ("dumb zone") starts around 40% of the window.** Quality of reasoning drops
  well before the hard limit — do not wait for an out-of-context error to act.
- **Context rot is significant past ~300–400k tokens** even on large-window models: earlier
  details get silently down-weighted. Long, chatty phases are where this bites.

## Discipline

- **Checkpoint to artifacts, not conversation.** Long phases (`roster-research`,
  `roster-implement`, audits) must write their findings to a file (`briefs/`, `specs/`,
  `kb/`) as they go. The artifact is the durable memory; the conversation is disposable.
- **Hand off between phases via files.** A downstream skill should be able to start from the
  upstream artifact alone. Never rely on "it's earlier in this conversation" — the next phase
  may run in a fresh context (and on a different runtime).
- **`/clear` between unrelated tasks; `/compact` within a long one.** Clear when switching
  tasks — carrying a finished task's context into the next only adds rot. Compact when a
  single task's context grows large but you still need its thread.
- **Prefer rewind over correction.** If the context has gone down a wrong path, rewind to a
  clean point and restate, rather than piling corrections on top of a confused thread.
- **Spawn sub-agents for bounded, context-heavy work.** A blind read-only survey or a wide
  search should run in a sub-agent whose large intermediate context is discarded — only its
  conclusion returns to the parent (this is why `roster-research` is blind and artifact-only).

## Rule

If a phase's working context is approaching the dumb zone, **stop and checkpoint to an
artifact before continuing** — do not push a degraded context through a quality gate.
