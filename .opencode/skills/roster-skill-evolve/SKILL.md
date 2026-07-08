---
name: roster-skill-evolve
description: Implements skill-health approved improvements — skills, tools, adaptations, agents.
version: 1.4.0
domain: meta
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Write, Edit, Bash, Agent, Skill, AskUserQuestion]
human_gate: both
artifacts:
  reads:
    - skills-meta/health-<date>.md
    - workflows/*.cwr.json
  writes:
    - skills/<domain>/<name>.md
    - scripts/<name>.sh
    - .harness/hooks/skills/<skill>/<pre|post>.md
    - .harness/hooks/shared/<fragment>.md
    - workflows/templates/<mode>.cwr.json
    - .harness/harness.json (via sync-harness.sh)
pipeline_role:
  triggered_by: /roster-skill-health with APPROVED proposals
  receives: skills-meta/health-<date>.md
  produces: skills / scripts / patches installed in the harness
---


# Roster Preamble

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction: present the recommendation,
explain why, state what context you might be missing, and ask — never act unilaterally.

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


# Roster Skill Evolve

You implement improvements approved by `/roster-skill-health`. Work one proposal at a time, with a human gate before each install.

**Token discipline:** one proposal at a time. No silent batching.

## Input Contract

Find the most recent report:
```bash
ls -t skills-meta/health-*.md | head -1
```

Read this file. Extract proposals marked `**APPROVED**`.

If no APPROVED proposal:
> "No approved proposals in the latest report.
> Re-run `/roster-skill-health` to analyze the friction log."

## Steps

**Category vocabulary is owned by `/roster-skill-health`** (its §4 A–F list is the shared
contract): A `[SKILL]`, B `[TOOL]`, C `[ADAPT]`, D `[HOOK]`, E `[AGENT]`, F `[WORKFLOW]`.
Each tag has a handler below. A report tag with no handler here is a contract violation —
stop and escalate rather than improvising.

For each APPROVED proposal, in order A → B → C → D → E → F:

### Proposal [SKILL] — New skill

1. **Gate before**: present the proposed name and description. Confirm the domain (`pipeline`, `operational`, `meta`).

2. **Search first**:
   - Search in `skills/` for a similar existing skill
   - Search in the roster index (`index.json`) if available
   - If equivalent found → propose adaptation instead of creation

3. **Invoke skill-creator**:
   Spawn the `skill-creator` sub-agent if available (`.claude/agents/skill-creator.md` exists).
   Otherwise, manually describe the skill (name, domain, description, artifacts in/out) and open an issue on the roster repo.
   Provide:
   - Capability description
   - Target domain
   - Context of frictions that motivated the creation
   - Path: `.claude/agents/` (read from installed harness)

4. **Review the generated skill**:
   - Verify frontmatter (description, version, domain, friction_log, preamble)
   - Verify presence of required sections (Input Contract, Steps, Output Contract, Friction Log, Rules)
   - Verify consistency with artifacts of adjacent skills
   - Apply corrections if necessary

5. **Gate after**: present the final skill. Request install approval.

6. **Install**:
   ```bash
   # Place in the appropriate domain
   mv <skill-draft> skills/<domain>/roster-<name>.md

   # Add to harness.json
   # (layers.skills section)

   # Project to runtimes if sync-harness.sh available
   bash scripts/sync-harness.sh 2>/dev/null || echo "manual sync required"
   ```

---

### Proposal [TOOL] — Deterministic tool

1. **Gate before**: present the script name and its expected behavior.

2. **Write the script** in `scripts/`:
   - Mandatory documentation header:
     ```bash
     #!/usr/bin/env bash
     # <name>.sh — <one-line description>
     # Usage: ./<name>.sh [args]
     # Motivated by: friction "<original friction>" (<N> occurrences)
     # Added: <date>
     set -euo pipefail
     ```
   - Deterministic behavior — same inputs → same outputs
   - Explicit exit code (0 = success, non-zero = error)
   - Useful error message on stderr

3. **Test the script**:
   - Nominal case
   - Error case (missing input, broken environment)
   - Document tested cases in the header

4. **Reference in the affected skill**:
   - Open the skill that generates the friction
   - Replace the workaround with the script call in the Steps section
   - Bump version (patch: +0.0.1)

5. **Gate after**: show the script and the diff of the modified skill.

---

### Proposal [ADAPT] — Adaptation of existing skill

1. **Gate before**: present the target skill, the section to modify, and the proposed change.

2. **Read the current skill** in its entirety.

3. **Apply the patch**:
   - Modify only the identified section
   - Do not touch the rest
   - Bump version:
     - Minor behavior change: +0.1.0
     - Fix / clarification: +0.0.1

4. **Verify consistency**:
   - Produced artifacts still match the artifacts read by the next skill
   - Rules are not contradicted by the new Steps
   - Friction Log is still present

5. **Gate after**: present the diff. Request approval before saving.

6. **Project** if the skill is in `.claude/commands/`:
   ```bash
   cp skills/<domain>/roster-<name>.md .claude/commands/roster-<name>.md
   ```

---

### Proposal [HOOK] — Skill hook

1. **Gate before**: present the target skill, the phase (`pre` or `post`), and what the hook
   automates (the guard / cleanup / feedback loop cited in the proposal).

2. **Author the hook** at `.harness/hooks/skills/<skill-name>/<pre|post>.md`:
   - Frontmatter: `name`, `version`, `event: pre|post`, `skill: <skill-name>`, `on_error`,
     `description` (see `docs/hooks.md` for the format and step operators)
   - A fenced ` ```yaml ` block with `steps:` — prefer deterministic `run:`/`test:` steps;
     `prompt:`/`loop:` steps only when the check genuinely needs LLM judgment

3. **Validate and dry-run**:
   ```bash
   node dist/scripts/check-hook-structure.js
   TASK=<sample-slug> node dist/scripts/run-hook.js <pre|post> <skill-name>
   ```
   Both must exit clean (run-hook exit 0/2/3 are acceptable outcomes; 1 means the hook's
   abort path fired — verify that is the intended behavior for the sample input; 4 means
   the runner did not find the hook — a red flag right after authoring it: check the
   path and `skill:` frontmatter).

4. **Gate after**: show the hook file and the dry-run output. Request install approval,
   then `bash scripts/sync-harness.sh`.

5. **Lifecycle proposals** (hook→skill migration, skill→hook extraction — see
   `/roster-skill-health` §4.D): treat as `[ADAPT]` on the affected skill plus a hook
   file add/delete; both diffs go through the same before/after gates. A skill→hook
   extraction that health proposed as a **shared fragment** writes
   `.harness/hooks/shared/<fragment>.md` and updates each affected skill hook to
   `include:` it — run `node dist/scripts/check-hook-structure.js` after sync.

---

### Proposal [AGENT] — New dedicated agent

1. **Gate before**: present the role, domain, and frictions motivating it. This is a large investment — confirm explicitly.

2. **Sequence**:
   - First invoke `skill-creator` to define the associated skill profile
   - Then invoke `recruiter` in Mode 1 with the new role as the identified need
   - Human gate between the two

3. **Follow the standard recruiter workflow** for install in the harness.

### Proposal [WORKFLOW] — Promote instance diff to template

1. **Collect instances and compute diffs**:
   ```bash
   ls workflows/*.cwr.json 2>/dev/null | grep -v 'templates/' || echo "no instances"
   ```
   For each instance:
   - Identify the source template **structurally**: match the instance's step sequence
     (id, skill) against each `workflows/templates/*.cwr.json`. `_roster_template_version`
     alone cannot identify the template — it is a version string and multiple templates
     share versions. If zero or multiple templates match → mark the instance
     `[AMBIGUOUS]`, skip it.
   - Load the matched `workflows/templates/<mode>.cwr.json`
   - Compute structural diff: compare steps by (position, id, skill) — **ignore prompt content**
   - If template has been updated since `_roster_template_version` → mark diff as `[CONFLICT]`, skip

2. **Cluster diffs**: group instances by (template, structural-diff-signature). For clusters with count ≥ `min_entries_for_signal` (default 3, shared with roster-skill-health tunable), generate a unified structural diff.

3. **Gate before**: present the unified diff to the human. Show how many instances share this modification and what it does. Do not apply without explicit approval.

4. **Apply patch** (on approval):
   - Edit `workflows/templates/<mode>.cwr.json` to incorporate the diff
   - Bump `_roster_version`: minor (x.Y.0) if steps added/removed; patch (x.y.Z) for wording changes
   - Validate before the after-gate counts as satisfied:
     `jq empty workflows/templates/<mode>.cwr.json && node scripts/check-cwr-templates.js`
     (plus `cwr lint` when the CLI is available) — a template that fails validation is a
     failed apply: revert it
   - Run `bash scripts/sync-harness.sh`

5. **Gate after**: present the final template diff. Request commit approval.

6. **Conflict handling**: if template evolved since instances were created (version mismatch), mark the proposal `[CONFLICT — template evolved; cannot apply cleanly]` and skip without modifying any file.

---

### Post-edit validation (run after every proposal)

After any edit to skill `.md` files, run this integrity check:

```bash
# Verify all friction_log: true skills have a valid jsonl block
missing=$(grep -rL '```jsonl' $(grep -rl 'friction_log: true' skills/ --include='*.md') 2>/dev/null)
if [ -n "$missing" ]; then
  echo "❌ Missing jsonl wrapper in: $missing"
else
  echo "✅ All friction_log skills have valid jsonl wrapper"
fi
```

If any skill fails: restore the `## Friction Log` block with the correct format before proceeding to the next proposal.

### Harness coherence check (run after every proposal)

```bash
[ -d kb ] || [ -d .harness ] && echo "harness present" || echo "harness absent"
```

If harness/KB is **present**:
→ Invoke `skills/kb/harness-validator.md` skill.
→ If **Critical** findings:
  - Present findings to human before proceeding to the next proposal.
  - Ask: "Critical harness coherence issues found. Fix now, skip remaining proposals, or continue knowing the risks?"
  - If "fix now": STOP — fix harness, then re-run `/roster-skill-evolve`.
  - If "skip remaining" or "continue": log to friction log and proceed as directed.
→ If **Warnings only**: log to friction log; continue to next proposal.
→ If harness/KB is **absent**: skip silently.

---

## Output Contract

For each APPROVED proposal:
- [SKILL] → `skills/<domain>/roster-<name>.md` installed + harness updated
- [TOOL] → `scripts/<name>.sh` created + affected skill patched
- [ADAPT] → skill patched + version bumped
- [HOOK] → `.harness/hooks/skills/<skill>/<pre|post>.md` installed + structure check green
- [AGENT] → agent installed via recruiter
- [WORKFLOW] → template patched + `_roster_version` bumped

## When to Go Back

| Condition | Action |
|---|---|
| No approved proposals in the health report | Stop — re-run `/roster-skill-health` to generate proposals first |
| A proposal implementation breaks existing quality gates | Stop — revert the change, note in friction log, skip that proposal |
| Harness-validator returns Critical and user chose to fix harness | Stop — fix harness, then re-run `/roster-skill-evolve` |

## What Next

**Primary path:** Done — improvements installed; re-run `/roster-skill-health` after next batch of cycles
**Alternatives:**
- `/roster-skill-health` immediately — if new frictions were discovered during this run

> 💡 After evolving skills, run a few pipeline cycles to validate the improvements before the next health check.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-skill-evolve",
  "task": "skill-evolution",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- One proposal at a time — no silent batching
- Human gate before AND after each install
- Search first for skills — do not create what already exists
- Never modify a skill outside the section identified in the ADAPT proposal
- If skill-creator fails → note in friction.jsonl and move to the next proposal
- The friction log of skill-evolve itself is a source of meta-improvement
