# QA Scope — quality-wiring

**Date:** 2026-05-25
**Status:** VALIDATED

## Quality Gates

```bash
npm run build:ts                          # TypeScript compiles clean
npm test                                  # All 3 checks pass
npm run check:skills                      # 0 violations reported
```

## Behaviors to Validate

1. `check:skills` exits 0 on this repo's skills as-shipped
2. `check:skills` would exit 1 if `## Steps` were removed from any skill (spot-check by temporarily removing and verifying)
3. `check:skills` would exit 1 if version were set to `v1.2.0` (with `v` prefix) instead of `1.2.0`
4. `check:skills` skips `skills/shared/preamble.md` without violation
5. All 5 modified skills have correct new version in frontmatter
6. `skills-meta/friction.jsonl` has a new entry for this cycle (appended by the implementer)
