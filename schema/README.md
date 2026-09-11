# Schema Reference

This directory contains schema specifications for all roster component types.

## Component Schemas

| Schema | Purpose |
|--------|---------|
| `agent-schema.md` | Agent frontmatter and structure — name, model, version, domain, pipeline_role |
| `skill-schema.md` | Skill frontmatter and structure — name, version, domain, preamble, friction_log, artifacts, human_gate, tunables, pipeline_role |
| `rule-schema.md` | Rule frontmatter and structure — category, scope, enforcement |
| `hook-schema.md` | Tool-level and skill-level hook format — DSL step types, ABORT sentinel, on_error handling |
| `harness-schema.md` | Harness config format — agents, rules, hooks, skills, layers, metabolism block |
| `extension-schema.md` | Local extension pack format — metadata, inferred components, install registry, converge checks |
| `kb-schema.md` | Knowledge base file format — spec, architecture, glossary, frontmatter fields |
| `profiles.md` | Named harness profiles — defines which agents/skills/rules are bundled per profile |

## Supporting Schemas

| Schema | Purpose |
|--------|---------|
| `ta-config-schema.md` | TA (Terminal Agent) runtime config format (`.harness/ta.json`). Defines workspaces, panes, agent launch commands, and inter-agent communication permissions for tmux-backed multi-agent sessions. Separate from `harness.json` — the harness defines the installed team; TA defines how that team is launched and displayed. |
| `memory-schema.md` | Episodic memory format (`memory/`). Documents the `memory/sessions/` and `memory/agents/` directory structure, file format, and the key distinction between normative `kb/` content (specs, invariants, architecture decisions) and episodic `memory/` content (session logs, agent working notes). Agents govern `memory/` freely; `kb/` requires human gates. |
| `cost-snapshot.schema.json` | Draft-07 JSON Schema for `skills-meta/cost.jsonl` — one advisory, aggregates-only ccusage cost snapshot per ship, captured by `roster-ship`. Validated fail-closed by `scripts/check-cost-shape.ts` via the zero-dependency interpreter in `scripts/lib/cost-schema.ts`. `additionalProperties: false` throughout; `attribution` is always `"approximate"` (no session-id join exists — see `briefs/ccusage-metrics-spec.md` FR-163). Advisory only — never an input to any gate or verdict (FR-166). |
