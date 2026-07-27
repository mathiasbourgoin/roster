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
friction_log: <bool>         # true → skill appends to skills-meta/friction.jsonl AT PHASE EXIT
                             # (when this skill finishes), not at session end — see
                             # "Friction Log Entry Schema" below
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
requires_review_bundle: <semver range, QUOTED e.g. ">=1.0.0">
                             # declares a dependency on the committed review-tool bundle
                             # (scripts/review-bundle.manifest.json — specs/review-tool-
                             # distribution.md). roster-doctor reads this from the installed
                             # projection to gate readiness; roster-review's own preflight is
                             # a separate input-contract abort, not a doctor read. QUOTE the
                             # value — unquoted, some YAML parsers read ">=1.0.0" oddly.
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
provides: <gate|audit-section|init|research-orientation>
                             # what the pack contributes: gate → roster-qa invariant gate;
                             # audit-section → deterministic audit fragment; init → index
                             # bootstrap; research-orientation → advisory orientation queries
                             # for roster-research (never a gate). One value per skill; ship
                             # one skill per role.
entry: bash gate.sh          # interpreter-prefixed shell command, script path relative to
                             # the skill directory. ALWAYS prefix the interpreter (`bash`,
                             # `python3`, …): installers copy files without preserving the
                             # executable bit, so a bare `./gate.sh` would fail after
                             # install. Consumers run the command via `bash -c` from the
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

**Execution trust model.** Resolution and execution are separate trust levels (human
decision 2026-07-09). Any SKILL.md carrying the seam quadruple is *resolved* as a
first-class pack (FR-024), but its `entry` is *executed* by the qa/audit consumers only
when the pack is acknowledged, via one of two trusted paths:

1. **Extension-installed:** the SKILL.md's current bytes match the sha256 the extension
   installer recorded in `.harness/extensions.json` `installed_files` — installing via the
   extension CLI *is* the consent act; no further step is needed.
2. **Explicit ack:** a human has run `node scripts/code-intel-resolve.js ack <skill>`,
   which shows the pack's dir, `entry`, and `requires_tools`, then records
   `{"skill": "<dir-basename>", "sha256": "<hex of SKILL.md bytes>"}` in
   `.harness/code-intel-ack.json`. This is the one-time consent act for user-authored packs.

Checkout alone no longer executes anything: an unacknowledged pack is reported as
degraded (`gate`/`audit`) or `WARN unacknowledged` (`doctor`) and its `entry` is never
run — it never blocks a verdict. Any edit to an acknowledged SKILL.md invalidates the
hash and returns the pack to unacknowledged; re-run `ack` after reviewing the change.

## Friction Log Entry Schema

Each entry appended to `skills-meta/friction.jsonl` follows this structure:

```jsonc
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",          // the skill that logged this entry
  "task": "<task-slug>",
  "frictions": ["<string>", ...],   // observed friction events (empty array if none)
  "classes": ["<value>", ...],      // CLOSED vocabulary — see "Friction classes" below.
                                    // The set of classes covering this entry's frictions[],
                                    // most load-bearing first. MUST be empty iff frictions
                                    // is empty (a clean run has no classes).
  "methods": ["<string>", ...],     // methods used during the run
  "suggestion_type": "<value>|null",// improvement proposal type — open lowercase vocabulary:
                                    //   skill | tool | adapt | agent | research | null
                                    // Note: this is NOT a closed enum; new values may appear.
                                    // Used by roster-skill-health for clustering. Do not jam
                                    // routing/telemetry events into this field.
  "suggestion": "<string>|null",    // the concrete improvement proposal (or null)
  "effort_estimate": "<string>|null",// e.g. "small", "medium", "large" (or null)
  "class_note": "<string>|null",    // REQUIRED (non-empty) iff classes contains "other".
                                    // One line: what the friction was, in class terms.
                                    // Its accumulation is the evidence for extending the
                                    // vocabulary — an unexplained "other" is not admissible.
  "skipped": ["<string>", ...],     // OPTIONAL. Mandated steps this run did NOT perform, one
                                    // "<step>: <reason>" per entry. Silence is not evidence of
                                    // absence: a phase that skipped its scripts records the
                                    // skip here. Omit the key entirely when nothing was skipped.
  "event": "<string>|null"          // routing/telemetry events — separate from suggestion_type.
                                    // Current values: "critical_declined"
                                    // Write-only; not consumed by roster-skill-health.
}
```

**`suggestion_type` vocabulary is open by practice.** `roster-init` emits `"research"` in
addition to the documented `skill|tool|adapt|agent`. Do not treat the documented set as closed
when authoring new skills or creating the schema block in a project.

The nine keys (`date`, `skill`, `task`, `frictions`, `classes`, `methods`, `suggestion_type`,
`suggestion`, `effort_estimate`) are the **required minimum** every skill's `## Friction Log`
template carries; per-skill extra fields (e.g. `class_note`, `skipped`, `event`, `mode`) are
allowed on top. Placeholder values validate as keys being present, not as value formats.

### When an entry is written

**At phase exit — when the skill finishes, before it hands off.** Not at session end.

This is a contract, not a preference. A log written once, late, from memory loses the corrections
and keeps the narrative; and a session that never ends writes nothing at all. The entry belongs to
the phase, so a task that ran five phases leaves five entries sharing one `task` slug.

Mechanically: `scripts/check-friction-shape.js --log <path>` validates a real log's shape and
classes; `/roster-ship` reports per-task entry coverage at ship time (see `skills/pipeline/
roster-ship.md`). Neither can prove an entry was written *at* phase exit rather than reconstructed
later — that part is prose, and it is prose on purpose. What *is* detectable is a task that shipped
with fewer entries than phases, which is the shape the omission actually takes.

### Friction classes

The closed vocabulary. Distilled from 172 friction strings across 56 real entries; every value
below is carried by ≥3 of them, and each names a distinct *remedy*, not a distinct symptom.

```
classes: <gate-vacuous|evidence|process-bypass|missing-artifact|stale-tooling|agent-isolation|parallel-collision|schema-drift|scope|git-mechanics|human-gate|runtime-limits|external-dep|positive-signal|other>
```

| Value | The failure it names | Canonical instance |
|---|---|---|
| `gate-vacuous` | A check passed while checking nothing — silent degrade, absent oracle, coverage gap that reads as approval, control that never armed. | A convergence gate emits `violations: []` and exits 0 when a key is absent. |
| `evidence` | A conclusion asserted without, or against, the evidence — and later refuted. Includes stale docs that seed false premises. | Two successive confident root-cause verdicts, both wrong. |
| `process-bypass` | A mandated step was not performed, and nothing recorded its absence. | Cross-runtime review declared mandatory, skipped silently on every PR. |
| `missing-artifact` | A file the contract references does not exist, is untracked, or is absent from the install. | The review-tool bundle neither tracked nor gitignored — a fresh clone gets no gates. |
| `stale-tooling` | A tool is present but stale, misbehaving, or environment-sensitive; its output cannot be trusted. | A fetch reporting success while not updating refs. |
| `agent-isolation` | Worktree / shared-checkout / sub-agent boundary damage. | `isolation: worktree` resolving against the wrong repo; an agent losing work in the shared checkout. |
| `parallel-collision` | Concurrent agents contending for one shared resource. | Four simultaneous cross-runtime passes; a shared scratchpad basename. |
| `schema-drift` | Two artifacts disagree about a shape, or a required contract is undocumented at the call site. | A trace schema whose event enum the gate does not accept. |
| `scope` | Work scoped too narrowly or too broadly, or duplicating already-delivered work. | A reviewer prompt so tightly scoped the reviewer walked past a bug in the file it was reading. |
| `git-mechanics` | A git or forge operation whose real result differs from its reported result. | `git rebase` silently dropping a commit; `git stash push` no-oping on a committed tree. |
| `human-gate` | A human decision was required and was unavailable, deferred, or handed back to the human. | A validation quiz presented async because the human was AFK; asking the human to arbitrate a backlog instead of draining it. |
| `runtime-limits` | The agent runtime constrained the work — session limit, compaction, killed background job, rejected tool arity. | A phase run inline because per-phase skill invocation was too context-heavy. |
| `external-dep` | A third-party service or a physical machine was unavailable, rate-limited, or flaky. | Account-wide review-bot rate limiting serialising PRs over hours. |
| `positive-signal` | **Not a friction.** A gate that worked, a discovery, a product bug the process caught. Recorded because it is evidence *for* the process. Excluded from clustering. | "cross-runtime found 2 HIGH the primary reviewer missed". |
| `other` | None of the above. Requires a non-empty `class_note`. | — |

**Rules.**

- `classes` is closed. A value outside this list is a schema violation, not a new class.
- `other` is legal and must stay cheap to use and impossible to hide: `class_note` is required, and
  `/roster-skill-health` reports the `other` rate every run. A vocabulary that pushes everything
  into `other` has failed and should be extended — from the accumulated notes, deliberately.
- Prefer the **remedy**, not the symptom. A stale binary that produced a green build is
  `gate-vacuous` (the build lied) — not `stale-tooling` — because the fix is to arm the check.
- An entry may carry several classes; write the most load-bearing first. In the corpus this
  vocabulary was tested against, 8 of 56 entries genuinely spanned two or more, which is why this
  is an array and not a scalar.
- `positive-signal` alone does **not** make an entry a clean run. A clean run is `frictions: []`
  and `classes: []`.

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
