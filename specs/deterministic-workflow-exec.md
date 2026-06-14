---
name: deterministic-workflow-exec
type: spec
status: live
feature: Deterministic Workflow Execution
brief: briefs/deterministic-workflow-exec-intake.md
date: 2026-06-13
version: 1.0.0
---

# Spec — Deterministic Workflow Execution

## Clarifications

| Q | A |
|---|---|
| Does `cwr transpile` exist in cabal-workflow-runner? | The subcommand is named `to-claude-workflow`, not `transpile`. CWR has 6 subcommands: `lint`, `validate`, `run`, `replay`, `schema`, `to-claude-workflow`. `cwr to-claude-workflow <file>` compiles CWR JSON → Claude Workflow JavaScript (stdout), compilation notes to stderr. Dispatch has three branches: (1) `cwr` available → `cwr run` (CWR executes agents directly); (2) `cwr` available AND Claude Code Workflow tool is the target runtime → `cwr to-claude-workflow` → Workflow tool; (3) `cwr` absent → manual skill chain. |
| When is roster-workflow-build triggered? | Automatically by roster-run after plan COMPLETED (detected by presence of validated `briefs/<task>-plan.json`), if `workflows/<task>.cwr.json` is absent. Not a manually invoked step. |
| Dispatch priority: CWR vs Claude Code runtime? | `command -v cwr` exits 0: default → `cwr run` (direct CWR execution); alternative when Claude Code Workflow tool is the target runtime → `cwr to-claude-workflow <file>` (outputs JS to stdout, pipe to Workflow tool). `cwr` absent → manual chain. |
| Permanent artifacts vs gitignored default — contradiction? | Reconciled: **default is gitignored** (privacy gate opt-in). After the user explicitly commits (Gate 1 or Gate 2), the committed file IS a permanent artifact. `workflows/templates/` is always committed. `workflows/<task>.cwr.json` instances are gitignored by default; the privacy gate is the mechanism for making them permanent. |
| What is "plan COMPLETED" as a detectable state? | Presence of `briefs/<task>-plan.json` with a valid `schema_version` field. The plan.json is only written on VALIDATED (same gate as plan.md). |
| What happens if `cwr run` exits non-zero? | Exit 2 = Blocked/Aborted (CWR spec); exit 1 = validation/config error. All non-zero exits report failure and do not route to implement. |
| Does the manual fallback chain read plan.json? | No. The manual skill chain uses existing routing behavior (Markdown brief + ledger state). plan.json is consumed only by roster-workflow-build. |
| What is Gate 1's default when user presses Enter? | No default. The gate requires an explicit selection. AskUserQuestion with no pre-selected option. |
| Does "execution-only" temp file survive process crashes? | If roster-workflow-build crashes after writing the temp file, the orphaned file is treated as absent by roster-run's absence check (roster-run checks for committed or local-only presence, not temp files). roster-workflow-build should write to a `.tmp` suffixed path and rename on confirmed execution-only selection. |
| What is the [WORKFLOW] diff algorithm? | Normalized structural diff: compare steps by (position, id, skill). Ignore prompt content differences. Two instances share the same diff if they have identical structural modifications at the same positions relative to the source template. |
| Can roster-skill-evolve write to workflows/templates/ autonomously? | No. Human gate: both (before AND after). The skill produces a unified diff for human review; it never applies a patch without explicit per-proposal approval. |
| Is the mode set for templates closed? | Yes, in Phase 1: express, fast, full, critical. No custom mode templates. |
| How are missing quality gates represented in plan.json? | Empty string `""`. The key is always present; omission is not allowed. Example: `"lint": ""` means no lint gate configured. |

## User Stories

### US-1: roster-plan produces machine-readable JSON output (Priority: P0)

As a developer running the plan phase, I want `roster-plan` to produce `briefs/<task>-plan.json` alongside the existing Markdown brief, so that `roster-workflow-build` has a machine-readable, stable input.

**Why this priority**: Without the JSON output, roster-workflow-build has no machine-readable input and the entire deterministic execution chain cannot start.

**Scope**: This story does NOT cover: replacing the Markdown brief; changing roster-plan's human gate behavior; changing the plan.md format; consuming plan.json from any skill other than roster-workflow-build.

**Independent Test**: After a plan-phase run for a full-mode task, assert `briefs/<task>-plan.json` exists, parses as JSON, and contains `task`, `mode`, `schema_version`, `steps`, `quality_gates` keys.

**Acceptance Scenarios**:
1. **Given** a full-mode task with 9 phases (question through ship) and roster-plan has produced a VALIDATED `briefs/my-task-plan.md`, **When** the plan phase completes, **Then** `briefs/my-task-plan.json` exists with `{"task":"my-task","mode":"full","schema_version":"1.0","steps":[...],"quality_gates":{...}}` and `steps` contains exactly 9 entries in pipeline order.
2. **Given** an express-mode task (3 phases: implement/review/ship), **When** plan VALIDATED, **Then** `briefs/my-task-plan.json` has `"mode":"express"` and `steps` array length 3, with `quality_gates.lint` equal to `""` if no lint command is configured.
3. **Given** the human rejects the plan at the human gate (requests revision), **Then** `briefs/<task>-plan.json` is NOT written until the revised plan is VALIDATED. No partial plan.json is produced.
4. **Given** roster-plan writes plan.json and the process is interrupted before rename completes, **Then** no corrupt `briefs/<task>-plan.json` exists — write is atomic (write to `briefs/<task>-plan.json.tmp`, rename on success).

### US-2: roster-workflow-build translates plan to CWR workflow (Priority: P0)

As a developer who has completed the plan phase, I want `roster-workflow-build` to read `briefs/<task>-plan.json` and the matching mode template to emit `workflows/<task>.cwr.json`, so that a deterministic CWR execution artifact exists before the implementation phase starts.

**Why this priority**: This is the core translation step — without it, the CWR dispatch path has no input.

**Scope**: This story does NOT cover: executing the workflow; choosing which runtime to use; the privacy gate (covered by US-4); versioning (covered by US-5). `roster-workflow-build` is `phase: null` and does NOT write to the pipeline state ledger.

**Independent Test**: Given plan.json for a full-mode task and `workflows/templates/full.cwr.json`, run roster-workflow-build and assert that `workflows/<task>.cwr.json` is valid JSON parseable by `cwr lint`.

**Acceptance Scenarios**:
1. **Given** `briefs/my-task-plan.json` with `"mode":"full"` and `workflows/templates/full.cwr.json` present, **When** roster-workflow-build runs, **Then** `workflows/my-task.cwr.json` is produced, `cwr lint workflows/my-task.cwr.json` exits 0, and the file contains CWR `agent` steps corresponding to the plan steps.
2. **Given** template `workflows/templates/express.cwr.json` at `_roster_version: "1.2.0"`, **When** workflow built, **Then** `workflows/my-task.cwr.json` contains `"_roster_template_version": "1.2.0"`.
3. **Given** `workflows/templates/full.cwr.json` is absent when plan.json specifies `"mode":"full"`, **Then** roster-workflow-build stops with: `⛔ Template not found: workflows/templates/full.cwr.json` and no workflow file is written.
4. **Given** plan.json has `"schema_version":"2.0"` (future version), **When** roster-workflow-build reads it, **Then** it stops with: `⛔ Unsupported plan.json schema_version: 2.0 (expected 1.0)` and no workflow file is written.

### US-3: roster-run dispatches to CWR or manual chain (Priority: P0)

As a developer, I want `roster-run` to automatically invoke `roster-workflow-build` if the workflow file is absent after plan COMPLETED, then dispatch to `cwr run` if the CWR CLI is available, otherwise fall through to the existing manual skill chain, so that the deterministic execution mode is used when possible without breaking existing workflows.

**Why this priority**: This is the integration point — the execution path that makes deterministic dispatch real.

**Scope**: This story does NOT cover: `cwr transpile` (not implemented in CWR v0.11.0); Codex/OpenCode workflow runners; batch-mode CWR execution; modifying the LEDGER_SCHEMA or phase sequences.

**Independent Test**: With CWR CLI absent, verify that a full-mode task proceeds through the manual skill chain identically to pre-feature behavior. With CWR CLI present, verify `cwr run` is invoked with the correct workflow path.

**Acceptance Scenarios**:
1. **Given** plan COMPLETED (`briefs/my-task-plan.json` valid, `briefs/my-task-plan.md` VALIDATED), `workflows/my-task.cwr.json` absent, **When** roster-run routes after plan, **Then** roster-workflow-build is invoked first; only after it completes does dispatch proceed.
2. **Given** `command -v cwr` exits 0 and `workflows/my-task.cwr.json` present, **When** roster-run dispatches, **Then** `TASK=my-task cwr run workflows/my-task.cwr.json` is executed; each phase invoked by CWR appends its event to `briefs/my-task-state.json` normally.
3. **Given** `command -v cwr` exits non-zero (CWR absent), **When** roster-run dispatches, **Then** the existing manual skill chain is used with no error message; behavior is identical to pre-feature roster-run.
4. **Given** `cwr run` exits 2 (Blocked/Aborted), **Then** roster-run reports: `✗ cwr run exited 2 (Blocked/Aborted) — pipeline halted. Inspect cwr output above.` and does NOT route to roster-implement.
5. **Given** task resumes at `plan COMPLETED` (from ledger) and `workflows/my-task.cwr.json` already present, **When** roster-run routes, **Then** roster-workflow-build is NOT re-invoked; dispatch proceeds directly to the existing workflow file.

### US-4: Privacy gate for workflow file commits (Priority: P0)

As a developer, I want explicit confirmation before any workflow file is committed to the repo, so that task context embedded in workflow files is never pushed to version history without my deliberate choice.

**Why this priority**: Workflow files contain task descriptions and plan steps that may be sensitive. Silent commits violate the principle that repo history changes are explicit actions.

**Scope**: Does NOT cover: CI/CD enforcement of non-commit decisions; gitignoring templates (templates are always committed); audit logging of gate decisions beyond the friction log.

**Independent Test**: Run roster-workflow-build in an interactive shell; assert that writing the workflow file blocks until the user selects one of the three Gate 1 options and no `git add` is issued without "commit" being chosen.

**Acceptance Scenarios**:
1. **Given** roster-workflow-build has written `workflows/my-task.cwr.json`, **When** Gate 1 fires, **Then** an `AskUserQuestion` prompt appears with three options (no default), and roster-run does NOT proceed until the user selects one.
2. **Given** Gate 1 user selects "commit", **Then** `git add workflows/my-task.cwr.json` is called and the file is staged; Gate 2 checks for changes after the run.
3. **Given** Gate 1 user selects "local-only", **Then** the file is written but not staged; roster-doctor warns if `workflows/*.cwr.json` is not in `.gitignore` (see US-7).
4. **Given** Gate 1 user selects "execution-only", **Then** file is written to a temp path and renamed for use; after dispatch completes (success or failure), the temp file is deleted; Gate 2 is skipped.
5. **Given** Gate 2 fires and `git diff --quiet HEAD -- workflows/my-task.cwr.json` exits 0 (no changes), **Then** Gate 2 is silently skipped — no redundant prompt.
6. **Given** Gate 2 user selects "commit (bumps version)", **Then** `_roster_version` is incremented by one patch level in the file before staging and committing.
7. **Given** running in a non-interactive context (no TTY), **When** Gate 1 fires, **Then** roster-workflow-build defaults to "execution-only" and logs: `[non-interactive: workflow execution-only — no commit]`.

### US-5: Workflow versioning (Priority: P1)

As a pipeline operator, I want workflow templates to carry a `_roster_version` semver field and instances to carry both `_roster_version` (starting at `1.0.0`, bumped on evolution) and `_roster_template_version` (the source template's version), so that template evolution and instance provenance are traceable.

**Why this priority**: Without version tracking, there is no way to detect template drift, generate meaningful [WORKFLOW] proposals in US-6, or audit which template a given workflow was built from.

**Scope**: Does NOT cover: migration tooling for instances built before versioning was introduced; enforcing version constraints in CI; the `_`-prefix convention becoming a CWR-native feature.

**Independent Test**: Assert that `cwr lint workflows/templates/full.cwr.json` exits 0 with the `_roster_version` field present (CWR tolerates `_`-prefixed unknown keys).

**Acceptance Scenarios**:
1. **Given** template `workflows/templates/full.cwr.json` with `"_roster_version": "1.0.0"`, **When** roster-workflow-build creates instance, **Then** instance has `"_roster_version": "1.0.0"` and `"_roster_template_version": "1.0.0"`.
2. **Given** instance `workflows/my-task.cwr.json` at `_roster_version: "1.0.0"` and roster-skill-evolve applies a [WORKFLOW] proposal that adds one step, **Then** the committed instance has `"_roster_version": "1.0.1"`.
3. **Given** template bumped from `"1.0.0"` to `"1.1.0"`, **When** roster-workflow-build is invoked for an existing task with an instance at `_roster_template_version: "1.0.0"`, **Then** warning is emitted: `⚠ Template updated since instance generated (1.0.0 → 1.1.0). Regenerate? [y/N]`. Answering N sets `"_roster_template_upgrade_dismissed": true` on the instance to suppress future warnings.
4. **Given** `cwr lint workflows/templates/express.cwr.json`, **Then** exits 0 — the `_roster_version` field does not break CWR validation.

### US-6: roster-skill-evolve [WORKFLOW] template proposals (Priority: P1)

As a skill evolution operator, I want `roster-skill-evolve` to diff workflow instances against their source templates and surface `[WORKFLOW]` proposals when ≥`min_entries_for_signal` instances share the same structural diff, so that well-tested manual workflow modifications can be promoted to the template.

**Why this priority**: Without this, manual improvements to generated workflows are siloed to individual tasks and never improve the template.

**Scope**: Does NOT cover: roster-skill-health generating [WORKFLOW] proposals from friction.jsonl (separate signal source); auto-applying template patches; diffing prompt content (only structural diffs — step positions, ids, skills).

**Independent Test**: Given 3 instances of `fast` mode all with an identical extra step inserted at position 2 vs their template, assert that after roster-skill-evolve runs, a `[WORKFLOW]` proposal appears in the health report for the `fast` template.

**Acceptance Scenarios**:
1. **Given** 3 fast-mode instances each with step `roster-implement` replaced by two steps (`roster-implement-part1`, `roster-implement-part2`) at the same position, **When** roster-skill-evolve reads workflows/ and computes diffs, **Then** a `[WORKFLOW]` proposal is generated showing the unified structural diff against `workflows/templates/fast.cwr.json`.
2. **Given** a [WORKFLOW] proposal is APPROVED by the human, **When** roster-skill-evolve applies it, **Then** `workflows/templates/fast.cwr.json._roster_version` is bumped (minor for step addition), `sync-harness.sh` is run, and the change is committed.
3. **Given** only 2 instances share the same diff (below `min_entries_for_signal` default of 3), **Then** no [WORKFLOW] proposal is generated (the signal is reported under "Weak signals" in the health report).
4. **Given** roster-skill-evolve encounters a [WORKFLOW] proposal for a template step that no longer exists in the current template (EC-11 case), **Then** the proposal is marked `[CONFLICT — template evolved; cannot apply cleanly]` and skipped.

### US-7: roster-doctor workflow health checks (Priority: P1)

As a user of roster-doctor, I want Section 1 to check that `workflows/templates/` exists and contains only valid-JSON `.cwr.json` files, and warn if workflow instances are not protected by a `.gitignore` pattern, so that the workflow infrastructure is healthy and accidental commits are prevented.

**Why this priority**: Without this check, misconfiguration (missing templates, ungitignored instances) produces cryptic runtime failures rather than a clear diagnostic.

**Scope**: Does NOT cover: CWR schema validation beyond JSON syntax (Phase 1 limitation, acknowledged); checking instance `_roster_version` consistency; enforcing gitignore in CI.

**Independent Test**: With `workflows/templates/` absent, run `roster-doctor` and assert the output contains `workflows/templates/: absent ✗`.

**Acceptance Scenarios**:
1. **Given** `workflows/templates/` directory absent, **When** roster-doctor Section 1 runs, **Then** output contains: `workflows/templates/: absent ✗` as a warning (not a READY/NOT-READY blocker — missing templates degrade but do not break the manual fallback).
2. **Given** `workflows/templates/full.cwr.json` contains syntactically invalid JSON, **When** Section 1 runs, **Then** output contains: `workflows/templates/full.cwr.json ✗ invalid JSON`.
3. **Given** `workflows/my-task.cwr.json` exists (an instance) but `.gitignore` contains no pattern matching `workflows/*.cwr.json`, **When** Section 1 runs, **Then** output contains: `⚠ WARN: workflow instances may not be gitignored — add 'workflows/*.cwr.json' to .gitignore (or 'workflows/!templates/*.cwr.json' to preserve templates)`.
4. **Given** `.gitignore` has `workflows/*.cwr.json` AND `!workflows/templates/*.cwr.json` (correct negation pattern), **When** Section 1 runs for an existing instance, **Then** no gitignore warning is emitted.

---

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | `task` field format undefined | Same slug convention as briefs/ filename stem (kebab-case, ≤4 words). Same derivation rule as roster-question/roster-intake. |
| C-2 | US-1 | plan.json partial write on crash | Write atomically: `briefs/<task>-plan.json.tmp` → rename to `briefs/<task>-plan.json` on VALIDATED. Added to Scenario 4. |
| C-3 | US-1 | Missing quality gates (express) | Missing gates use empty string `""`. All three keys always present. |
| C-4 | US-1 | schema_version vs _roster_version confusion | `schema_version` = plan.json schema (owned by roster-plan, starts "1.0"). `_roster_version` = workflow instance version (owned by roster-workflow-build). Separate concerns. |
| C-5 | US-1/US-2 | `hook: boolean` undefined | `hook: true` = skill has a pre/post hook registered in `.harness/hooks/skills/<name>/`. roster-workflow-build embeds pre/post hook invocations in the CWR agent step prompt when hook: true. |
| C-6 | US-2 | Template path derivation implicit | Template path = `workflows/templates/<plan.json.mode>.cwr.json`. Explicit mapping; failure if file absent (Scenario 3). |
| C-7 | US-2 | Execution-only temp file orphaned on crash | Write to `<path>.tmp`, rename only after selection confirmed. Orphaned `.tmp` files are ignored by roster-run presence check. |
| C-8 | US-2/US-4 | Is Gate 1 blocking? | Yes — Gate 1 is synchronous. roster-run does not proceed to dispatch until Gate 1 resolves. |
| C-9 | US-2/US-4 | Local-only vs gitignore interaction | roster-workflow-build does not edit .gitignore dynamically. The install step (sync-harness.sh + .gitignore update) adds the pattern once. Doctor warns at runtime (US-7). |
| C-10 | US-3 | CWR exit codes beyond 0 and 2 | All non-zero exits treated as failure. `cwr run` docs: exit 2=Blocked/Aborted; exit 1=error. Both route to the same failure handler. |
| C-11 | US-3 | Manual chain reads plan.json? | No. Manual chain uses existing Markdown-brief + ledger routing. plan.json is roster-workflow-build's input only. |
| C-12 | US-3 | "Plan COMPLETED" detection | Presence of `briefs/<task>-plan.json` with valid `schema_version` field. On resume, also check that ledger `current_phase == "plan"` with `outcome: "COMPLETED"`. |
| C-13 | US-4 | "Unchanged" comparison baseline | `git diff --quiet HEAD -- workflows/<task>.cwr.json`. Against HEAD. |
| C-14 | US-4 | Gate 2 version bump ownership | roster-run inlines the `_roster_version` patch bump before staging. Patch increment only (1.0.0 → 1.0.1). |
| C-15 | US-4 | No Gate 1 default | Explicit selection required. Non-interactive fallback: execution-only (logged). |
| C-16 | US-5 | Version bump increment policy | Templates: minor bump for step added/removed, patch for content/wording. Instances: always patch bump (Gate 2 or evolve). |
| C-17 | US-5 | Repeated mismatch warning | Set `"_roster_template_upgrade_dismissed": true` in instance when user answers N. Suppresses repeat warnings. |
| C-18 | US-5 | CWR `_`-prefix convention durability | Accepted limitation. roster-doctor validates `_roster_*` fields are present and well-formed (syntax check only). CWR schema changes are outside roster's control. |
| C-19 | US-6 | min_entries_for_signal undefined | Reuses roster-skill-health tunable `min_entries_for_signal`, default 3. Same threshold applies to [WORKFLOW] proposals. |
| C-20 | US-6 | Diff algorithm underspecified | Normalized structural diff: compare by (position, id, skill). Ignore prompt content. Two instances share the same diff if structural modifications are position-identical. |
| C-21 | US-6 | sync-harness.sh invoked in interactive skill | Auto-invoked (same as [SKILL]/[ADAPT] handlers). Failure → template patch NOT applied; error reported to human. |
| C-22 | US-7 | Doctor checks only JSON syntax, not CWR schema | Acknowledged Phase 1 limitation. Documented in FR-031 and output contract. |
| C-23 | US-7 | Gitignore pattern ambiguity | Doctor checks for `workflows/*.cwr.json` pattern with `!workflows/templates/` negation. Both must be present, or warns. |
| C-24 | US-1/US-2 | steps[].inputs/outputs convention | Abstract artifact names (e.g. `"briefs/<task>-intake.md"`). roster-workflow-build uses them as context in the CWR agent step `prompt` field. |

---

## Functional Requirements

#### Plan JSON Output (US-1)

- **FR-001** [US-1]: `roster-plan` MUST write `briefs/<task>-plan.json` **only** when the plan reaches `VALIDATED` status (same gate as `briefs/<task>-plan.md`).
- **FR-002** [US-1]: `briefs/<task>-plan.json` MUST conform to the schema: `{ "task": string (kebab-case slug), "mode": "express"|"fast"|"full", "schema_version": "1.0", "steps": Step[], "quality_gates": { "build": string, "test": string, "lint": string } }` where `Step = { "id": string, "skill": string, "inputs": string[], "outputs": string[], "hook": boolean }`.
- **FR-003** [US-1]: `roster-plan` MUST write `briefs/<task>-plan.json` atomically (write to `briefs/<task>-plan.json.tmp`, rename on success).
- **FR-004** [US-1]: Missing quality gate commands MUST be represented as empty string `""` — never null or omitted.
- **FR-005** [US-1]: `steps[].hook` MUST be `true` if `.harness/hooks/skills/<step.skill>/pre.md` or `post.md` exists; `false` otherwise.

#### Workflow Build Skill (US-2)

- **FR-010** [US-2]: `roster-workflow-build` MUST have `phase: null` and MUST NOT write to `briefs/<task>-state.json`.
- **FR-011** [US-2]: `roster-workflow-build` MUST have `capability: workflow-builder` in its frontmatter.
- **FR-012** [US-2]: `roster-workflow-build` MUST stop with a clear error message if `briefs/<task>-plan.json` is absent or has an unsupported `schema_version`.
- **FR-013** [US-2]: `roster-workflow-build` MUST stop with a clear error message if `workflows/templates/<mode>.cwr.json` is absent.
- **FR-014** [US-2]: The generated `workflows/<task>.cwr.json` MUST pass `cwr lint workflows/<task>.cwr.json` (exit 0).
- **FR-015** [US-2]: The generated workflow MUST contain `"_roster_template_version"` matching the source template's `"_roster_version"`.
- **FR-016** [US-2]: For each plan step where `hook: true`, the CWR `agent` step's `prompt` MUST include instructions to invoke `TASK=<slug> node dist/scripts/run-hook.js pre <skill>` before the skill and `post <skill>` after.
- **FR-017** [US-2]: `roster-workflow-build` MUST check that the `check-skill-structure.js`-required sections are present in its own skill file (`## When to Go Back`, `## What Next`, `## Friction Log`). *(meta: this is enforced by CI on the skill file itself)*

#### Roster-Run Dispatch (US-3)

- **FR-020** [US-3]: After plan COMPLETED, `roster-run` MUST check for `workflows/<task>.cwr.json` presence. If absent, MUST invoke `roster-workflow-build` before dispatch.
- **FR-021** [US-3]: `roster-run` MUST detect CWR CLI via `command -v cwr`. If exit 0 AND `workflows/<task>.cwr.json` present, MUST execute `TASK=<slug> cwr run workflows/<task>.cwr.json`.
- **FR-022** [US-3]: If CWR CLI absent, `roster-run` MUST fall through to the manual skill chain with no error — identical to pre-feature behavior.
- **FR-023** [US-3]: If `cwr run` exits non-zero, `roster-run` MUST NOT route to `roster-implement`. MUST report the exit code and halt.
- **FR-024** [US-3]: On resume (ledger `current_phase: "plan"`, `outcome: "COMPLETED"`), `roster-run` MUST NOT re-invoke `roster-workflow-build` if `workflows/<task>.cwr.json` already present.
- **FR-025** [US-3]: The LEDGER_SCHEMA in `roster-run.md` MUST NOT be modified by this feature — `workflow-build` is `phase: null` and absent from all phase sequences.

#### Privacy Gate (US-4)

- **FR-030** [US-4]: `roster-workflow-build` MUST present `AskUserQuestion` with exactly three options (commit / local-only / execution-only) before completing, with no pre-selected default.
- **FR-031** [US-4]: Gate 1 MUST be synchronous — `roster-run` dispatch MUST NOT proceed until Gate 1 resolves.
- **FR-032** [US-4]: "commit" option MUST call `git add workflows/<task>.cwr.json`.
- **FR-033** [US-4]: "execution-only" option MUST write to a `.tmp` path, rename for use, and delete the file after dispatch (success or failure).
- **FR-034** [US-4]: In non-interactive context (no TTY), Gate 1 MUST default to "execution-only" and log `[non-interactive: workflow execution-only — no commit]`.
- **FR-035** [US-4]: Gate 2 MUST fire after a successful dispatch run unless: (a) Gate 1 was "execution-only" (no file), OR (b) `git diff --quiet HEAD -- workflows/<task>.cwr.json` exits 0 (no changes).
- **FR-036** [US-4]: Gate 2 "commit (bumps version)" MUST increment `_roster_version` by one patch level before staging.

#### Versioning (US-5)

- **FR-040** [US-5]: All files in `workflows/templates/` MUST contain `"_roster_version": "<semver>"` at the top level.
- **FR-041** [US-5]: All generated workflow instances MUST contain `"_roster_version": "1.0.0"` at creation and `"_roster_template_version": "<source template _roster_version>"`.
- **FR-042** [US-5]: When `roster-workflow-build` detects `_roster_template_version` in an existing instance differs from the current template's `_roster_version`, it MUST warn and ask for confirmation before regenerating. If user declines, MUST set `"_roster_template_upgrade_dismissed": true`.
- **FR-043** [US-5]: Template version bump policy: minor bump (x.Y.0) for step added or removed; patch bump (x.y.Z) for content/wording changes.

#### Skill Evolution [WORKFLOW] Proposals (US-6)

- **FR-050** [US-6]: `roster-skill-evolve` MUST read all `workflows/*.cwr.json` (non-template) instances and compute structural diffs against `workflows/templates/<mode>.cwr.json` (mode determined by `_roster_template_version` lookup).
- **FR-051** [US-6]: A `[WORKFLOW]` proposal MUST be generated only when ≥`min_entries_for_signal` instances share an identical structural diff against the same template.
- **FR-052** [US-6]: `roster-skill-evolve` MUST gate [WORKFLOW] proposals with `human_gate: both` — before and after each proposal application.
- **FR-053** [US-6]: If a [WORKFLOW] proposal cannot be applied cleanly (template evolved since diff was computed), `roster-skill-evolve` MUST mark it `[CONFLICT]` and skip it.
- **FR-054** [US-6]: After applying a [WORKFLOW] proposal, `roster-skill-evolve` MUST run `bash scripts/sync-harness.sh` and report failure if it exits non-zero.

#### Doctor Health Checks (US-7)

- **FR-060** [US-7]: `roster-doctor` Section 1 MUST check that `workflows/templates/` directory exists. Absence is a warning (not a READY/NOT-READY blocker).
- **FR-061** [US-7]: `roster-doctor` Section 1 MUST check that every `workflows/templates/*.cwr.json` file is syntactically valid JSON (`jq empty`). Invalid JSON is a warning.
- **FR-062** [US-7]: `roster-doctor` Section 1 MUST warn if any `workflows/*.cwr.json` (non-template instance) exists and `.gitignore` does not contain a pattern matching `workflows/*.cwr.json`.
- **FR-063** [US-7]: `roster-doctor` MUST NOT flag `workflows/templates/*.cwr.json` as ungitignored instances.

---

## Acceptance Criteria

- AC-1 [US-1, FR-001]: After roster-plan VALIDATED, `briefs/<task>-plan.json` exists. Before VALIDATED (or on rejection), it does not.
- AC-2 [US-1, FR-002]: `briefs/<task>-plan.json` parses as JSON and contains all required top-level keys with correct types.
- AC-3 [US-1, FR-003]: If roster-plan is killed between file write and rename, no `briefs/<task>-plan.json` is present (only `.tmp` which is ignorable).
- AC-4 [US-2, FR-014]: `cwr lint workflows/<task>.cwr.json` exits 0 for any workflow produced by roster-workflow-build.
- AC-5 [US-2, FR-015]: `workflows/<task>.cwr.json._roster_template_version` matches the source template's `_roster_version`.
- AC-6 [US-3, FR-021/FR-022]: With CWR installed and workflow present, roster-run calls `cwr run`. With CWR absent, roster-run uses manual chain.
- AC-7 [US-3, FR-023]: `cwr run` exit 1 or 2 → roster-run halts; implement is not invoked.
- AC-8 [US-3, FR-024]: Resume at `plan COMPLETED` with existing `workflows/<task>.cwr.json` → workflow-build not re-invoked.
- AC-9 [US-4, FR-030]: Gate 1 prompt blocks dispatch; no option is pre-selected.
- AC-10 [US-4, FR-033]: "execution-only" → temp file deleted after dispatch.
- AC-11 [US-4, FR-035]: Gate 2 skipped when no git diff or when execution-only.
- AC-12 [US-5, FR-040]: `cwr lint workflows/templates/express.cwr.json` exits 0.
- AC-13 [US-6, FR-051]: Fewer than 3 instances with same diff → no [WORKFLOW] proposal.
- AC-14 [US-7, FR-060]: `workflows/templates/` absent → doctor Section 1 output contains `workflows/templates/: absent ✗`.
- AC-15 [US-7, FR-062]: Ungitignored instance → doctor warns with gitignore remediation hint.

---

## Edge Cases

- EC-1 [US-1]: Concurrent roster-plan for same slug → second write overwrites first. Mitigation: same task slug = same task; this is a user error, not a race condition.
- EC-2 [US-2]: Mode template file present but malformed JSON → `cwr lint` exit non-zero caught in FR-014 check.
- EC-3 [US-2/US-3]: `cwr run` hangs indefinitely (network dependency) → no timeout specified in Phase 1; user must Ctrl-C. Future work: `--timeout-ms` flag on CWR invocation.
- EC-4 [US-3]: plan.json schema_version mismatch → FR-012 stops with clear error.
- EC-5 [US-3/US-4]: Detached HEAD when committing at Gate 1/Gate 2 → `git add` succeeds but commit is unreachable after rebase. Out of scope; standard git hygiene responsibility.
- EC-6 [US-4]: Non-interactive context → execution-only default per FR-034.
- EC-7 [US-4]: Dirty working tree when Gate 2 commits → `git add workflows/<task>.cwr.json` stages only the workflow file; other staged changes are not affected. `git commit` commits all staged files — this is a known limitation; document in the skill's When to Go Back.
- EC-8 [US-5]: instance references a template version that no longer exists → FR-042 fires mismatch warning; user should regenerate.
- EC-9 [US-6]: All instances deleted before evolve runs → empty instance set; no proposals, no error.
- EC-10 [US-6]: [WORKFLOW] proposal targets a step position that no longer exists in current template → FR-053 marks as `[CONFLICT]`.
- EC-11 [US-7]: `workflows/templates/full.cwr.json` has UTF-8 BOM → `jq empty` may reject; reported as invalid JSON (acceptable behavior).
- EC-12 [US-3]: `cwr run` exits 0 but a step had `on_failure: "continue"` and failed internally → roster-run reports success; the step failure is visible in cwr output but not caught by roster-run (Phase 1 limitation; future: parse cwr output for step-level failures).

---

## Runnable Checks

- CHECK-1 [AC-1]: `[ -f briefs/deterministic-workflow-exec-plan.json ]` → expected: exit 0 after plan VALIDATED
- CHECK-2 [AC-2]: `jq 'has("task") and has("mode") and has("schema_version") and has("steps") and has("quality_gates")' briefs/deterministic-workflow-exec-plan.json` → expected: `true`
- CHECK-3 [AC-4]: `cwr lint workflows/deterministic-workflow-exec.cwr.json` → expected: exit 0
- CHECK-4 [AC-5]: `jq -r '._roster_template_version' workflows/deterministic-workflow-exec.cwr.json` → expected: non-empty semver string
- CHECK-5 [AC-6/CWR absent]: `PATH="" command -v cwr; echo $?` = 1 → `npm test` passes; manual chain proceeds normally
- CHECK-6 [AC-7]: Mock `cwr run` to exit 2; roster-run output → expected: contains "Blocked/Aborted" and does NOT invoke roster-implement
- CHECK-7 [AC-9]: Gate 1 in interactive mode → `AskUserQuestion` called with 3 options; `git add` not called until "commit" selected
- CHECK-8 [AC-11]: `git diff --quiet HEAD -- workflows/<task>.cwr.json`; if exit 0 → Gate 2 skipped
- CHECK-9 [AC-12]: `cwr lint workflows/templates/express.cwr.json` → exit 0
- CHECK-10 [AC-14]: `rm -rf workflows/templates; node dist/scripts/roster-doctor.js full 2>&1 | grep "workflows/templates"` → expected: contains `absent ✗`
- CHECK-11 [AC-15]: Write `workflows/test.cwr.json`; remove gitignore entry; run roster-doctor → expected: contains `WARN` and gitignore remediation text

---

## Entities

- `CWRWorkflow`: A JSON file conforming to the cabal-workflow-runner schema, augmented with `_roster_*` metadata fields. Located at `workflows/<task>.cwr.json` (instances) or `workflows/templates/<mode>.cwr.json` (templates).
- `CWRStep`: A single unit of work within a `CWRWorkflow`. In roster templates, always `kind: "agent"` with a `prompt` describing the skill to invoke. May include pre/post hook invocation instructions.
- `WorkflowTemplate`: A `CWRWorkflow` file in `workflows/templates/` with `_roster_version` set, checked into the repo. One per pipeline mode (express/fast/full/critical).
- `WorkflowInstance`: A `CWRWorkflow` file in `workflows/<task>.cwr.json` generated by `roster-workflow-build` from a `WorkflowTemplate` and `PlanJSON`. Carries both `_roster_version` and `_roster_template_version`.
- `PlanJSON`: `briefs/<task>-plan.json`. Machine-readable projection of the Markdown plan produced by `roster-plan` on VALIDATED. Schema version `"1.0"`.
- `PrivacyGate`: An `AskUserQuestion` prompt in either `roster-workflow-build` (Gate 1) or `roster-run` (Gate 2) requiring explicit user consent before committing workflow files to the repo.
