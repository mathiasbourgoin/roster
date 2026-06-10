# Skill Definition Schema

Skills are reusable workflow prompts. Each skill lives in `skills/<domain>/<name>.md` and can be exposed through runtime-specific entrypoints.

## Required Frontmatter

```yaml
---
name: <string>               # Kebab-case identifier; used by harness and skill-health
description: <string>        # One-liner shown in Claude Code /help output
version: <semver>            # e.g. "1.0.0"
---
```

Claude Code only reads `description` from skill frontmatter; all other fields are roster-internal metadata used by harness-builder, skill-health, and skill-evolve.

### Description as a trigger, not a summary

For skills a user (or the runtime) can **invoke directly or select automatically** — entry
points (`roster-run`), bootstrap (`roster-init`), operational (`roster-doctor`,
`roster-audit`, `roster-investigate`), and standalone KB/workflow/media skills — the
`description` should say *when to reach for the skill*, not just what it is. State the
triggering situations and, where helpful, example user phrasings. A description that reads
like a label ("Intake phase") is weaker for auto-discovery than one that names the trigger
("Use when turning a vague task into a validated, contractual brief before any planning").

Optional `when_to_use` frontmatter can carry the explicit trigger phrasing separately:

```yaml
when_to_use: "Use when …; e.g. '<phrase>'."   # Trigger situations + example phrasings.
                                              # QUOTE the value if it contains ": " (a colon+
                                              # space) — unquoted, YAML reads it as a nested map.
```

> **Not** for internal pipeline-phase skills (`roster-plan`, `roster-implement`,
> `roster-review`, `roster-qa`, `roster-ship`, `roster-spec`, `roster-question`,
> `roster-research`): these are *routed* by `roster-run`, never auto-selected, so a concise
> phase-label description is correct — adding trigger phrasing is noise.

## Optional Frontmatter

```yaml
---
domain: <kb|media|meta|pipeline|shared|testing|workflow>
phase: <intake|plan|implement|review|qa|ship|null>
tags: [tag1, tag2]
allowed_tools: [Read, Write, Edit, Bash, Agent, AskUserQuestion, Skill]
disallowed_tools: [AskUserQuestion]   # tools this skill must NOT use — e.g. block interactive
                                      # prompts in blind, background, or hook-invoked runs that
                                      # would otherwise hang waiting for input
isolation: <fork|worktree>   # fork → run in an isolated sub-agent context (only the conclusion
                             # returns to the parent); worktree → run in an isolated git worktree
                             # (auto-cleaned if unchanged). Use for blind/read-only or parallel work.
preamble: <bool>             # true → inject skills/shared/preamble.md content
friction_log: <bool>         # true → skill appends to skills-meta/friction.jsonl at end of run
tunables:
  <key>: <value>             # overridable per-project in harness.json
artifacts:
  reads: [<path pattern>]    # contractual inputs (checked at skill start)
  writes: [<path pattern>]   # contractual outputs (produced before skill ends)
human_gate: <before|after|both|none>
pipeline_role:
  triggered_by: <string>
  receives: <string>
  produces: <string>
---
```

## Body

The markdown body contains the full workflow instructions. Write it as a direct system prompt in runtime-neutral terms: imperative mood, numbered steps, minimal assumptions about slash-command syntax.

### Required sections for pipeline skills (`phase` is set)

```markdown
## Input Contract
[What the skill expects — verified before starting]

## Steps
[Numbered, sequential steps]

## Output Contract
[What the skill produces — exact artifact format]

## Friction Log
[Filled at end of run — appended to skills-meta/friction.jsonl]

## Rules
[Non-negotiable rules specific to this skill]
```

### Preamble injection

If `preamble: true`, the contents of `skills/shared/preamble.md` are injected at the top of the rendered skill (after frontmatter). This is done at projection time by `sync-harness.sh`, not at runtime.

## Naming Convention

- File: `skills/<domain>/<name>.md`
- File: `skills/<domain>/<name>.md` where `<name>` is the kebab-case skill identifier
- Names must be kebab-case, unique across all skills (no mandatory `roster-` prefix)
- Canonical shared location after install: `.harness/skills/<name>.md`
- Claude compatibility location: `.claude/commands/<name>.md`
- Domain groups skills by function: `kb`, `media`, `meta`, `pipeline`, `shared`, `testing`, `workflow`

## Example

```markdown
---
description: Run TDD cycle — write failing test, implement, refactor, verify green.
---

# TDD Workflow

You guide the user through a strict red-green-refactor cycle.

## Steps

1. **Red** — Ask the user what behavior to add. Write a failing test for it. Run the test suite and confirm it fails.
2. **Green** — Write the minimum code to make the test pass. Run the suite again.
3. **Refactor** — Look for duplication or clarity improvements in both test and production code. Apply changes. Run suite to confirm green.
4. **Report** — Summarize what was added, tests passing, and any refactoring done.

## Rules

- Never write production code before a failing test exists.
- Never skip the refactor step, even if the code looks clean.
- Run the full test suite after every change, not just the new test.
```

## Install Behavior

The canonical installer should place the skill in the shared harness and then generate runtime entrypoints:

- Claude Code: copy or render to `.claude/commands/<name>.md`
- Codex project-local: render to `.agents/skills/<name>/SKILL.md`
- Codex global/session-discovered: render to `$CODEX_HOME/skills/<name>/SKILL.md` only when an explicit `codex-global` runtime is enabled
- OpenCode: render to `.opencode/agents/<name>.md` (agents) and `.opencode/skills/<name>/SKILL.md` (skills — native Agent-Skills discovery)
- GitHub Copilot: render to `.github/copilot-instructions.md` (global) and `.github/instructions/<name>.instructions.md` (per-agent)

Runtime wrappers should stay thin and mechanically regenerable from the shared source.
Do not reuse the Codex `SKILL.md` layout for OpenCode or Copilot — their loader contracts differ. Pi is the exception: it uses the same `<name>/SKILL.md` directory structure as Codex.
