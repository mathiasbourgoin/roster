# Intake Brief — spec-pipeline

**Date:** 2026-05-25T12:05:00+02:00
**Status:** VALIDATED

## Goal

Add a `roster-spec` pipeline phase between `roster-intake` and `roster-plan` that produces structured
contract files (`specs/<slug>.md`) containing behavioral descriptions and concrete runnable checks.
Specs are indexed by the KB indexer as a new `"spec"` component type, making them queryable by all
future pipeline runs. The phase auto-triggers on `feature`/`api-change` tasks (not a user-opt-in).

The key design principle (validated against adversarial review): `roster-spec` **enriches the intake
brief** with AC and checks in addition to writing `specs/<slug>.md`, so the planner's existing
brief-only input contract is not violated. The spec file exists as persistent institutional memory;
the brief carries the content for the current pipeline run.

Additionally: the reviewer's `no_go_reason` field is populated with structured metadata so tech-lead
can distinguish spec-level failures (→ re-plan) from code-level failures (→ re-implement). The
architect gains a cross-spec consistency mandate. The `improvement-loop-planner` (not the architect)
gets a "Tool Opportunities" section. README and AGENTS.md/docs/agents.md are updated.

## Scope Boundary

Out of scope:
- Semantic cross-spec contradiction detection (requires embeddings — deferred; only entity-name
  keyword consistency is in scope)
- Gherkin format (rejected in adversarial review — concrete runnable checks only)
- LanceDB/vector changes for specs (kb-reindex extension deferred)
- roster-spec `--amend` command (spec amendment workflow — follow-up)
- Any change to `agents/management/planner.md` (inline-paste agent, separate concern)
- Changing how `roster-implement` or the implementer agent work
- OCaml components

## Relevant Files

| File | Role | Key snippet |
|---|---|---|
| `skills/pipeline/roster-run.md:22` | Routing table — must add spec phase | `→ /roster-intake → /roster-plan` |
| `skills/pipeline/roster-plan.md:32–38` | Planner input contract | `artifacts.reads: [briefs/<task>-intake.md]` |
| `skills/pipeline/roster-review.md:145,176,201` | Review JSON schema + routing | `"no_go_reason": null` / `return to /roster-implement` |
| `skills/pipeline/roster-qa.md:49–51` | QA reads review.json + impl.md | no spec read currently |
| `scripts/lib/types.ts:1` | ComponentType union | `"agent" \| "skill" \| "rule" \| "hook" \| "kb" \| "other"` |
| `scripts/lib/infer.ts:16–38` | Path-prefix → type mapping | `if (normalized.startsWith("kb/")) return "kb"` |
| `scripts/build-index.ts:93` | Root dirs walked | `["agents","skills","rules","hooks","kb","recruiter","governor"]` |
| `skills/kb/spec-compliance-auditor.md` | Auditor to extend for per-feature specs | loads `kb/spec.md` only |
| `skills/kb/ambiguity-auditor.md` | Auditor to extend with cross-spec check | checks `kb/` files only |
| `skills/kb/harness-validator.md:22–28` | Required auditor list | hardcoded 4 auditors |
| `agents/management/architect.md` | Architect — add spec read | review input files |
| `skills/workflow/improvement-loop-planner.md` | Add Tool Opportunities section | improvement loop skill |
| `README.md` | Pipeline table — add roster-spec row | `The Pipeline` section |
| `AGENTS.md` | Skills count update | `## Skills (11)` |
| `docs/agents.md` | Skills table — add roster-spec | pipeline skills table |

## Architecture Notes

**Inter-phase data flow (from research Q1, Q8):**
Phases communicate exclusively via `briefs/<task>-*.md` files on the filesystem. `roster-plan` reads
`briefs/<task>-intake.md` as its single source of truth. The spec content must be appended as a new
section `## Acceptance Criteria & Checks` to the intake brief — this is the only way to pass it to
the planner without changing the planner's input contract.

**KB indexer extension (from research Q2, Q3):**
- `scripts/lib/types.ts` — add `"spec"` to the `ComponentType` union
- `scripts/lib/infer.ts:inferComponentType()` — add `if (normalized.startsWith("specs/")) return "spec"`
- `scripts/build-index.ts:93` — add `"specs"` to the `roots` array
- Spec files must have valid YAML frontmatter with `name:` field (required) or they are skipped

**Reviewer routing enrichment (from research Q7):**
The `no_go_reason` field exists in the JSON schema but is `null` in the template. Populate it with:
```json
"no_go_reason": {
  "type": "spec-ac-failure" | "code-plan-failure" | null,
  "failed_acs": ["AC description 1", "AC description 2"]
}
```
Tech-lead reads `type` field to decide: `spec-ac-failure` → re-plan, `code-plan-failure` → re-implement.
The reviewer does NOT route differently — it always returns to tech-lead. Tech-lead does the routing.

**Auditor extension pattern (from research Q6):**
All three auditors follow the same 3-step pattern (load KB → grep checks → write report). Extension is
manual: add a new step to the auditor's `.md` body. To wire into `roster-review`, add a row to the
conditional specialists table (`skills/pipeline/roster-review.md:80–88`).

**Spec file format:**
```yaml
---
name: <slug>
type: spec
status: live
feature: <feature name>
brief: briefs/<task>-intake.md
date: <ISO-8601>
version: 1.0.0
---
```
Body sections:
- `## Feature` — 1-paragraph plain-prose behavioral description
- `## Acceptance Criteria` — numbered list of `AC-N: [behavior] → expected outcome`
- `## Edge Cases` — error paths, auth boundaries, concurrency, limits
- `## Runnable Checks` — concrete shell/curl/pytest assertions the QA agent runs verbatim
- `## Entities` — key domain entities with their definitions (for cross-spec consistency)

**Trigger rule (baked into `roster-run.md` routing, not user-controlled):**
- `feature`, `api-change` → `roster-spec` mandatory between intake and plan
- `fix`, `chore`, `docs`, `refactor` → skip `roster-spec`
- Detection: read `type:` field from `briefs/<task>-intake.md` frontmatter

**Cross-spec entity consistency (extends `ambiguity-auditor`):**
New step in `ambiguity-auditor`: collect all `## Entities` sections from `specs/*.md`, detect same
entity name defined differently across files, flag as CRITICAL. Entity-name grep is sufficient (no
vector search needed for this scope). New step also wired into `roster-spec` itself at write time:
before finalizing the spec, grep existing `specs/*.md` for overlapping entity names and compare
definitions.

**Architect cross-spec mandate:**
Add to `agents/management/architect.md` artifacts.reads: `specs/<slug>.md (if present)`. Add to
review workflow: before flagging a design issue, check if the spec defines the expected behavior.

**Tool Opportunities in improvement-loop-planner:**
Add a mandatory `## Tool Opportunities` output section to `skills/workflow/improvement-loop-planner.md`.
Format: `[TOOL] <description> — <pattern it replaces>`. This keeps tool opportunity surfacing in the
improvement loop where it belongs, not in every diff review.

## Quality Gates

```bash
# Tests (also validates agent/skill structure)
npm test

# Shellcheck (if modifying any .sh files)
shellcheck scripts/install.sh scripts/test-install.sh

# Verify spec type appears in index after adding to indexer
npm run build:index && grep '"component_type":"spec"' index.json | head -3

# Verify new skill passes structure checks (npm test runs this)
# Skills with phase: must have ## When to Go Back and ## What Next
```

## Acceptance Criteria & Checks

**AC-1:** `skills/pipeline/roster-spec.md` exists with valid frontmatter (`name:`, `phase: spec`,
`pipeline_role`, `artifacts`) and body including `## When to Go Back` and `## What Next`.

**AC-2:** `scripts/lib/types.ts` `ComponentType` includes `"spec"`. `scripts/lib/infer.ts` maps
`specs/` prefix to `"spec"`. `scripts/build-index.ts` roots array includes `"specs"`.

**AC-3:** After creating a `specs/test-spec.md` with valid frontmatter and running `npm run build:index`,
`index.json` contains an entry with `"component_type":"spec"`.

**AC-4:** `briefs/<task>-intake.md` produced after `roster-spec` runs contains a
`## Acceptance Criteria & Checks` section with at least one `AC-N:` item and one runnable check.

**AC-5:** `skills/pipeline/roster-review.md` `no_go_reason` template field is structured JSON
(not `null`), with `type` and `failed_acs` sub-fields documented.

**AC-6:** `skills/pipeline/roster-review.md` conditional specialists table contains a row for
`spec-compliance (per-feature)` wired to `specs/<slug>.md`.

**AC-7:** `skills/pipeline/roster-qa.md` reads `specs/<slug>.md` if present and uses its
`## Runnable Checks` section as its primary verification checklist.

**AC-8:** `skills/kb/ambiguity-auditor.md` contains a new step for cross-spec entity consistency
that greps `specs/*.md` for entity definitions and flags name conflicts.

**AC-9:** `skills/pipeline/roster-run.md` routing table maps `feature`/`api-change` task type to
`roster-spec` phase between intake and plan.

**AC-10:** `README.md` pipeline table includes a `roster-spec` row. `AGENTS.md` skills count
updated. `docs/agents.md` pipeline skills table includes roster-spec.

**AC-11:** `npm test` passes with 0 failures after all changes.

```bash
# AC-2 check
grep '"spec"' scripts/lib/types.ts
grep 'specs/' scripts/lib/infer.ts

# AC-3 check
echo '---\nname: test-spec\ntype: spec\nstatus: live\nfeature: test\n---\n# test' > specs/test-spec.md
npm run build:index && grep '"component_type":"spec"' index.json
rm specs/test-spec.md

# AC-11 check
npm test
```

## Open Questions

- [ ] Should `roster-spec` write to `specs/<slug>.md` and ALSO append `## Acceptance Criteria & Checks`
  to the existing `briefs/<task>-intake.md` (mutating a previous phase's artifact), or should it write
  a new `briefs/<task>-spec-enriched.md` that the planner reads instead? **Recommendation:** mutate
  the intake brief (append section) — this keeps the planner's single-file input contract simple and
  avoids creating a new brief file type that needs to be wired into roster-run routing.

- [ ] `roster-plan.md` currently invokes `ambiguity-auditor` if KB present. Should it also
  explicitly read `specs/<slug>.md` via a conditional, or is the brief enrichment (AC section in
  intake brief) sufficient for the planner? **Recommendation:** brief enrichment is sufficient; no
  change to roster-plan.md's explicit reads needed.

- [ ] `improvement-loop-planner.md` — does it currently have a defined output format that the Tool
  Opportunities section must fit into? Needs quick read before implementing.

## Design Amendment (post-approval, 2026-05-25T12:14)

`roster-spec` is not a single-agent file-writer. It is a **mini-pipeline** in itself, modeled after the same adversarial principles as `roster-init` and the dual-voice plan. The skill must:

1. **Research sub-agent** — reads the codebase areas referenced in the brief, existing `specs/*.md`, KB, and surfaces relevant prior art and constraints *before* any spec is written.

2. **Contradiction sub-agent** — challenges each requirement from the brief: finds unstated assumptions, missing edge cases, internal contradictions, and conflicts with existing specs. Anti-sycophantic: never validates a requirement just because it was stated.

3. **Adversarial questioning** — asks the user targeted questions (one at a time) where the two sub-agents disagree or where a requirement is ambiguous or risky. Does NOT ask questions that can be answered by reading the codebase.

4. **Cross-spec consistency check** — after draft spec is produced, runs entity-name grep against `specs/*.md` to surface conflicts before writing anything.

5. **Refusal gate** — if after questioning the spec remains too vague or contradictory, `roster-spec` bounces back to `roster-intake` with a precise list of what is missing.

6. **Spec production + brief enrichment** — only after adversarial process is complete.

This means `roster-spec` is closer in structure to `roster-plan` (dual-voice, consensus, human gate) than to a simple file-writing skill. The human gate happens after step 3 (questions resolved) and again before final write (step 6).
