# Memory Schema

The `memory/` directory stores **episodic, agent-governed memory** — session summaries, agent working notes, and accumulated decisions. It is explicitly separate from the normative `kb/` namespace.

## `kb/` vs `memory/` — Key Distinction

| Dimension | `kb/` (normative) | `memory/` (episodic) |
|-----------|-------------------|----------------------|
| **Content** | Specs, invariants, architecture decisions | Session summaries, agent decisions, working notes |
| **Authority** | Source of intent — governs agent behavior | Contextual record — informs but does not govern |
| **Mutability** | Immutable specs (human gate required) | Freely mutable by agents |
| **Governance** | Human-gated spec changes | Agent-governed |
| **Contradiction** | Auditors flag contradictions | No contradiction enforcement |
| **Retention** | Permanent until explicitly removed by human | Ephemeral — agents may prune old entries |

**Key invariant: `memory/` and `kb/` are separate namespaces. Agents must never write normative content (specs, invariants, architecture decisions) to `memory/`, and must never write episodic content (session logs, working notes) to `kb/`.**

## Directory Structure

```
memory/
├── index.md                          # Index of sessions and agent notes
├── sessions/
│   └── YYYY-MM-DD-<slug>.md          # One file per significant work session
└── agents/
    └── <agent-name>.md               # Per-agent working notes and accumulated context
```

## File Format

Memory files use YAML frontmatter (same style as KB), but with relaxed rules:

```yaml
---
title: <string>           # Short description of session or note
date: <ISO-8601>          # Date created
owner: <agent-name|human> # Who wrote this entry
---
```

No `status:`, `schema-version:`, or immutability fields required. No human gate on writes.

## File Purposes

### `memory/index.md`

A lightweight index listing all session files and agent note files with one-line descriptions and relative links. Updated by agents when new files are added.

### `memory/sessions/YYYY-MM-DD-<slug>.md`

Records what happened during a significant work session: decisions made, approaches tried, outcomes observed. Useful for agents to recall context from previous sessions without re-reading all code.

Suggested structure:
```markdown
# Session — <date> — <slug>

## What was done
## Decisions made
## Approaches tried (and why some were abandoned)
## Open threads
```

### `memory/agents/<agent-name>.md`

Per-agent working notes. An agent may accumulate observations, preferences, or learned patterns here across sessions. Each agent owns its own file and may freely update it.

## Pruning

Agents may prune old session files (e.g., sessions older than 90 days with no open threads) without human approval. The `index.md` must be updated when files are removed.

## Bootstrapping

`roster-init` creates the following structure during project bootstrap:

```
memory/
├── index.md
├── sessions/   (empty)
└── agents/     (empty)
```

`kb/.index/` (the LanceDB vector index) is also added to `.gitignore` at this time.
