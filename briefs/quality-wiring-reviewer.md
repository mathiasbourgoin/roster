# Reviewer Sub-Brief — quality-wiring

**Date:** 2026-05-25
**Status:** VALIDATED

## What Was Implemented

Two improvements:
1. **Skill structure linter** (`scripts/check-skill-structure.ts`) — TypeScript linter checking all `skills/**/*.md` for: frontmatter validity, semver version, `## Steps`, `## When to Go Back`/`## What Next` (pipeline/meta skills), `## Friction Log` with ` ```jsonl` wrapper (friction_log skills).
2. **Quality skill wiring** — 5 pipeline skills edited to invoke orphaned KB auditors at the right phases.

## Files to Audit (Priority Order)

1. `scripts/check-skill-structure.ts` — NEW; most complex; verify all 4 check categories are implemented correctly
2. `package.json` — verify `check:skills` added and hooked into `test`
3. `skills/pipeline/roster-plan.md` — step 0 ambiguity-auditor, conditional on KB, Critical findings gate
4. `skills/pipeline/roster-ship.md` — kb-update after MERGE (not after PR open), WARNING not block on contradiction
5. `skills/meta/roster-skill-evolve.md` — harness-validator per-proposal (inside loop), Critical = human gate
6. `skills/pipeline/roster-review.md` — code-quality-auditor in specialists table, conditional on KB
7. `skills/pipeline/roster-implement.md` — KB invariants in Input Contract only (no step change)

## Identified Risks to Verify

| Risk | Verification |
|---|---|
| Linter catches `preamble.md` false positive | Confirm `skills/shared/preamble.md` is skipped in the linter |
| Linter detection of pipeline/meta skills | Confirm condition: `phase:` OR `preamble: true` OR `friction_log: true` — check edge cases |
| `kb-update` runs before PR merge | Confirm placement is POST-merge, not post-PR-open |
| harness-validator rollback ambiguity | Confirm "no rollback" is stated explicitly; Critical = human gate before next proposal, not undo |
| All 5 skills have updated version numbers | Check semver bumps in frontmatter |
| `npm test` passes with 0 violations | Linter must not flag its own repo |

## Expected Behaviors to Confirm

- `npm test` exits 0 with clean output (all 3 sub-checks pass)
- `npm run check:skills` reports "0 violations" on the current repo
- Every skill in `skills/**/*.md` (except `preamble.md`) has `description`/`name`, `version`, `## Steps`
- Every skill with `phase:` or `preamble: true` or `friction_log: true` has `## When to Go Back` and `## What Next`
- Every skill with `friction_log: true` has `## Friction Log` containing ` ```jsonl`
- The KB-conditional bash snippet is identical across all 4 wired skills (copy-paste consistency)
- Version bumps: plan 1.2.0, implement 1.3.0, review 1.2.0, ship 1.2.0, skill-evolve 1.3.0

## Severity Mapping

- Linter misses a real violation category → HIGH
- KB-conditional check inverts (runs when absent, skips when present) → HIGH
- `kb-update` placed before merge → HIGH
- Version bump missing or wrong → MEDIUM
- Linter output format unclear → LOW
- Inconsistent KB-conditional bash pattern → LOW
