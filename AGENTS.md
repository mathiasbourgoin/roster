# AGENTS.md — agent-roster

## Project

A curated registry of reusable agent definitions, skills, rules, and hooks — paired with a harness builder that assembles shared project harnesses and a recruiter that finds optimal agent teams.

## Conventions

- **Commit convention:** conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
- **Issue tracker:** GitHub
- **Branch strategy:** feature branches → PR → merge to main
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
| Hook | `schema/hook-schema.md` | `hooks/<category>/` | `.harness/hooks/` then project to runtime settings |
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

## Agents (22)

### Management (9)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tech-lead | 1.3.0 | opus | Orchestrates teams, enforces Ralph Loop with tiered evaluation |
| recruiter | 2.2.0 | opus | Finds and assembles agent teams from roster + external sources |
| harness-builder | 1.0.0 | opus | Assembles complete harness configs (agents + rules + hooks + skills + KB) |
| governor | 2.0.0 | opus | Generates .claude/rules/ via Socratic dialogue, enforces KB properties |
| kb-agent | 2.0.0 | opus | Bootstraps, maintains, and audits the knowledge base (kb/) |
| project-auditor | 1.0.0 | opus | Performs exhaustive repository audits and builds hierarchical kb/ knowledge bases |
| skill-creator | 1.1.0 | opus | Creates reusable skills from MCP servers, CLI tools, or ideas |
| architect | 1.2.0 | sonnet | Code quality guardian with built-in metric fallbacks + KB integration |
| context-manager | 1.0.0 | haiku | Maintains shared context document across multi-agent workflows |

### Backend (1)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| implementer | 1.0.0 | sonnet | Implements features/fixes in isolated worktrees |

### Testing (2)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| reviewer | 1.1.0 | opus | Structured code review with security focus |
| qa | 1.0.0 | haiku | Test verification + optional Playwright manual testing |

### DevOps (2)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tool-provisioner | 1.1.0 | sonnet | MCP/CLI discovery, evaluation, and provisioning |
| performance-monitor | 1.0.0 | sonnet | CI/test/app performance profiling |

### Security (2)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| mcp-vetter | 1.1.0 | sonnet | Security vetting of MCP server candidates |
| red-team-auditor | 1.0.0 | opus | Runs scoped security audits with slice-first vulnerability research and proof-backed findings |

### Specialist (5)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| expert-debugger | 1.0.0 | opus | Escalation agent for hard diagnostic problems |
| config-migrator | 1.0.0 | sonnet | One-shot env→pydantic-settings migration (Python) |
| kernel-arm64-bringup | 1.0.0 | opus | Linux kernel and device bring-up for Qualcomm ARM64 handhelds |
| fex-wine-proton | 1.0.0 | opus | FEX, Wine, Proton, ThunksDB, and Steam runtime work on ARM64 |
| gamescope-mangohud-qam | 1.0.0 | opus | Gamescope, Mangohud, mangoapp, and Steam QAM bridge integration |

### Other (1)
| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| error-coordinator | 1.1.0 | sonnet | Correlates failures across CI/tests/agents |

## Skills (9)

| Skill | Domain | Purpose |
|-------|--------|---------|
| tdd-workflow | testing | Red-green-refactor with auto language detection |
| git-conventions | workflow | Conventional commits, branch naming, PR templates |
| kb-update | kb | Maintain KB after code changes, flag spec contradictions |
| ambiguity-auditor | kb/audit | Scan KB for gaps, contradictions, vague language |
| code-quality-auditor | kb/audit | Check code against KB properties and naming |
| spec-compliance-auditor | kb/audit | Compare implementation against kb/spec.md |
| harness-validator | kb/audit | Meta-audit: is the harness coherent? |
| improvement-loop-planner | management | Propose bounded improvement loops from KB, tests, issues, CI, and code signals |
| improvement-loop | workflow | Execute a bounded verification-first improvement loop from an approved spec |

## Rules (3)

| Rule | Category | Scope |
|------|----------|-------|
| sycophancy | safety | global |
| escalation | safety | global |
| code-quality | style | global |

## Hooks (2)

| Hook | Event | Matcher |
|------|-------|---------|
| block-dangerous-commands | PreToolUse | Bash |
| post-edit-lint | PostToolUse | Edit\|Write |

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

When the installed harness changes, project-local agents should update canonical `.harness/` files first, then run `./scripts/sync-harness.sh <project-root>` to refresh Claude and Codex projections.

## Adding Components

Use the recruiter's Mode 4 (agent creation) or skill-creator for the full workflow. Manual:

1. Create file following the appropriate schema
2. Run `npm run build:index`
3. Update this file
4. Open a PR
