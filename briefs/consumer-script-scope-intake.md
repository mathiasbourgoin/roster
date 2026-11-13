# Intake Brief — consumer-script-scope

**Date:** 2026-11-13
**Status: VALIDATED**
**Type:** fix
**Trust boundary:** yes
**Mode:** full (portable installer filesystem/module boundary; no cryptographic change)
**Validation:** the owner delegated routine pipeline decisions to the lead; the lead explicitly authorized this exact .cjs packaging repair, tests and upstream-next PR before implementation. No consumer file rewrite or new runtime framework is authorized.

## Goal

Fix issue107: the review-bundle installer adds a CommonJS directory scope and changes unrelated native TypeScript/ESM execution. Distribute the existing CommonJS closure with explicit .cjs names and references, so a consumer receives usable tools while retaining its original module semantics. A refusal-only guard is insufficient for the normal mixed-consumer path.

## Scope Boundary

Only the existing review-bundle CommonJS code closure, closure resolution/checks, installer safety checks, generated manifest, tests and invocation references/generated projections are in scope. No algorithm changes, provider invocation, consumer rename/config rewrite, dependency install, new framework or unrelated harness migration. Preserve existing shared-file ownership, collisions, customized helpers, install atomicity, upgrade/removal policies and selected runtime/team settings.

## Relevant Files

| File | Role | Key snippet |
|---|---|---|
| `scripts/review-bundle-install.sh` | lifecycle and collision checks | `find ... -name '*.js'` misses native TypeScript |
| `scripts/review-bundle-manifest.js` | generated closure distribution | currently appends `scripts/package.json` |
| `scripts/lib/bundle/review-bundle-closure.js` | static dependency graph | walks only `.js`, resolves bare requires |
| `scripts/lib/bundle/review-bundle-check.js` | closure gate | exact entrypoint set |
| manifest's18 CommonJS `.js` entries | portable existing code | retain legacy paths; generate deterministic `.cjs` counterparts with only known relative require rewrites |
| `scripts/review-bundle-install.test.js`, `scripts/review-bundle.test.js` | real installer/runtime tests | existing ESM install and ownership/lifecycle fixtures |
| installed skill source/tool references | exact invocation paths | update only portable invocation references and generated projections |

## Architecture Notes

Pinned source c232d0d01c3ca54905031f830de3ffb28ed6a30e on next. Actual generic Node26.13.0 probe: unchanged typed `export` consumer exits0/prints42 before real installation, installer exits0, consumer exits1 after `scripts/package.json` is added. Source claims check is fresh; exact context manifest records model64b0d471…/freshnessc0776dac…. All mandatory claims remain in that manifest. No alternate validator or consumer workaround is selected.

## Quality Gates

```sh
node --test scripts/review-bundle-install.test.js
node --test scripts/review-bundle.test.js
node scripts/review-bundle-manifest.js --check
npm test
npm run test:review-bundle
bash scripts/sync-harness.sh --check
git diff --check
```

The existing CI runs npm test and the real bundle installation suite separately. No standalone formatter/lint command is configured; build:ts is part of npm test. Independent review, QA and actual CI closure precede an upstream-only merge; no unrelated repository merge is authorized.

## Open Questions

None. Existing already-adopted shared package scopes remain preserved by lifecycle policy; this repair stops imposing new scopes, it does not infer authority to remove a consumer's existing scope. Old failed trial installations are recovered from their known before snapshot rather than silently omitting a managed file.
