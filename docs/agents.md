# Roster — Agent & Skill Reference

Full catalog of all agents, skills, rules, and hooks included in roster.

→ [Back to README](../README.md)

---

## Agents (27)

### Management (12)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tech-lead | 1.9.0 | opus | Orchestrates agent teams, gates tool and skill requests, and owns merge/governance quality bars |
| recruiter | 2.5.2 | opus | Meta-agent that analyzes a project, searches agent sources (personal roster + public registries), and assembles or updates an optimal agent team |
| harness-builder | 1.3.0 | opus | Builds and audits shared project harnesses, then projects them to OpenCode, Claude, and Codex runtime surfaces |
| governor | 2.1.0 | opus | Generates .claude/rules/ via Socratic dialogue, enforces KB properties |
| kb-agent | 2.4.0 | opus | Bootstraps and maintains project knowledge bases as source-of-truth artifacts for specs, properties, and architecture |
| project-auditor | 1.1.0 | opus | Performs exhaustive project mapping and multi-slice audits, producing a hierarchical kb/ with components, invariants, risks, and fix candidates |
| skill-creator | 1.4.0 | opus | Designs reusable workflow skills from repeated patterns, with search-first and safety checks |
| architect | 1.5.0 | sonnet | Code quality and architecture guardian focused on structural regressions, duplication, and maintainability risks |
| context-manager | 1.3.0 | haiku | Maintains concise shared context for multi-agent execution to reduce drift and duplication |
| planner | 1.2.0 | opus | Takes a validated research brief and decomposes it into compressed, verified sub-briefs for each execution agent |
| pr-workflow | 1.2.0 | sonnet | Owns the project PR/git workflow — conventional commits, rebase merge, pre-push validation, and review rounds |
| error-coordinator | 1.4.0 | sonnet | Correlates failures across CI, tests, and agents to isolate likely root causes quickly |

> **Note:** `recruiter` and `governor` source files live in `recruiter/` and `governor/` respectively (predates the `agents/<domain>/` convention). These directories are closed to new additions. To add a new management agent, always use `agents/management/` — the `recruiter/` and `governor/` directories are legacy locations that cannot be changed without breaking the `install.sh` path references (which hardcode `recruiter/recruiter.md`).

### Backend (2)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| implementer | 1.3.0 | sonnet | Executes scoped feature/fix tasks in isolated worktrees with deterministic verification before handoff |
| ocaml-implementer | 1.2.0 | sonnet | Implements OCaml changes with eio_posix, Caqti, Result-style errors, and mandatory .mli discipline |

> **Note:** `ocaml-implementer` and `ocaml-dune-specialist` are OCaml/Dune specific. They are included in the default catalog as useful general patterns but require OCaml tooling.

### Testing (2)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| reviewer | 1.4.0 | opus | Performs structured code review focused on correctness, security, and regression risk |
| qa | 1.3.0 | haiku | Verifies implemented behavior through deterministic test execution and focused scenario checks |

### DevOps (2)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| tool-provisioner | 1.3.0 | sonnet | MCP/CLI discovery, evaluation, and provisioning |
| performance-monitor | 1.2.0 | sonnet | CI/test/app performance profiling |

### Security (2)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| mcp-vetter | 1.4.0 | sonnet | Security vetting of MCP server candidates |
| red-team-auditor | 1.1.0 | opus | Runs scoped security audits with slice-first vulnerability research and proof-backed findings |

### Specialist (4)

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| expert-debugger | 1.3.0 | opus | Escalation agent for hard diagnostic problems |
| config-migrator | 1.3.0 | sonnet | One-shot env→pydantic-settings migration (Python) |
| migration-guard | 1.2.0 | sonnet | Guards incremental migrations — detects regressions between steps |
| ocaml-dune-specialist | 1.2.0 | sonnet | Specialist for OCaml/dune/.opam: .mli discipline, dune layout, ppx wiring, opam metadata |

### Personal Overlays (opt-in)

These agents are domain-specific overlays for particular hardware/projects. Install manually if relevant:

| Agent | Version | Model | Purpose |
|-------|---------|-------|---------|
| kernel-arm64-bringup | 1.2.0 | opus | Linux kernel and device bring-up for Qualcomm ARM64 handhelds |
| fex-wine-proton | 1.3.0 | opus | FEX, Wine, Proton, ThunksDB, and Steam runtime work on ARM64 |
| gamescope-mangohud-qam | 1.3.0 | opus | Gamescope, Mangohud, mangoapp, and Steam QAM bridge integration |

---

## Skills (33)

Skills are slash-command workflows that run in the main context and produce contractual artifacts that chain across pipeline phases.

### Pipeline skills (`/roster-*`)

| Skill | Phase | What it does |
|-------|-------|--------------|
| `/roster-run` | Entry point | Detects context and routes to the right pipeline skill |
| `/roster-init` | Bootstrap | Adversarial project interview — 6 questions, 3 adversarial |
| `/roster-question` | Question | Decomposes task into neutral research questions |
| `/roster-research` | Research | Blind documentarian research — file:line grounded, optional online scan |
| `/roster-intake` | Intake | Turns a task into a contractual brief with human gate |
| `/roster-spec` | Spec | Adversarial spec: user stories, challenges, structured AC, runnable checks |
| `/roster-plan` | Plan | Dual-voice decomposition, consensus table |
| `/roster-implement` | Implement | TDD + improve loop + specialist sub-agents |
| `/roster-review` | Review | Fix-first review, GO/NO-GO JSON verdict |
| `/roster-qa` | QA | Deterministic quality gates, gated on review GO |
| `/roster-ship` | Ship | Rebase-merge, conventional commits, PR |
| `/roster-investigate` | Operational | Root-cause analysis, read-only, freeze scope |
| `/roster-audit` | Operational | Code quality + spec compliance combined report |

### Meta skills

| Skill | Purpose |
|-------|---------|
| `roster-skill-health` | Friction log analysis → proposes new skills, tools, adaptations |
| `roster-skill-evolve` | Implements approved skill-health proposals |

### Workflow skills

| Skill | Domain | Purpose |
|-------|--------|---------|
| `tdd-workflow` | testing | Red-green-refactor with auto language detection |
| `git-conventions` | workflow | Conventional commits, branch naming, PR templates |
| `improvement-loop-planner` | management | Propose bounded improvement loops from KB, tests, issues, CI, and code signals |
| `improvement-loop` | workflow | Execute a bounded verification-first improvement loop |
| `roster-config` | workflow | Discover and set tunables across installed agents |
| `team-build` | management | Assemble and configure a multi-agent team from a spec |
| `team-review` | management | Run a structured review pass with a configured team |
| `team-run` | management | Orchestrate a full pipeline run with a configured team |

### Media skills (experimental)

| Skill | Purpose |
|-------|---------|
| `image-generation` | Generate or edit images via Codex CLI — with prompt refinement, vision validation, retry loop |

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
| `roster-spec-infer` | Infer a spec from existing code and tests when none exists |

---

## Rules (5)

| Rule | Category | Scope |
|------|----------|-------|
| sycophancy | safety | global |
| escalation | safety | global |
| code-quality | style | global |
| human-validation | governance | global |
| diagnostic-interview | governance | global |

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
