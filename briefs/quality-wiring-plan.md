# Plan — quality-wiring

**Date:** 2026-05-25T00:42:00+02:00
**Status:** VALIDATED

## Sequential Steps

1. **Define skill structure spec** — document canonical section order and mandatory fields for each skill class (pipeline/meta/kb/utility). Produce the spec as a comment block at the top of the linter script. No external file — the linter is the spec.

2. **Write `scripts/check-skill-structure.ts`** — TypeScript linter (consistent with existing TS tooling) that:
   - Parses YAML frontmatter (using existing node YAML or simple regex — no new deps)
   - Checks `description` and `version` fields present and semver-valid
   - Checks `## Steps` exists in every skill
   - Checks `## When to Go Back` + `## What Next` for pipeline/meta skills (detect via `phase:` field or `preamble: true`)
   - Checks ` ```jsonl` wrapper in `## Friction Log` section for skills with `friction_log: true`
   - Exits non-zero on any violation; prints file:issue pairs

3. **Add `check:skills` script to `package.json`** — `node dist/scripts/check-skill-structure.js`. Hook into `test` alongside existing checks.

4. **Wire `ambiguity-auditor` into `roster-plan`** (v1.2.0) — insert step 0 before planning:
   - Check if `kb/` exists with at least `spec.md` or `index.md`
   - If yes → invoke `ambiguity-auditor` skill, surface critical findings as warnings in the plan
   - If findings are Critical: present to human, ask to continue or fix KB first
   - If `kb/` absent → skip silently

5. **Wire KB invariants into `roster-implement`** (v1.3.0) — add `kb/properties.md` to Input Contract reads (if KB exists); add step "Read KB invariants" before step 1 (read-only, populate a mental checklist of invariants not to break).

6. **Wire `code-quality-auditor` into `roster-review`** (v1.2.0) — add to specialists table as "mandatory when KB exists" (same conditional pattern as step 4). Specialist receives: diff + reviewer.md + `kb/properties.md`.

7. **Wire `kb-update` into `roster-ship`** (v1.2.0) — insert after step "PR merged" (not after PR opened, to avoid updating KB for code that didn't merge). If `kb/` absent → skip. If `kb-update` reports a contradiction → surface as WARNING in the ship log (do not unmerge).

8. **Wire `harness-validator` into `roster-skill-evolve`** (v1.3.0) — insert after each proposal install (inside the per-proposal loop). If validator returns Critical → present to human before next proposal; if WARN only → log to friction and continue.

9. **Bump versions and rebuild index** — bump all 5 modified skills, update AGENTS.md skill count (still 11), rebuild index with `npm run build:index`.

## Dependencies

- Steps 1→2→3 must be sequential (spec → linter → hook)
- Steps 4-8 are independent of each other (execute in parallel or any order)
- Step 9 must be last

## Identified Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Linter rejects existing skills that don't have `When to Go Back` | HIGH | HIGH | Linter only checks pipeline skills with `phase:` or `preamble: true`; KB skills exempt |
| `kb-update` contradiction flag blocks or confuses ship flow | MEDIUM | MEDIUM | Make it WARNING not BLOCK in ship; document clearly |
| `harness-validator` fails in repos with no harness | HIGH | LOW | Check for `.harness/` or `kb/` before invoking; skip gracefully if absent |
| TypeScript linter adds new dev dependency | LOW | LOW | Use existing `@types/node`, no new packages needed |

## Decisions Made

| Point | Decision | Reason |
|---|---|---|
| `kb-update` placement | After PR MERGE (not after PR open) | Avoid updating KB for code that gets rejected |
| `harness-validator` on fail | WARN + human gate before next proposal | Don't rollback — just expose the issue |
| Skill structure linter | TypeScript (consistent with existing scripts) | No new tooling; compiles with existing `tsconfig.json` |
| Linter enforcement | All pipeline skills (phase or preamble) require When/What; all skills require Steps + semver version | Minimum viable spec that catches real issues |

## Assumptions

- No project currently has a `kb/` directory (quality auditors run conditional — all will skip)
- The existing `tsconfig.json` includes `scripts/` in compilation scope
- `scripts/check-skill-structure.ts` can use simple regex for frontmatter parsing (no `js-yaml` dep needed)
