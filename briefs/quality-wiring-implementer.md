# Implementer Sub-Brief — quality-wiring

**Date:** 2026-05-25
**Status:** VALIDATED

## Goal

Two improvements:
1. Wire four orphaned quality skills (`ambiguity-auditor`, `code-quality-auditor`, `kb-update`, `harness-validator`) into the pipeline at the right phases.
2. Add a skill structure linter (TypeScript) and hook it into `npm test`.

## Scope Boundary

DO NOT modify: `kb/` auditor skill files themselves, QA/investigate/audit/init/run/health skills, anything outside the 5 pipeline skills + package.json + new linter script.

## Files to Modify / Create

| File | Action | Change |
|---|---|---|
| `scripts/check-skill-structure.ts` | CREATE | New TypeScript linter |
| `package.json` | EDIT | Add `check:skills` script, hook into `test` |
| `skills/pipeline/roster-plan.md` | EDIT | v1.1.0 → v1.2.0: add ambiguity-auditor step 0 |
| `skills/pipeline/roster-implement.md` | EDIT | v1.2.0 → v1.3.0: add KB invariants read step |
| `skills/pipeline/roster-review.md` | EDIT | v1.1.0 → v1.2.0: add code-quality-auditor specialist |
| `skills/pipeline/roster-ship.md` | EDIT | v1.1.0 → v1.2.0: add kb-update after PR merge |
| `skills/meta/roster-skill-evolve.md` | EDIT | v1.2.0 → v1.3.0: add harness-validator per-proposal |

## Sequential Steps

### Step 1 — Write `scripts/check-skill-structure.ts`

Model on `scripts/check-agents.ts`. The file header comment must enumerate what is checked.

**Mandatory checks for ALL skills:**
- YAML frontmatter exists (starts with `---`, ends with `---`)
- frontmatter has `description` or `name` field (non-empty)
- frontmatter has `version` field matching semver (`/^\d+\.\d+\.\d+$/`)
- `## Steps` section exists

**Additional checks for pipeline/meta skills** (detect: frontmatter has `phase:` field, OR `preamble: true`, OR `friction_log: true`):
- `## When to Go Back` section exists
- `## What Next` section exists

**Additional checks for skills with `friction_log: true`:**
- `## Friction Log` section exists
- The Friction Log section contains a ` ```jsonl` fence (to enforce the wrapper)

**File collection:** glob `skills/**/*.md` (all subdirs: pipeline, meta, kb, utility, shared, etc.)

**Output format:** `file.md: message` per violation, then count summary. Exit 0 if clean, exit 1 if any violations.

**Skip:** `skills/shared/preamble.md` (it is injected, not a standalone skill).

### Step 2 — Hook into package.json

```json
"check:skills": "node dist/scripts/check-skill-structure.js",
"test": "npm run build:ts && node --test dist/scripts/build-index.test.js && node dist/scripts/check-agents.js && node dist/scripts/check-skill-structure.js"
```

### Step 3 — Wire ambiguity-auditor into roster-plan (v1.2.0)

Insert as **Step 0** (before existing "Read the brief" step):

```markdown
### 0. KB ambiguity pre-check (conditional)

```bash
[ -d kb ] && ([ -f kb/spec.md ] || [ -f kb/index.md ]) && echo "KB present" || echo "KB absent"
```

If KB is present:
→ Invoke `skills/kb/ambiguity-auditor.md` skill on the KB.
→ If the audit returns **Critical** findings: present them to the human. Ask:
  - "These KB contradictions may corrupt the plan. Fix KB first, or continue knowing these risks?"
  - If "fix first": STOP — return to user.
  - If "continue": annotate the plan with the contradictions as known risks.
→ If only Warnings/Info: log in the plan's "Identified risks" table. Continue.
→ If no findings: continue silently.

If KB is absent: skip silently.
```

**When to Go Back** entry to add:
```markdown
| KB has Critical contradictions and user chose to fix first | Stop — fix KB, then re-run `/roster-plan` |
```

**What Next** entry to add (ambiguity-auditor):
```markdown
- If KB Critical findings found and user wants to continue: `/ambiguity-auditor` can be re-run after KB fixes
```

### Step 4 — Wire KB invariants into roster-implement (v1.3.0)

Add to **Input Contract** (after existing pre-flight check block):

```markdown
If `kb/properties.md` exists, read it before touching any code.
Extract the invariants table — keep it as a mental checklist throughout implementation.
Violation of a KB invariant is a blocker: stop and escalate rather than breaking the invariant.
```

No step-level change needed — this is an input contract rule, not a procedural step.

### Step 5 — Wire code-quality-auditor into roster-review (v1.2.0)

In the **Conditional specialists** section (Step 3 of review), add to the specialists table:

```markdown
| code-quality-auditor | `skills/kb/code-quality-auditor.md` | When KB exists (`kb/properties.md` present) | Audits code against KB invariants, naming conventions, function size |
```

Add invocation instructions alongside existing specialist spawning pattern:

```markdown
**If `kb/properties.md` exists:**
→ Spawn `code-quality-auditor` as a sub-agent with:
  - The complete diff
  - `kb/properties.md` and `kb/glossary.md`
  - `briefs/<task>-reviewer.md`
  The auditor produces findings in its own format. Merge its Critical and Warning findings into the review findings table.
```

**When to Go Back** entry to add:
```markdown
| code-quality-auditor returns Critical KB violations | Auto-classify as HIGH finding → NO-GO unless auto-fixed |
```

### Step 6 — Wire kb-update into roster-ship (v1.2.0)

Insert after the **PR merge** step (after `gh pr merge --rebase`), before the Friction Log:

```markdown
### N. KB sync (conditional)

```bash
[ -d kb ] && ([ -f kb/spec.md ] || [ -f kb/index.md ]) && echo "KB present" || echo "KB absent"
```

If KB is present:
→ Invoke `skills/kb/kb-update.md` skill.
→ If `kb-update` reports a **contradiction** (code contradicts KB spec): surface as WARNING in the ship log.
  Do NOT attempt to revert the merge. Open a follow-up task: "KB amendment — <task-slug>".
→ If KB updated cleanly: commit the KB changes with:
  ```bash
  git add kb/
  git commit -m "docs(kb): sync KB with <task-slug> changes"
  git push
  ```
→ If KB absent: skip silently.
```

**When to Go Back** entry to add:
```markdown
| kb-update reports code contradicts KB spec | Log WARNING, do not revert — open a KB amendment task |
```

### Step 7 — Wire harness-validator into roster-skill-evolve (v1.3.0)

The current per-proposal loop ends with the jsonl validation gate. Insert harness-validator check AFTER the jsonl gate but BEFORE moving to the next proposal:

```markdown
#### Harness coherence check (per proposal)

```bash
[ -d kb ] || [ -d .harness ] && echo "harness present" || echo "harness absent"
```

If harness/KB present:
→ Invoke `skills/kb/harness-validator.md` skill.
→ If **Critical** findings:
  - Present findings to human before proceeding to next proposal.
  - Ask: "Critical harness coherence issues found. Fix now, skip remaining proposals, or continue knowing risks?"
→ If **Warnings only**: log to friction log, continue to next proposal.
→ If harness/KB absent: skip silently.
```

**When to Go Back** entry to add:
```markdown
| harness-validator returns Critical and user chooses to fix | Stop — fix harness, re-run `/roster-skill-evolve` |
```

### Step 8 — Version bumps + rebuild index

Bump versions in frontmatter:
- `roster-plan.md`: `1.1.0` → `1.2.0`
- `roster-implement.md`: `1.2.0` → `1.3.0`
- `roster-review.md`: `1.1.0` → `1.2.0`
- `roster-ship.md`: `1.1.0` → `1.2.0`
- `roster-skill-evolve.md`: `1.2.0` → `1.3.0`

Then:
```bash
cd /home/mathias/dev/agent-roster && npm run build:index
npm test   # must pass: 0 skill structure violations
```

## Quality Gates

```bash
npm run build:ts         # TypeScript compiles clean
npm test                 # all 3 checks pass including new check:skills
```

Expected: `check-skill-structure.js` reports 0 violations on the repo as shipped.

## Points of Attention (from voices)

- **Risk**: Linter must exempt `skills/shared/preamble.md` (not a standalone skill)
- **Risk**: KB-conditional logic is the same bash pattern in all 4 wired skills — keep it identical for consistency
- **Risk**: `kb-update` placement is POST-merge (not post-PR-open) — this was deliberately chosen
- **Risk**: `harness-validator` fail = WARN+human gate, not rollback — document this clearly in the step
- **Risk**: `tsconfig.json` already includes `scripts/**/*.ts` — no tsconfig change needed
