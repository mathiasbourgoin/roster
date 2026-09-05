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
phase: <intake|question|research|spec|plan|implement|review|qa|ship|null>
capability: <formal-rocq|formal-quint|workflow-builder|code-intel>   # optional; required for
                                                           # skills that use a specialised
                                                           # backend or runner, or that expose
                                                           # a pack seam (see below)
tags: [tag1, tag2]
allowed_tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion, Skill, WebFetch, WebSearch]
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
human_gate: <before|during|after|both|none>
                             # during → the gate sits inside the skill's own steps (an in-run
                             # AskUserQuestion checkpoint, e.g. roster-workflow-build's template
                             # confirmation) rather than before/after the whole run
disable-model-invocation: <bool>  # true → the runtime must never auto-select this skill; it is
                                  # maintainer/human-invoked only (e.g. roster-upgrade)
pipeline_role:
  triggered_by: <string>
  receives: <string>
  produces: <string>
---
```

## Code-Intel Pack Seam Contract

A skill becomes an addressable code-intel pack component when its frontmatter carries the
seam quadruple (specs/code-intel-packs.md, FR-020). Consumers (roster-qa, roster-doctor,
roster-audit, code-quality-auditor) resolve packs purely from this frontmatter over the
projected runtime skill dirs (`.agents/skills/`, then `.opencode/skills/`) via
`scripts/code-intel-resolve.js` — never from the registry or `harness.json`, so a
user-authored skill carrying the contract is a first-class pack.

```yaml
---
capability: code-intel       # the seam tag — without it, consumers never see the skill
provides: <gate|audit-section|init>
                             # what the pack contributes: gate → roster-qa invariant gate;
                             # audit-section → deterministic audit fragment; init → index
                             # bootstrap. One value per skill; ship one skill per role.
entry: bash gate.sh          # interpreter-prefixed shell command, script path relative to
                             # the skill directory. ALWAYS prefix the interpreter (`bash`,
                             # `python3`, …): installers copy files without preserving the
                             # executable bit, so a bare `./gate.sh` would fail after
                             # install. Consumers run the command via `sh -c` from the
                             # project root with `SKILL_DIR` set to the absolute skill
                             # directory; the script token is resolved against the skill
                             # dir.
requires_tools: [tool1, tool2]
                             # binaries the pack needs on PATH; roster-doctor checks each
                             # with `command -v` (advisory only — a missing tool degrades
                             # the pack, it never blocks routing). MUST be an inline-array
                             # literal `[a, b]` on one line — the flat frontmatter parser
                             # skips indented YAML list items, so a block-style list is
                             # silently read as empty.
---
```

## Friction Log Entry Schema

Each entry appended to `skills-meta/friction.jsonl` follows this structure:

```jsonc
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",          // the skill that logged this entry
  "task": "<task-slug>",
  "frictions": ["<string>", ...],   // observed friction events (empty array if none)
  "methods": ["<string>", ...],     // methods used during the run
  "suggestion_type": "<value>|null",// improvement proposal type — open lowercase vocabulary:
                                    //   skill | tool | adapt | agent | research | null
                                    // Note: this is NOT a closed enum; new values may appear.
                                    // Used by roster-skill-health for clustering. Do not jam
                                    // routing/telemetry events into this field.
  "suggestion": "<string>|null",    // the concrete improvement proposal (or null)
  "effort_estimate": "<string>|null",// e.g. "small", "medium", "large" (or null)
  "event": "<string>|null"          // routing/telemetry events — separate from suggestion_type.
                                    // Current values: "critical_declined"
                                    // Write-only; not consumed by roster-skill-health.
}
```

**`suggestion_type` vocabulary is open by practice.** `roster-init` emits `"research"` in
addition to the documented `skill|tool|adapt|agent`. Do not treat the documented set as closed
when authoring new skills or creating the schema block in a project.

The first eight keys (`date`, `skill`, `task`, `frictions`, `methods`, `suggestion_type`,
`suggestion`, `effort_estimate`) are the **required minimum** every skill's `## Friction Log`
template carries; per-skill extra fields (e.g. `event`, `mode`) are allowed on top. Placeholder
values validate as keys being present, not as value formats.

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

- File: `skills/<domain>/<name>.md` where `<name>` is the kebab-case skill identifier
- Names must be kebab-case, unique across all skills (no mandatory `roster-` prefix)
- Exemption: `skills/shared/preamble.md` is an injected fragment, not a standalone skill —
  `check-skill-structure.ts` skips it (`SKIP_FILES`) and it is not subject to skill frontmatter
  or naming requirements
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
