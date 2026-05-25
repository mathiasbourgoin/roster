# Changelog

All notable changes to this project will be documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/).

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
