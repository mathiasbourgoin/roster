# Intake Brief — quality-wiring

**Date:** 2026-05-25T00:41:00+02:00
**Status:** VALIDATED

## Goal

Wire four orphaned quality skills into the pipeline at the correct phases to eliminate "slop" — code that passes mechanical gates but violates KB invariants, or KB that drifts from the code. Currently `code-quality-auditor`, `kb-update`, `harness-validator`, and `ambiguity-auditor` exist as skills but are never invoked by any pipeline skill.

Five targeted changes:
1. **`roster-plan`** — invoke `ambiguity-auditor` on KB before planning (if KB exists), surface contradictions that would corrupt the plan
2. **`roster-implement`** — add `kb/properties.md` to Input Contract; add a "read KB invariants" step before coding so implementers know what they must not break
3. **`roster-review`** — add `code-quality-auditor` as a mandatory specialist (always, if KB exists), alongside the existing `spec-compliance` and `architect`
4. **`roster-ship`** — invoke `kb-update` skill after PR opened to sync KB with shipped code
5. **`roster-skill-evolve`** — invoke `harness-validator` after each proposal install to confirm harness coherence

## Scope Boundary

OUT of scope:
- Changing the kb auditor skills themselves (code-quality-auditor, kb-update, etc.)
- Adding new skills or agents
- Changes to QA, investigate, audit, init, run, health skills
- Any runtime projection / sync-harness changes

## Relevant Files

| File | Role | Change |
|---|---|---|
| `skills/pipeline/roster-plan.md` | Plan decomposer | Add optional ambiguity-auditor step when KB exists |
| `skills/pipeline/roster-implement.md` | Implementation driver | Add kb/properties.md to Input Contract + KB invariant read step |
| `skills/pipeline/roster-review.md` | GO/NO-GO review | Add code-quality-auditor as mandatory specialist |
| `skills/pipeline/roster-ship.md` | Ship + PR | Invoke kb-update after PR opened |
| `skills/meta/roster-skill-evolve.md` | Improvement implementer | Invoke harness-validator after each proposal install |

## Architecture Notes

**Invocation pattern** (consistent with existing spec-compliance invocation in roster-review):
- Skills invoked via `Skill` tool or spawned as sub-agent with the skill file content
- Reference paths: `skills/kb/code-quality-auditor.md`, `skills/kb/kb-update.md`, etc.
- All four skills are read-only except `kb-update` (which writes KB files)

**KB-conditional logic:** ambiguity-auditor and code-quality-auditor only run when KB exists:
```bash
[ -d kb ] && [ -f kb/spec.md ] && echo "KB present" || echo "KB absent — skip"
```

**kb-update placement:** ship (not implement) — only update KB for code that actually merged. Running at implement would update KB for code that might be rejected at review.

**harness-validator placement:** after each proposal in roster-skill-evolve (not once at end) — catch coherence breaks per-install, not all at once.

## Quality Gates

```bash
# No build/test — markdown skill files only
npm run build:index
```

## Open Questions

_(none)_
