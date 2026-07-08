# AGENTS.md — roster

## Project

A curated registry of reusable agent definitions, skills, rules, and hooks — paired with a harness builder that assembles shared project harnesses and a recruiter that finds optimal agent teams.

## Conventions

- **Commit convention:** conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- **Issue tracker:** GitHub
- **Branch strategy:** feature branches → PR → rebase-merge to main (**rebase-only**: squash and merge-commits are disabled on this repo)
- **Versioning:** semver on each component (`version:` frontmatter field)
  - Patch (x.x.+1): typo/wording, no behavioral change
  - Minor (x.+1.0): new capabilities, backward compatible
  - Major (+1.0.0): breaking changes (rewritten workflow, renamed tunables)

## Component Types

| Type | Schema | Location | Install target |
|------|--------|----------|---------------|
| Agent | `schema/agent-schema.md` | `agents/<domain>/` | `.harness/agents/` then project to `.opencode/agents/` or `.claude/agents/` |
| Skill | `schema/skill-schema.md` | `skills/<domain>/` | `.harness/skills/` then project to `.opencode/skills/` or `.claude/commands/` |
| Rule | `schema/rule-schema.md` | `rules/<category>/` | `.harness/rules/` then project to `.opencode/rules/` or `.claude/rules/` |
| Tool Hook | `schema/hook-schema.md` | `hooks/<category>/` | `.harness/hooks/` then project to runtime settings |
| Skill Hook | `schema/hook-schema.md` | `.harness/hooks/skills/<name>/` | project-local, auto-discovered by `roster-run` |
| KB | `schema/kb-schema.md` | `kb/` | `kb/` |
| Harness | `schema/harness-schema.md` | — | `.harness/harness.json` then project to `opencode.json` or `.claude/harness.json` |

## Shared Harness

- The canonical project harness lives under `.harness/`
- OpenCode compatibility is generated under `.opencode/`
- Claude compatibility is generated under `.claude/`
- Codex compatibility is generated under `.agents/skills/`
- The operational initializer is `./scripts/init-harness.sh <project-root> [profile]`
- The operational projection command is `./scripts/sync-harness.sh <project-root>`
- Agents manipulating installed project harness data should read `.harness/harness.json` first and treat `.opencode/`, `.claude/`, and `.agents/` as generated compatibility surfaces

## Agents (26)

### Management (9)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tech-lead | 1.9.1 | opus | Orchestrates agent teams, gates tool and skill requests, and owns merge/governance quality bars |
| recruiter | 2.7.0 | opus | Meta-agent that analyzes a project, searches agent sources (personal roster + public registries), and assembles or updates an optimal agent team |
| harness-builder | 1.3.0 | opus | Builds and audits shared project harnesses, then projects them to OpenCode, Claude, and Codex runtime surfaces |
| governor | 2.1.1 | opus | Generates .claude/rules/ via Socratic dialogue, enforces KB properties |
| kb-agent | 2.4.1 | sonnet | Bootstraps and maintains project knowledge bases as source-of-truth artifacts for specs, properties, and architecture |
| project-auditor | 1.1.0 | opus | Performs exhaustive project mapping and multi-slice audits, producing a hierarchical kb/ with components, invariants, risks, and fix candidates |
| skill-creator | 1.4.0 | opus | Designs reusable workflow skills from repeated patterns, with search-first and safety checks |
| planner | 1.2.0 | opus | Sub-agent behind `/roster-plan` — decomposes a validated brief into per-role sub-briefs with fresh context |
| pr-workflow | 1.2.0 | sonnet | Sub-agent behind `/roster-ship` — conventional commits, rebase merge, pre-push validation, and review rounds |

> **Note:** `recruiter` and `governor` source files live in `recruiter/` and `governor/` respectively (predates the `agents/<domain>/` convention). These directories are closed to new additions — all new agents go under `agents/<domain>/`. To add a new management agent, always use `agents/management/` — the `recruiter/` and `governor/` directories are legacy locations that cannot be changed without breaking the `install.sh` path references (which hardcode `recruiter/recruiter.md`).

> **Skill↔Agent pairs:** `planner` is invoked by `/roster-plan`; `pr-workflow` is invoked by `/roster-ship`. They are not standalone — always use the skill as the entry point.

### Backend (2)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| implementer | 1.3.0 | sonnet | Executes scoped feature/fix tasks in isolated worktrees with deterministic verification before handoff |
| ocaml-implementer | 1.2.0 | sonnet | Implements OCaml changes with eio_posix, Caqti, Result-style errors, and mandatory .mli discipline |

> **Note:** `ocaml-implementer` and `ocaml-dune-specialist` are OCaml/Dune specific. They are included in the default catalog as useful general patterns but require OCaml tooling.

### Testing (3)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| reviewer | 1.4.0 | opus | Performs structured code review focused on correctness, security, and regression risk |
| qa | 1.3.0 | haiku | Verifies implemented behavior through deterministic test execution and focused scenario checks |
| architect | 1.5.0 | sonnet | Code quality and architecture guardian — spawned by `reviewer` on medium/large blast radius diffs |

> **Note:** `architect` is a conditional specialist invoked by `/roster-review`, not a standalone agent. Do not invoke it directly — let the reviewer decide.

### DevOps (2)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tool-provisioner | 1.3.0 | sonnet | Discovers and proposes MCP/CLI tooling options with compatibility, safety, and operational fit checks |
| performance-monitor | 1.2.0 | sonnet | Profiles CI, tests, and runtime hotspots and proposes measurable optimizations |

### Security (2)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| mcp-vetter | 1.4.0 | sonnet | Security vetting for MCP server candidates with risk scoring and explicit approval recommendations |
| red-team-auditor | 1.1.0 | opus | Runs authorization-scoped security audits using slice-first mapping, invariant analysis, and evidence-backed proof plans |

### Specialist (5)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| expert-debugger | 1.4.0 | opus | Deep diagnosis for ambiguous failures — also handles CI failure correlation across agents and test suites |
| config-migrator | 1.3.0 | sonnet | Performs one-shot environment/config migrations with minimal scope and rollback awareness |
| migration-guard | 1.2.0 | sonnet | Owns SQLite schema migration discipline — version bumps, all_ddl alignment, migration-path tests, slot-drift avoidance |
| ocaml-dune-specialist | 1.2.0 | sonnet | Specialist for OCaml projects built with dune — .mli discipline, dune layout, opam metadata hygiene, ppx wiring |
| context-manager | 1.3.0 | haiku | Maintains shared context across long multi-agent sessions — install only when running chains > 5 agents |

### Personal Overlays (opt-in)
These agents carry `overlay: personal` frontmatter. They are domain-specific overlays for particular hardware/projects and are **excluded from recruiter's default search** — install manually when relevant:
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| kernel-arm64-bringup | 1.2.0 | opus | Linux bringup on Qualcomm Snapdragon ARM64 SoCs |
| fex-wine-proton | 1.3.0 | opus | x86-on-ARM emulation — FEX-emu, Proton 11 ARM64EC Wine |
| gamescope-mangohud-qam | 1.3.0 | opus | Compositor + perf-overlay + Steam-QAM-bridge on Adreno |

## Skills (37)

### Pipeline (18)
| Skill | Version | Purpose |
|-------|---------|---------|
| roster-run | 1.7.0 | Pipeline entry point — detects context and routes to the right skill |
| roster-init | 1.2.2 | Bootstrap a new project or onboard an existing project into the roster ecosystem |
| roster-intake | 1.1.1 | Intake phase — transforms a task into a contractual brief validated by the human |
| roster-spec | 2.0.2 | Adversarial spec phase — derives user stories with GWT scenarios, formalizes FR-NNN requirements |
| roster-plan | 1.3.2 | Dual-voice decomposition — reads the intake brief, produces per-role sub-briefs |
| roster-implement | 1.5.2 | Guided implementation — TDD, improve loop, sub-agents. Reads the plan, produces an impl brief |
| roster-review | 1.6.0 | Fix-first review with conditional specialists — produces a structured GO/NO-GO verdict |
| roster-qa | 1.3.2 | Deterministic QA — quality gates, tmux matrix if TUI, blocked on review NO-GO |
| roster-ship | 1.4.0 | Ship — conventional commits, rebase-merge, GitHub PR. Gated on review + QA go |
| roster-investigate | 1.3.0 | Root-cause investigation — analyzes a bug or unexpected behavior without modifying out-of-scope code |
| roster-audit | 1.3.0 | Quality and compliance audit — combines code-quality and spec-compliance into one actionable report |
| roster-doctor | 1.2.0 | Health check + pipeline pre-flight — verifies roster install integrity and that the project's dev environment is runnable before work starts |
| roster-question | 1.0.0 | Decompose a task into neutral research questions — blind research prep, task intent not revealed |
| roster-research | 1.2.2 | Blind documentarian research — reads questions only, produces file:line grounded research |
| roster-workflow-build | 1.0.1 | Translates a validated plan JSON into a CWR workflow file using the matching mode template |
| roster-triage-critical | 1.0.0 | Critical-route triage — property elicitation, priority ordering, backend proposal, cost disclosure |
| roster-spec-formal | 1.0.0 | Formal spec phase — extends roster-spec output with a Rocq (.v) or Quint (.qnt) formal spec artifact |
| roster-formal-verify | 1.0.0 | Formal verification gate — re-runs coqchk/.itf replay, emits evidence tier; replaces QA for --critical tasks |

### Meta (3)
| Skill | Version | Purpose |
|-------|---------|---------|
| roster-skill-health | 1.3.0 | Periodic friction analysis — proposes new skills, deterministic tools, and adaptations |
| roster-skill-evolve | 1.4.0 | Implements skill-health approved improvements — skills, tools, adaptations, agents |
| roster-upgrade | 0.1.0 | Propose-only self-upgrade for any roster-contract skill — two-gate CI check, maintainer-invoked only |

### KB/Audit (9)
| Skill | Version | Purpose |
|-------|---------|---------|
| kb-update | 1.1.1 | Update knowledge base — sync KB files with recent code changes without weakening specs |
| ambiguity-auditor | 1.0.1 | Audit KB for ambiguity — undefined terms, vague requirements, contradictions, stale content |
| code-quality-auditor | 1.0.2 | Audit code quality against KB-defined properties, invariants, and naming conventions |
| spec-compliance-auditor | 1.0.1 | Audit implementation against kb/spec.md — flag unimplemented spec items and behavioral divergence |
| harness-validator | 1.0.1 | Meta-auditor — validate the KB harness itself (structure, auditors, rules coherence, feedback loops) |
| roster-spec-infer | 1.0.1 | Reverse-engineer existing code into a structured, evidence-tiered inferred spec (specs/\<slug\>-inferred.md) |
| kb-migrate | 1.0.1 | Audit, clean, reorg, and migrate an existing KB to the current schema — idempotent, human-gated |
| kb-reindex | 1.0.0 | ⚠️ Experimental — requires LanceDB. Build or update a vector index over kb/ — opt-in, cold-start or incremental |
| kb-search | 1.0.0 | ⚠️ Experimental — requires LanceDB. Hybrid semantic+keyword search over the KB index |

### Workflow (6)
| Skill | Version | Purpose |
|-------|---------|---------|
| git-conventions | 1.0.1 | Apply git workflow conventions — commits, branches, PRs |
| improvement-loop | 1.1.1 | Run a bounded verification-first improvement loop from an approved loop spec |
| improvement-loop-planner | 1.2.0 | Propose bounded self-improvement loops from KB, code, tests, issues, and CI signals — pairs with improvement-loop |
| roster-config | 1.0.1 | Discover, inspect, and interactively set tunables across installed roster agents |
| team | 1.0.1 | Manage the installed agent team — `build` (apply proposal), `review` (audit gaps), `run <task>` (execute pipeline) |
| tdd-workflow | 1.0.1 | Run TDD cycle — write failing test, implement, refactor, verify coverage |

### Media (1, experimental)
| Skill | Version | Purpose |
|-------|---------|---------|
| image-generation | 1.0.2 | Generate or edit images via Codex CLI — with prompt refinement, vision validation, retry loop |

## Rules (6)

| Rule | Category | Scope |
|------|----------|-------|
| sycophancy | safety | global |
| escalation | safety | global |
| code-quality | style | global |
| context-budget | workflow | global |
| human-validation | governance | global |
| diagnostic-interview | governance | global |

## Hooks

Two distinct hook systems — do not conflate:

### Tool-level hooks (2)

Fire on runtime tool events (`PreToolUse` / `PostToolUse`). Shell commands only. Installed into `settings.json`.

| Hook | Event | Matcher |
|------|-------|---------|
| block-dangerous-commands | PreToolUse | Bash |
| post-edit-lint | PostToolUse | Edit\|Write |

### Skill-level hooks (DSL)

Fire before/after a named roster skill runs. Full declarative DSL. Defined in `.harness/hooks/skills/<skill-name>/pre.md` and `post.md`. Interpreted by the LLM agent — no separate process.

**Execution model:** `run-hook.ts` (CLI: `node dist/scripts/run-hook.js`) executes shell-level steps (`run:`, `test:`, `timeout:`, `retry:`, `log:`, `label:`, `goto:`) as real processes. Steps requiring LLM interpretation (`prompt:+agent:`, `loop:`, `parallel:`) are returned in `pending_llm_steps` for the agent to execute after the runner completes.

**Supported step types:** `run:` (shell) · `prompt:+agent:` (agentic) · `test:` (conditional) · `loop:` · `goto:+label:` · `retry:+backoff:` · `timeout:` (advisory) · `log:` · `include:` (build-time inlined) · `output:` · `parallel:` (prose-parallelism hint)

**Discovery:** `roster-run` auto-discovers `.harness/hooks/skills/<name>/pre.md` and `post.md` before/after every skill dispatch — zero config required.

**Linter:** `npm run check:hooks` validates hook file structure (included in `npm test`).

→ **[Full hooks tutorial and DSL reference](docs/hooks.md)**

## Pipeline Priority

Pipeline skills (`roster-*`) are the primary orchestration unit for task execution. The agent team (tech-lead, planner, implementer, etc.) operates in support/advisory mode. When both are installed, defer to the pipeline skill chain for task decomposition and review.

## Pipeline & Governance

The **harness builder** orchestrates complete harness assembly by coordinating:
- **Recruiter** → agent team
- **Governor** → rules
- **Tool provisioner** → MCP servers (vetted by **mcp-vetter**)
- **Skill creator** → skills
- **KB agent** → knowledge base

The **tech-lead** enforces the **Ralph Loop** during implementation:
1. Establish evaluation criteria (Tier 1: deterministic, Tier 2: LLM-assessed)
2. Implementer implements
3. Tier 1 checks (tests, build, lint, auditors) — non-negotiable
4. Tier 2 assessments (reviewer, architect) — grounded in Tier 1 outputs
5. QA validates → merge

No agent provisions tools or creates skills without tech-lead approval.

> **Platform constraint:** Claude Code and Codex support only *bounded, single-level* subagent delegation at runtime — a skill or lead can spawn specialist sub-agents (Claude via the Task tool; Codex via `.codex/agents/*.toml`, explicit and depth-limited, `agents.max_depth` default 1), but those sub-agents cannot spawn further, and neither runtime offers unbounded recursive spawning. Roster is designed around this depth limit: orchestration is one level deep per skill, and deeper multi-stage work is relayed through artifacts and human gates between sessions. This is not a feature — it is an architectural reality we work within.

When the installed harness changes, project-local agents should update canonical `.harness/` files first, then run `./scripts/sync-harness.sh <project-root>` to refresh Claude and Codex projections.

## Adding Components

Use the recruiter's Mode 4 (agent creation) or skill-creator for the full workflow. Manual:

1. Create file following the appropriate schema
2. Run `npm run build:index`
3. Update this file
4. Open a PR
