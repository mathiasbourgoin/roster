# Changes

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
