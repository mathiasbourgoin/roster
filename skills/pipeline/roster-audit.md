---
name: roster-audit
description: Combines code-quality and spec-compliance checks into one actionable audit report.
when_to_use: "Use to assess existing code with no specific change in flight. Trigger: 'audit this', 'is the code healthy'."
version: 1.4.0
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
| **UNTESTED** | Code compliant + no test |
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

### 6.6. Code-intel audit sections (conditional, deterministic)

If code-intel audit-section packs are installed (resolved purely from SKILL.md
frontmatter per the seam contract in `schema/skill-schema.md` — `capability: code-intel`
+ `provides: audit-section` + `entry`), run:

```bash
node scripts/code-intel-resolve.js audit
```

In the roster repo the resolver lives at `scripts/code-intel-resolve.js`; in consumer
projects, locate it via the installed roster checkout. If unavailable, perform the
documented equivalent inline, deterministically: grep the seam frontmatter from
`.agents/skills/*/SKILL.md` then `.opencode/skills/*/SKILL.md` (dedupe by dir name,
`.agents` wins), and run each `provides: audit-section` pack's `entry` command with no
arguments, cwd = project root, `SKILL_DIR` set (lexicographic skill-name order).

- For each `SECTION <pack>` fragment on stdout: append the fragment to
  `briefs/audit-<date>.md` as a distinct section `## Code-intel: <pack> (deterministic)`.
  The existing Summary table columns are **unchanged**.
- For each `DEGRADED <pack>: <reason>` line: write a single-line degraded notice in
  place of that pack's section. The audit always continues. An unacknowledged pack
  (execution trust model, `schema/skill-schema.md`) surfaces here as
  `DEGRADED <pack>: unacknowledged — not executed (...)` — write the degraded notice
  like any other; its entry only runs after an extension-install hash match or a
  one-time `node scripts/code-intel-resolve.js ack <pack>`.
- **Read-only w.r.t. any pack index:** never run a pack's `init` or regenerate an index —
  a stale index is disclosed by the fragment's mandatory freshness header, not fixed here.
- **Severity stays model-judged:** you may cite fragment rows as evidence in Actionable
  findings, but never delegate severity classification to the pack.
- No pack installed → the resolver emits nothing and the report structure is unchanged.

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
| Spec compliance | PASS: N / UNTESTED: N / DIVERGE: N / MISSING: N | N |
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

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-audit"`.

## Rules

- Every finding must cite file and line — never a generality
- "The code looks clean" is not a finding
- Without KB → apply tunable thresholds, do not invent rules
- Not statically verifiable → say so explicitly, do not assume
- Never modify code during the audit
