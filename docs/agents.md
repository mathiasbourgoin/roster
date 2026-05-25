# Roster — Agent & Skill Reference

Full catalog of all agents, skills, rules, and hooks included in roster.

→ [Back to README](../README.md)

---

## Agents (22)

### Management (9)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tech-lead | 1.9.0 | opus | Orchestrates teams, enforces Ralph Loop with tiered evaluation |
| recruiter | 2.5.2 | opus | Finds and assembles agent teams from roster + external sources |
| harness-builder | 1.3.0 | opus | Assembles complete harness configs (agents + rules + hooks + skills + KB) |
| governor | — | opus | Generates rules via Socratic dialogue, enforces KB properties |
| kb-agent | 2.4.0 | opus | Bootstraps, maintains, and audits the knowledge base (kb/) |
| project-auditor | 1.1.0 | opus | Performs exhaustive repository audits and builds hierarchical kb/ |
| skill-creator | 1.4.0 | opus | Creates reusable skills from MCP servers, CLI tools, or ideas |
| architect | 1.5.0 | sonnet | Code quality guardian with built-in metric fallbacks + KB integration |
| context-manager | 1.3.0 | haiku | Maintains shared context document across multi-agent workflows |

### Backend (1)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| implementer | 1.3.0 | sonnet | Implements features/fixes in isolated worktrees |

### Testing (2)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| reviewer | 1.4.0 | opus | Structured code review with security focus |
| qa | 1.3.0 | haiku | Test verification + optional Playwright manual testing |

### DevOps (2)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tool-provisioner | 1.3.0 | sonnet | MCP/CLI discovery, evaluation, and provisioning |
| performance-monitor | 1.2.0 | sonnet | CI/test/app performance profiling |

### Security (2)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| mcp-vetter | 1.4.0 | sonnet | Security vetting of MCP server candidates |
| red-team-auditor | 1.1.0 | opus | Scoped security audits with proof-backed findings |

### Specialist (5)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| expert-debugger | 1.3.0 | opus | Escalation agent for hard diagnostic problems |
| config-migrator | 1.3.0 | sonnet | One-shot env→pydantic-settings migration (Python) |
| kernel-arm64-bringup | 1.2.0 | opus | Linux kernel and device bring-up for Qualcomm ARM64 handhelds |
| fex-wine-proton | 1.3.0 | opus | FEX, Wine, Proton, ThunksDB, and Steam runtime work on ARM64 |
| gamescope-mangohud-qam | 1.3.0 | opus | Gamescope, Mangohud, mangoapp, and Steam QAM bridge integration |

### Other (1)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| error-coordinator | 1.4.0 | sonnet | Correlates failures across CI/tests/agents |

---

## Skills (15)

Skills are slash-command workflows that run in the main context and produce contractual artifacts that chain across pipeline phases.

### Pipeline skills (`/roster-*`)

| Skill | Phase | What it does |
|-------|-------|--------------|
| `/roster-run` | Entry point | Detects context and routes to the right pipeline skill |
| `/roster-init` | Bootstrap | Adversarial project interview — 6 questions, 3 adversarial |
| `/roster-intake` | Intake | Turns a task into a contractual brief with human gate |
| `/roster-plan` | Plan | Dual-voice decomposition, consensus table |
| `/roster-implement` | Implement | TDD + improve loop + specialist sub-agents |
| `/roster-review` | Review | Fix-first review, GO/NO-GO JSON verdict |
| `/roster-qa` | QA | Deterministic quality gates, gated on review GO |
| `/roster-ship` | Ship | Rebase-merge, conventional commits, PR |
| `/roster-investigate` | Operational | Root-cause analysis, read-only, freeze scope |
| `/roster-audit` | Operational | Code quality + spec compliance combined report |
| `/roster-skill-health` | Meta | Friction log analysis → proposes new skills |

### Workflow skills

| Skill | Domain | Purpose |
|-------|--------|---------|
| `tdd-workflow` | testing | Red-green-refactor with auto language detection |
| `git-conventions` | workflow | Conventional commits, branch naming, PR templates |
| `improvement-loop-planner` | management | Propose bounded improvement loops |
| `improvement-loop` | workflow | Execute a bounded verification-first improvement loop |
| `roster-config` | workflow | Discover and set tunables across installed agents |

### KB skills

| Skill | Purpose |
|-------|---------|
| `kb-update` | Maintain KB after code changes, flag spec contradictions |
| `kb-migrate` | Audit, clean, reorg, and migrate KB to current schema |
| `kb-reindex` | Build or update LanceDB semantic search index |
| `kb-search` | Hybrid semantic+keyword search over the KB index |
| `ambiguity-auditor` | Scan KB for gaps, contradictions, vague language |
| `code-quality-auditor` | Check code against KB properties and naming |
| `spec-compliance-auditor` | Compare implementation against kb/spec.md |
| `harness-validator` | Meta-audit: is the harness coherent? |

---

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

---

## Profiles

Bootstrap profiles (used with `init-harness.sh`):

| Profile | Includes |
|---------|---------|
| `core` | tech-lead, recruiter, implementer |
| `developer` | core + reviewer, qa, architect, kb-agent |
| `security` | developer + mcp-vetter, red-team-auditor |
| `full` | security + all specialist agents |

---

## Recruiter Modes

The recruiter supports five modes:

1. **Initial team assembly** — diagnose project, score candidates, propose and install team
2. **Team audit and upgrade** — check installed team for stale agents, gaps, upgrade candidates
3. **Contextual recruitment** — add a specific agent for a specific need
4. **Agent creation** — scaffold a new agent from a description
5. **Governance setup** — install or update rules via the governor

---

## External Sources

The recruiter indexes these external registries (roster preferred first):

- `VoltAgent/awesome-claude-code-subagents`
- `VoltAgent/awesome-agent-skills`
- `wshobson/agents`
- `heilcheng/awesome-agent-skills`
- `msitarzewski/agency-agents`
- `mk-knight23/AGENTS-COLLECTION`

---

## Component Types & Schemas

| Type | Schema | Source location | Install target |
|------|--------|-----------------|---------------|
| Agent | `schema/agent-schema.md` | `agents/<domain>/` | `.harness/agents/` |
| Skill | `schema/skill-schema.md` | `skills/<domain>/` | `.harness/skills/` |
| Rule | `schema/rule-schema.md` | `rules/<category>/` | `.harness/rules/` |
| Hook | `schema/hook-schema.md` | `hooks/<category>/` | `.harness/hooks/` |
| KB | `schema/kb-schema.md` | `kb/` | `kb/` |

## Adding Components

1. Create file following the relevant schema
2. Run `npm run build:index`
3. Update `AGENTS.md`
4. Open a PR

Commit style: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
