# Changelog

All notable changes to this project will be documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **Friction-log `classes` field + closed vocabulary** (P2) — `schema/skill-schema.md` documents
  15 classes distilled from 354 real friction strings across two independent corpora, each named
  by its *remedy*. `other` is legal but requires a `class_note`, so a stale vocabulary shows up
  as a rising rate rather than as silent misclassification.
- **`check-friction-shape --log <path> [--since <date>]`** — validates a real
  `skills-meta/friction.jsonl` against the entry schema and the closed vocabulary. The vocabulary
  is *parsed from the schema doc*, not duplicated in the checker, so the two cannot drift;
  removing the enum line makes the checker throw rather than accept everything (mutation-tested).
  `--since` gates new entries without a retroactive re-classification of historical ones.
  Wired into `npm test`.
- **`roster-skill-health` §2.5 recurrence check** (P2) — clusters key on `classes`; a class with a
  prior *shipped* proposal is marked `CLASS-NOT-CLOSED` and may not be answered with another
  instance fix. `CLOSURE-PENDING` covers approved-but-unshipped. `CLASS-NOT-CLOSED` has no
  threshold. Proposals now carry a greppable `class:` line.
- **`skipped` field** on friction entries — mandated steps a phase did not perform,
  `"<step>: <reason>"`.
- **Phase-exit coverage check** in `roster-ship` (P1) — compares ledger phases against friction
  entries for the task slug and requires missing entries to be backfilled *and marked as
  reconstructed*.

### Changed

- **Friction entries are written at phase exit, not session end** (P1) — stated in
  `skills/shared/preamble-friction.md` (the single inherited contract) and echoed in the pointer
  line of all 18 friction-log skills. A log written once, late, from memory keeps the narrative
  and loses the corrections.
- **`roster-review`: a review is not a review unless it executed** (P4) — specialists build the
  branch and run the gates themselves (detail in `agents/testing/reviewer.md` and
  `architect.md`); every mechanical step that did not run records `skipped` with a reason, in
  both the invocation trace and the Friction Log.
- **`roster-review.md` word budget 4000 → 4340** (FR-120 justification) — P4's two contract
  rules, after pushing the execution detail down to the agent definitions and compressing twice.

### Fixed

- **The convergence gate accepted a `skipped` trace line as attestation of a claimed specialist
  run.** `specialists_run` now requires `outcome: "ran"`; a skip record can no longer launder an
  unperformed step. Without this, P4's skip rule would have been an easier way to pass the gate
  than running the specialist.
- **`FR-120` budget test hardcoded 4001 words**, so it stopped testing anything the moment the
  budget was raised. Now derived from `BUDGETS`.

---

## [1.2.0] — 2026-06-03

### Added

- **`bin` entry + npx-from-git install** — `npx github:mathiasbourgoin/roster` runs the installer.
- **`check:pipeline-install`** guard (wired into `npm test`): recruiter install-list ↔ disk,
  Codex agent-TOML schema, plugin manifests, durable-state `LEDGER_SCHEMA` run/doctor identity,
  and that `install.sh` installs the rendered recruit skill/command (`name: recruit`).
- ~~**`bench:quality-cost:test`** added to the test chain.~~ _(Note: benchmark wiring was moved to wip/benchmarks and not released in 1.2.0.)_

### Fixed

- `sync-harness.sh` `strip_frontmatter` now preserves body `---` rules in all projections.
- `install.sh` installs the rendered recruit projection (`name: recruit`) for every runtime
  instead of the raw agent (`name: recruiter`); OpenCode now gets a discoverable SKILL.md.

---

## [1.1.0] — 2026-05-25

### Added

- **Three-mode pipeline routing** (`roster-run` v1.5.0): Express (impl→review→ship), Fast (+qa+KB update), Full (9-phase). Reduces overhead for small tasks.
- **Mode-aware review** (`roster-review` v1.3.0): specialist invocation scaled to mode; escalation detection flags `escalation_needed` without blocking GO.
- **Mode propagation** (`roster-implement` v1.4.0): `mode:` field in impl brief flows through to review and qa.
- **Express QA skip** (`roster-qa` v1.2.0): Express mode skips QA entirely and ships directly after review GO.
- **Real hook executor** (`scripts/run-hook.ts`): `run:`, `test:`, `timeout:`, `retry:` steps are now executed as real shell commands with `AbortController` timeouts and exit-code semantics. Exit-code protocol: 0=pass, 1=abort, 2=warn, 3=pending, 4=skip. 18 tests wired into `npm test`.
- **Skill-level hook system** with declarative DSL: pre/post hooks auto-discovered from `.harness/hooks/skills/<name>/`. Full reference in `docs/hooks.md`.
- **docs/hooks.md §11**: exit-code protocol table for hook executor — exit 1 is the only code that blocks dispatch.
- **docs/skill-overlap.md**: disambiguation guide for audit/spec/research skill families.
- **`overlay: personal` frontmatter**: personal-overlay agents now carry this flag; recruiter skips them by default during team assembly.

### Changed

- **Agent catalog** (27→26): `error-coordinator` merged into `expert-debugger` v1.4.0 (CI correlation scope added). `architect` reclassified from management to testing (conditional specialist). `context-manager` moved to specialist (opt-in for chains >5 agents).
- **Skill catalog** (33→30): `team-build` + `team-review` + `team-run` merged into `team` (mode arg: build|review|run). `improvement-loop-planner` moved to workflow/, documented as pair with `improvement-loop`. `kb-reindex` and `kb-search` marked experimental (require LanceDB).
- **`improvement-loop`** v1.1.0 and **`improvement-loop-planner`** v1.1.0: full frontmatter, pair notes, `## When to Go Back` / `## What Next` sections.
- **README**: platform constraint ("agents cannot spawn agents") reframed as architectural reality, not a feature. "In Production" section added.
- **Personal overlay agents** excluded from recruiter default search via `overlay: personal` + recruiter filter rule.

### Removed

- `agents/management/error-coordinator.md` (merged into expert-debugger)
- `skills/management/team-build.md`, `team-review.md`, `team-run.md` (merged into `team`)
- `index.json` removed from git tracking (now gitignored — rebuild with `npm run build:index`)
- `ocaml/` directory: extracted to `mathiasbourgoin/octez-agent-manager` and removed from history

### Migration notes

- **`index.json` is no longer committed.** Run `npm run build:index` after cloning or pulling.
- **`/team-build`, `/team-review`, `/team-run`** commands are replaced by `/team build`, `/team review`, `/team run <task>`.
- **`/improvement-loop-planner`** moved from `management/` to `workflow/` — Claude Code command path unchanged (`.claude/commands/improvement-loop-planner.md`).

---

## [1.0.0] — 2026-05-19

Initial public release.

- 27 agents across management, backend, testing, devops, security, specialist domains
- 33 skills covering the full roster pipeline
- Skill-level hook DSL (declarative, LLM-interpreted)
- `npm run check:hooks` linter
- `install.sh` harness initializer
- `scripts/sync-harness.sh` projection to Claude Code, Codex, OpenCode runtimes
