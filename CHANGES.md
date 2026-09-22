# Changes

## v2.7.0 — Code-Intel Packs, Review-Bundle Distribution, Convergence Hardening

Closes a changelog gap, not a code gap: this work (PRs #46-#70) was already reconciled into
`main` piecemeal by earlier ad hoc landing commits — verified by diffing `main` against `next`
across every canonical source directory (`skills/`, `rules/`, `agents/`, `hooks/`, `AGENTS.md`,
`kb/`, `scripts/`, `schema/`, `workflows/`, `specs/`, `docs/`): the only remaining difference is
`main`'s own `delivery-integrity-audit` feature, which `next` never had, plus one pre-existing
cosmetic whitespace diff in an unrelated historical report. What was missing was documentation:
none of PRs #46-#70 had a `CHANGES.md`/`CHANGELOG.md` entry until now.

### Code-Intel Packs (PR #46)

- A tier-list registry (`registry/code-intel.schema.json`) and shared resolver
  (`scripts/code-intel-resolve.js`) let `roster-init`/`recruit` discover optional research-tool
  packs and `roster-qa` gate on their KB envelope.
- `arch-index`, the first and so far only verified pack: a research-orientation provider
  (`extensions/arch-index/skills/arch-index-orient/orient.sh` + `arch-index-pack.js`) with a
  simple-path guard and bounded direct-path queries.
- A missing pack binary degrades that pack to advisory (its gate exits 3, its audit section is
  skipped) — it never blocks pipeline routing.

### Surgical Implementation Discipline (PR #47)

- `roster-implement` gained a deterministic out-of-scope-change gate
  (`scripts/check-scope-diff.sh`) and a manifest lifecycle for the files a task is allowed to
  touch.
- A new `enforce-file-manifest` PreToolUse freeze hook blocks edits outside the declared
  manifest at the tool layer, not just at review time.

### Skill-Health Batch (PR #48)

- P1-P6 corrective follow-up from a targeted skill-health review: validator fixes across the
  friction/health tooling surfaced by that review.

### Review Convergence and Hardening (PRs #49-#52)

Four successive rounds on the same mechanism — the review loop no longer converges on vibes:

- **Loop convergence** (#49): trust-boundary risk-based spec freeze, an invariant ratchet, and
  `scripts/check-review-convergence.js` as the mechanical gate `roster-run`'s verdict routing
  now calls before honoring any cached `review` verdict.
- **Fan-out convergence** (#50): two-strike + circuit-breaker + delta-selection bound the
  specialist fan-out inside a single review round.
- **Schema and slimming** (#51): a canonical, zero-dependency-validated review-finding schema
  (`schema/review-finding.schema.json`, `scripts/lib/review/finding-schema.js`), the H-05
  normalizer, and a cross-runtime helper that owns probe/state/validation/journal in one place.
  `roster-review` itself was slimmed to 2.0.0 under a word-budget ratchet in this round (it has
  grown again since, under the ratchet's ceiling, through the corrections that followed).
- **v2 corrections** (#52): a two-event round/cycle lifecycle, gate override-awareness, and
  journal-enforced transport — closing the same "claimed but didn't run" gap that motivated the
  security follow-up below. First real use of the minimal-freeze profile.

### Review-Bundle Distribution and Hardening (PRs #53, #58, #60)

- A manifest + generator + CI check (`scripts/review-bundle-manifest.js`) so a consumer project
  can install, upgrade, remove, and verify the review tooling as a portable, sha256-checked
  bundle, independent of the roster checkout (#53).
- A blocking preflight gate in `roster-doctor`: a missing or tampered bundle is `NOT-READY`,
  `stale-install`, with a recovery runbook — never a silent degrade (#53).
- Consumer-adoption hardening and manifest path validation, rejecting absolute/`..` escapes in
  the installer (#58, #60).

### Security Hardening Follow-Up (PRs #54-#57, #59)

A re-run adversarial pass against the review-bundle/leak-scan surface above found several
confirmed HIGHs, closed here:

- Shape- and entropy-aware secret classification in the leak scanner (#54, #57) — base64-payload
  and non-alphanumeric-boundary false positives fixed without losing true positives.
- Fail-closed handling of non-array findings with a statusless-HIGH default, and path-traversal
  containment plus green-phase tree-mutation detection in the review gate (#55, #56).
- Shell-injection neutralization in the trust-boundary and keyword heuristics (#59).

### QA-Loop Bounding and Reviewer-Invocation Traces (PRs #62, #63)

- `scripts/check-qa-convergence.js` bounds the review-GO → QA-NO-GO → implement loop with a
  round counter, a cap, and a `qa-not-converging` escalation that stops for a human decision
  instead of looping forever (`specs/qa-loop-bounding.md`, #62).
- Gate-enforced reviewer invocation traces (R-5 graduation, #63): a specialist's claimed run
  must carry `outcome: "ran"` — a `skipped` record can no longer launder an unperformed step.

### `scripts/lib/` Reorganization (PR #61)

Split into concern-based subdirectories (`review/`, `xruntime/`, `bundle/`, `catalog/`,
`hooks/`) to keep any one gate script under its line budget.

### Cost, Adoption, and Research Tooling (PRs #64-#67)

- `schema/cost-snapshot.schema.json` + a fail-closed `check-cost-shape` validator; an advisory
  ccusage cost section in `roster-doctor` and a ship-time cost snapshot; an advisory
  cost/friction correlation section in `roster-skill-health` (#64).
- `rtk` wired in as an optional, advisory adaptation (rules/doctor/skill-health) — never a
  dependency roster installs or configures (#65).
- `roster-research` gained an additive, graph-first-then-verify online research protocol
  (v1.4.0), and `arch-index-orient` became its research-orientation provider (#66).
- `roster-question`'s cost-attribution window closed, generator exploration forbidden (#67).

### Subtraction Test and Evidence Guards (PR #70)

A subtraction test (removing a claim should make its dependent check fail) plus the evidence
guards that using it surfaced.

### Pipeline Contract Fixes and Friction-Log Classes (PR #68 and earlier)

- A frontmatter/preamble consistency sweep across ~18 friction-log skills: `description` as
  identity, `when_to_use` as triggers, one inherited preamble fragment for the pipeline-state and
  friction-log contracts instead of 18 copies, duplicated constants given single owners.
- Thirteen audit-driven contract fixes (F1-F13): truthful CWR-template reachability in
  Express/Fast, `roster-qa` actually consuming the plan's `qa-scope.md`, `roster-skill-health`'s
  `[HOOK]` trigger keyed on real friction fields, specialist auditors aligned with
  `roster-review`'s JSON contract, and others of the same shape.
- **Friction-log `classes` field + closed vocabulary, phase-exit writing, and "a review is not a
  review unless it executed"** (PR #68) — see `CHANGELOG.md`'s `[2.7.0]` section for the
  detailed entries; folded into this release rather than repeated here.

## v2.6.2 — Bugfix

Shipped to the stable channel on 2026-06-05 (`recruiter/CHANGELOG.md` documents it under its own
`[2.7.0]` entry) and has been part of `main`'s history since — `main` is 93 commits past this tag
today. It never received a section in this file until now; documented retroactively so the
release history here matches `VERSION`/tags.

- **Installer no longer dies silently on a `curl | bash` install.** The recruiter-version read
  used `cat .../VERSION | tr ...` under `set -euo pipefail`; a missing `VERSION` made `cat` fail,
  `pipefail` propagated it, and `set -e` killed the installer before it printed anything. The
  read is now guarded with `|| true` (`scripts/install.sh`'s `resolve_version()`).

## v2.6.1 — Bugfixes

- **OpenCode skill projection aligned with the installer.** `sync-harness` emitted OpenCode skills
  to `.opencode/commands/` (a path OpenCode does not read as skills) while `install.sh` used
  `.opencode/skills/<name>/SKILL.md`. Both now use the native skills path; the recruiter-sync guard
  was updated (it had silently gone dead), and every skill/agent name→path-component site is now
  validated (`require_safe_name` / `reject_traversal`) against path traversal.
- **Fast/Express implement unblocked.** `roster-implement`'s input contract no longer hard-requires
  the `/roster-plan` sub-briefs in Express/Fast mode (which skip planning by design).

## v2.6.0 — Durable State, Install Hardening, Skill-Level Hooks

### Durable, Resumable Pipeline State

- Append-only per-task ledger `briefs/<task>-state.json`; every pipeline phase records one event
  on completion (via a shared preamble convention with pinned phase tokens + per-phase outcome vocab).
- `/roster-run` resumes from the ledger before per-mode routing (all modes), mode-scoped and
  verdict-aware; malformed or foreign ledgers stop rather than degrade to a stale resume.
- `/roster-doctor status [<task>]` renders the timeline read-only.
- One `LEDGER_SCHEMA` jq predicate validates the ledger identically in run + doctor, drift-guarded by CI.

### Install Hardening + Multi-Runtime

- Three install channels: Claude plugin marketplace, `npx`-from-git, and `curl | bash`.
- Installer checks prerequisites up front (`bash≥4`, curl/wget, jq/git warning).
- Recruiter installs the pipeline skills on first-run team assembly.
- `install.sh` installs the **rendered** recruit projection (`name: recruit`) for every runtime;
  OpenCode now gets a discoverable `SKILL.md` (native Agent Skills), which Codex and Copilot also read.
- `/roster-doctor` + dev-env readiness pre-flight halts a broken toolchain before implementation.

### Cross-Runtime Adversarial Review

- `/roster-review` and `/roster-qa` can shell out to a second runtime (Codex / OpenCode) to
  augment findings with an independent model, appended without rewriting the primary verdict.

### Skill-Level Hook System

A new declarative hook DSL for roster pipeline skills (distinct from the existing tool-level PreToolUse/PostToolUse hooks):

- `hooks/skills/<name>/pre.md` and `post.md` — hook files auto-discovered by `roster-run` before/after each skill dispatch
- Full DSL: `run:`, `prompt:+agent:`, `test:+on_true:/on_false:`, `label:`, `loop:/until:`, `goto:`, `timeout:`, `log:`, `retry:+backoff:`, `include:`, `output:`, `parallel:` step types
- `ABORT: <reason>` sentinel for pre-hooks that block skill execution
- `on_error: stop|warn|continue` per-step error handling
- `check-hook-structure.ts` linter (`npm run check:hooks`) — validates hook files with 12 error checks and 3 warning checks
- `docs/hooks.md` — 524-line reference document covering format, DSL, examples, linting, and reliability caveats
- `schema/hook-schema.md` updated to v1.1.0 with skill hook format section
- `scripts/sync-harness.sh` updated with `sync_skill_hooks()` — inlines `include:` fragments at build time
- `scripts/init-harness.sh` updated to create `hooks/skills/` and `hooks/shared/` directories

### Pre-Launch Cleanup

- **LICENSE** added (MIT, 2025)
- **Brand assets** updated — dark-mode variants for all brand assets (logo, wordmark, mark, app icon, favicons, brand board)
- **README** updated — adaptive dark/light logo, pipeline skills table, Pi ⚠️ untested note, hooks doc link
- **Translation** — all French text translated to English across skills, skills projections, and preamble
- **Personal artifacts removed** from git tracking: `briefs/`, `reports/`, `docs/plans/`, `docs/iterations/`, `.ta-state.json` state files, `.imagelog.json`, `test-image.png`
- **Projections regenerated** — all `.claude/commands/` and `.agents/skills/` projections synced from source (roster-run v1.2→1.3, roster-spec v1.0→2.0, roster-skill-health v1.1→1.2, roster-research v1.0→1.1, French cleared from Codex surface)
- **AGENTS.md** updated — correct agent count (22→27), all versions corrected, missing agents and skills added
- `package.json` version set to 1.0.0
- `harness-builder` source synced with its Claude projection (opencode added to compatible_with)
- `skills/shared/preamble.md` frontmatter added with version 1.0.0

## v2.5.0 — Skill-First Pipeline, Skill Metabolism, Roster Init

### Architecture Shift: Skills as Primary Orchestration Unit

The system now treats **skills** as the primary orchestration unit for multi-step development workflows. Agents remain directly accessible and complementary, but the preferred path for a complete design→ship cycle is the `roster-*` skill pipeline. Key differences from the agent pipeline:

- Skills run in the main context (no context boundary between phases)
- Artifacts chain explicitly: `intake.md → plan.md → impl.md → review.json → qa.md → PR`
- Human gates are built into each skill's `human_gate` frontmatter field
- The full pipeline is auditable from a single session

### New Skills — `roster-*` Pipeline

Twelve new skills implementing the full development pipeline:

- `roster-run` — Entry point: detects context (intake brief present? QA running? nothing?) and routes to the right skill
- `roster-init` — Bootstrap for greenfield projects and onboarding onto existing ones. Runs an adversarial interview (6 questions, 3 adversarial). Weak answers trigger a warning + brainstorming protocol before proceeding.
- `roster-intake` — Intake phase: transforms a task into a contractual brief (`briefs/<task>-intake.md`) with structured human gate
- `roster-plan` — Dual-voice decomposition: two adversarial sub-agents produce independent plans, reconciled into a consensus table (AGREE / DISAGREE / USER-CHALLENGE). USER-CHALLENGE is never auto-decided.
- `roster-implement` — TDD-first implementation with improve loop and OCaml sub-agents
- `roster-review` — Fix-first review with conditional specialists (referenced by path for multi-runtime compatibility). Produces `review.json` with GO/NO-GO verdict.
- `roster-qa` — Deterministic quality gates + tmux test matrix. Gated on review GO.
- `roster-ship` — Rebase-merge, conventional commits, PR. Hard-gated on review+QA GO.
- `roster-investigate` — Root-cause analysis: read-only, freezes scope, hypothesis-driven
- `roster-audit` — Combined code quality + spec compliance report with file:line citations
- `roster-skill-health` — Periodic friction log analysis (cold start: creates file + asks user about frictions). Clusters patterns and proposes [SKILL] / [TOOL] / [ADAPT] / [AGENT] actions.
- `roster-skill-evolve` — Implements approved skill-health proposals with gated execution

### Skill Metabolism

Skills log frictions to `skills-meta/friction.jsonl` (gitignored, project-local). The friction entry format records the skill name, timestamp, friction description, method used, and outcome. Over time, `roster-skill-health` clusters these into actionable proposals:

- `[SKILL]` — develop a new reusable skill
- `[TOOL]` — build a deterministic tool (example: fuzzer for red-team analysis workflows)
- `[ADAPT]` — tune an existing skill to local project patterns
- `[AGENT]` — create a new specialist sub-agent

Minimum threshold: `min_entries_for_signal` occurrences (default 3) per cluster before proposing action. This prevents noise from one-off frictions.

### Shared Preamble

All `preamble: true` pipeline skills inject `skills/shared/preamble.md` at projection time. The preamble encodes the project's core ethos: anti-sycophancy, completeness (deliver complete solutions), search-before-build, user sovereignty (escalate on ambiguity, never decide silently), and friction log instructions.

### Schema Extensions

- `schema/skill-schema.md` — new frontmatter fields: `name`, `friction_log`, `artifacts` (inputs/outputs), `human_gate`, `tunables`, `pipeline_role`
- `schema/harness-schema.md` — new `layers.metabolism` block: `friction_log` path, `health_schedule`, `last_health_run`, `completed_tasks`

### Recruiter Update (v2.4.0 → v2.5.0)

- Added v2.5.0 Update Notes proposing skill pipeline installation during `/recruit update`
- Added `### New Skill Discovery` section to Self-Update: compares locally installed skills against roster skill index and surfaces uninstalled `roster-*` skills with install prompt
- Skill install target: `.harness/skills/` (canonical), `.claude/commands/` (Claude), `.agents/skills/` (Codex)

### Tooling

- `scripts/sync-harness.sh` — now syncs `roster-*.md` from all `skills/*/` subdirectories into `.claude/commands/` and `.agents/skills/`; skips `skills/shared/` (preamble is injected, not a slash command)
- `.gitignore` — added `skills-meta/` exclusion
- `index.json` — rebuilt: 1512 entries (local=45, remote=1467). All 12 `roster-*` skills now appear as `component_type: skill, source: local`.

### Friction Log — Existing Skills

Added `## Friction Log` sections to pre-existing workflow skills:
- `skills/workflow/improvement-loop.md`
- `skills/workflow/git-conventions.md`
- `skills/testing/tdd-workflow.md`

## Unreleased

### Team-First Philosophy Reframe

The project purpose has shifted from "a registry of reusable agent components" to "a harness for fast and correct development with productive teams." Key consequences:

- **Agents are not personas.** They are context-focused workflow tools with defined input/output contracts and pipeline roles.
- **The team is the unit of value**, not the individual agent. Adding an agent requires patching the lead and adjacent agents — not just copying a file.
- **Lead is mandatory.** No team functions without a tech-lead. Recruiter enforces this before scoring any other candidates.
- **Agents cannot spawn subagents.** Hard platform constraint. The human (or orchestrating Claude) is always the spawning mechanism. Two execution modes: Mode A (full team launch) and Mode B (human-mediated sequential, default).
- **Human validation is load-bearing.** Every plan, brief, and team proposal requires a structured quiz before execution. Passive approval ("yes", "ok") is not sufficient.

### New Components

- `agents/management/planner.md` — new agent: takes a validated research brief (fresh context), decomposes it into sub-briefs per execution agent.
- `agents/management/project-auditor.md` — new agent: performs exhaustive repository audits and builds hierarchical `kb/` component knowledge bases with invariants, risks, tests, missing tests, and fix candidates.
- `agents/security/red-team-auditor.md` — new agent: runs authorized security audits and vulnerability research with project-adaptive slice mapping, invariant analysis, proof plans, and optional bounty novelty checks.
- `agents/specialist/kernel-arm64-bringup.md` — new specialist: owns Qualcomm ARM64 handheld kernel bring-up, device tree work, defconfig deltas, boot.img assembly, and on-device verification.
- `agents/specialist/fex-wine-proton.md` — new specialist: owns FEX, Wine/Proton ARM64, ThunksDB, x86_64 sysroots, and Steam runtime selection on ARM64.
- `agents/specialist/gamescope-mangohud-qam.md` — new specialist: owns Gamescope DRM sessions, Mangohud/mangoapp overlay wiring, and Steam QAM bridge spikes.
- `rules/governance/human-validation.md` — new rule: defines the mandatory human validation quiz protocol, trap question mechanics, and gating behavior.

### Tech-lead Updates (v1.5.0 → v1.6.0)

- Added Spawning Constraint section: explicit Mode A/B execution model, structured spawn request format.
- Added Research Phase section: research → compressed brief → context kill → planner handoff.
- Renamed Context Isolation → Context Packaging: reframed as active brief production, not passive filtering. Added brief quality criteria and "compress, do not truncate" rule.
- Batch Planning: now gates on human validation quiz before spawning agents.
- Output Contract: updated to reflect plan-to-file + quiz protocol.

### Recruiter Updates (v1.5.0 — in progress)

- Added clarification question step during project analysis (max 3–5 questions for gaps that can't be inferred).
- Added missing-`kb/` detection: initial team proposals now advertise `project-auditor` as the recommended first-run agent for exhaustive repository audit and KB bootstrap, with `kb-agent` as the maintenance follow-up.
- Added security-audit routing: team proposals and contextual recruitment now advertise `red-team-auditor` for authorized security audits, vulnerability research, threat-model follow-up, and bug bounty passes.
- Lead-mandatory rule added to scoring: no team proposal without a lead candidate.
- Scoring: added `no_pipeline_role_defined` penalty (-2pts).
- Team proposal now includes pipeline topology (communication graph) and execution model explanation.
- Install process now enforces three-layer model: tunables + pipeline integration patch + lead/adjacency updates.
- Added Execution Model section: Mode A/B, spawning constraint, human-as-relay.
- All modes (1–4) now gate on human validation quiz before writing to harness.

### Schema Updates

- `schema/agent-schema.md`: added `pipeline_role` optional field with `triggered_by`, `receives`, `produces`, `human_gate` subfields.

### KB Updates

Note: `kb/` is gitignored — KB files are project-local and not committed to the roster repo. The following changes are applied locally when the harness is initialized or updated.

- `kb/spec.md`: rewritten to reflect team-first purpose, execution model, and non-goals (no persona simulation).
- `kb/architecture.md`: added Team Orchestration Flow, Context Kill Points, Execution Model, Human Gates, and Recruiter Install Model sections.
- `kb/glossary.md`: expanded from 6 to 20+ terms covering team/pipeline/governance vocabulary.

### Shared Harness

- Added canonical shared harness support via `.harness/`
- Added runtime projection model instead of treating Claude files as the source of truth
- Added Claude projection into `.claude/...`
- Added Codex projection into `.agents/skills/...`

### Tooling

- Added `scripts/sync-harness.sh` to project shared harness files into runtime-specific layouts
- Added `scripts/init-harness.sh` to bootstrap a starter shared harness in a target project
- Added lightweight project detection in `init-harness.sh` for languages, frameworks, and CI
- Added TypeScript indexer workflow (`npm run build:index`) with deterministic source config in `index-sources.json`
- Added `scripts/build-index.sh` compatibility wrapper that delegates to the TS indexer
- Added cache-first indexer behavior with `--refresh-remotes` for explicit remote refresh
- Added source fingerprint reuse for fast refreshes when remote candidate sets are unchanged
- Added smart build runner (`scripts/run-build-index.js`) to compile TS only when needed
- Added bounded parallel remote fetch in index builds for faster cold refresh performance

### Schema And Prompt Changes

- Updated harness, skill, rule, and hook schemas to describe a shared canonical harness with runtime-specific projections
- Updated recruiter and harness-builder prompts to operate on `.harness/` first and treat runtime files as generated surfaces
- Updated recruiter discovery strategy to consume rebuilt `index.json` instead of ad-hoc remote crawling
- Updated recruiter tunables and instructions to use deterministic index build flow (`index_sources_file`, `index_build_command`)

### Upgrade Notes

- Existing Claude-only installs are still supported
- Shared-harness migration for legacy `.claude/...` installs is a transitional concern and should be surfaced during recruiter updates
