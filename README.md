# Agent Roster

A harness for fast and correct software development using coordinated agent teams.

The goal is not a prompt library. It is a system that enforces correct behavior at the team level: human validation gates before any plan executes, compressed context handoffs between agents, deterministic quality checks, and a clear execution model where humans remain the decision-makers.

Three principles:

- **Agents cannot spawn agents.** The human (or orchestrating Claude) is always the relay between pipeline stages. This is not a limitation — it is the human gate in practice.
- **The team is the unit, not the agent.** Adding an agent means wiring it into the pipeline: patching the lead, updating adjacent agents, and validating the integration.
- **Every plan needs a human who understood it.** Passive approval is not validation. A structured quiz runs before any execution batch begins.

The harness is the mechanism that enforces these properties across projects:

- canonical configuration in `.harness/`
- projected into runtime-specific surfaces for Claude Code and Codex
- assembled and updated via `/recruit`

## Quick Start

Install in any project:

```
/recruit
```

The recruiter assembles a minimal team and configures the harness. Default team (covers 80% of tasks):

| Agent | Role |
|-------|------|
| tech-lead | Orchestration, Ralph Loop, human gates |
| implementer | Code execution in isolated worktrees |
| reviewer | Structured review: correctness, security, regression |
| qa | Independent test verification |

Then: ask `tech-lead` to research and plan your first task.

## What This Repo Provides

- Agent definitions with defined pipeline roles (input/output contracts, human gate positions)
- Skills for workflows: TDD, KB maintenance, git conventions, bounded improvement loops
- Governance rules including the human validation protocol
- A harness model that installs once and projects into multiple runtimes

This repo is not a prompt dump. Components are designed to work as a team, not in isolation.

## Main Entry Point

`/recruit` remains the primary entrypoint.

Use it for:

- initial team assembly
- team audit and upgrade
- governance setup
- update flow

The `harness-builder` agent handles explicit harness assembly for advanced scenarios, but it is not the front door.

## Shared Harness Model

The canonical project harness lives under `.harness/`.

Recommended installed layout:

```text
project/
├── .harness/
│   ├── agents/
│   ├── skills/
│   ├── rules/
│   ├── hooks/
│   └── harness.json
├── .claude/
│   ├── agents/
│   ├── commands/
│   ├── rules/
│   ├── harness.json
│   └── settings.local.json
├── .agents/
│   └── skills/
└── AGENTS.md
```

Runtime rule:

- `.harness/` is canonical
- `.claude/` is a generated Claude compatibility surface
- `.agents/skills/` is a generated Codex compatibility surface
- `AGENTS.md` remains optional project instructions, not the canonical harness store

## Runtime Support

Current runtime projections:

- OpenCode:
  - `.opencode/agents/`
  - `.opencode/rules/`
  - `opencode.json` for configuration
- Claude Code:
  - `.claude/agents/`
  - `.claude/commands/`
  - `.claude/rules/`
  - `.claude/harness.json`
  - `.claude/settings.local.json` for hook projection
- Codex:
  - `.agents/skills/`

The data model is shared. Runtime surfaces are generated.

## Scripts

The repo includes three key scripts:

```bash
npm run build:index
./scripts/init-harness.sh /path/to/project [profile]
./scripts/sync-harness.sh /path/to/project
```

What they do:

- `build:index`: rebuilds `index.json` from local + configured remote sources
- `build:index -- --refresh-remotes`: refreshes remote snapshots before rebuilding
- `init-harness.sh`: bootstraps a starter `.harness/` tree in a target project
- `sync-harness.sh`: projects canonical `.harness/` content into Claude and Codex runtime files

## Installation

### How to install a harness in a project

For normal usage: yes, ask the recruiter.

1. Install the recruiter skill/agent in your project (Claude quick install below).
2. Run `/recruit`.
3. Approve the proposed team and harness setup.
4. Run `/recruit govern` if you want governance rules generated.
5. Run `/recruit update` over time to keep the setup current.

Use the scripts only if you are doing manual/advanced setup or working directly from a clone of this repo.

### OpenCode quick install

For OpenCode users:

```bash
mkdir -p .opencode/agents && curl -sL https://raw.githubusercontent.com/mathiasbourgoin/agent-roster/main/.opencode/agents/recruiter.md -o .opencode/agents/recruiter.md
```

Then in OpenCode:

```text
@recruiter help me set up an agent team for this project
```

The recruiter will analyze your project and propose an optimal agent team. You can also manually install individual agents:

```bash
# Install specific agents
curl -sL https://raw.githubusercontent.com/mathiasbourgoin/agent-roster/main/.opencode/agents/reviewer.md -o .opencode/agents/reviewer.md
curl -sL https://raw.githubusercontent.com/mathiasbourgoin/agent-roster/main/.opencode/agents/tech-lead.md -o .opencode/agents/tech-lead.md
```

**Model Configuration:** The agents use GitHub Copilot models by default (`github-copilot/claude-opus-4.5`, etc.). If you have direct Anthropic API access or use OpenCode Zen, create an `opencode.json` in your project to override:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "recruiter": {
      "model": "anthropic/claude-opus-4-20250514"
    }
  }
}
```

### Claude Code quick install

The current quick install path for Claude Code:

```bash
mkdir -p .claude/agents .claude/commands && curl -sL https://raw.githubusercontent.com/mathiasbourgoin/agent-roster/main/recruiter/recruiter.md | tee .claude/agents/recruiter.md .claude/commands/recruit.md > /dev/null
```

Then:

```text
/recruit
/recruit govern
/recruit update
```

### Shared harness bootstrap

If you are cloning this repo or using its scripts directly:

```bash
./scripts/init-harness.sh /path/to/project developer
```

This creates:

- `.harness/` canonical state
- `.claude/...` Claude projection
- `.agents/skills/...` Codex projection

If you edit canonical files later, re-project them with:

```bash
./scripts/sync-harness.sh /path/to/project
```

## Profiles

Supported bootstrap profiles:

- `core`
- `developer`
- `security`
- `full`

Profiles are additive. They determine which default agents, skills, rules, and hooks are copied into the initial shared harness.

## Key Components

### Agents

Current notable agents include:

- `recruiter` — main entrypoint for team assembly and upgrades
- `harness-builder` — assembles the full shared harness
- `tech-lead` — orchestrates execution and enforces the Ralph Loop
- `reviewer` — structured review with security focus
- `qa` — test verification
- `architect` — code quality and architecture checks
- `kb-agent` — KB bootstrap and maintenance
- `project-auditor` — exhaustive repository audit and hierarchical `kb/` generation
- `red-team-auditor` — scoped security audits, vulnerability research, and proof-backed findings
- `tool-provisioner` — tooling and MCP discovery
- `mcp-vetter` — MCP security vetting
- `kernel-arm64-bringup`, `fex-wine-proton`, `gamescope-mangohud-qam` — specialist pipeline for ARM64 handheld Linux/Steam bring-up

### Skills

Current notable skills include:

- `tdd-workflow`
- `git-conventions`
- `kb-update`
- `ambiguity-auditor`
- `code-quality-auditor`
- `spec-compliance-auditor`
- `harness-validator`
- `improvement-loop-planner`
- `improvement-loop`

### Improvement Loop Skills

The improvement-loop pair is a constrained take on autoresearch-style workflows:

- `improvement-loop-planner` discovers candidate bounded loops from KB, tests, CI, issues, and code signals
- `improvement-loop` executes an approved bounded loop with explicit scope, metric, verify command, guard command, and keep/discard rules

These are intentionally verification-first and bounded. They are not open-ended “run forever” autonomy tools.

## Recruiter Modes

The recruiter currently supports five conceptual modes:

1. Initial team assembly
2. Team audit and upgrade
3. Contextual recruitment
4. Agent creation
5. Governance setup

The recruiter is also responsible for update behavior. In the shared harness model, update should:

1. read the installed shared manifest
2. compare versions against the roster
3. update canonical `.harness/` content
4. regenerate runtime projections
5. preserve local tunables where possible

## Governance And Tooling

Agents do not install tools or create skills autonomously. Requests flow through the orchestration layer:

- tech lead validates need
- tool provisioner or skill creator proposes options
- mcp-vetter reviews MCP risk
- approved changes are integrated into the harness

This keeps the harness coherent and auditable.

## External Sources

The recruiter builds and consumes a deterministic index from `index-sources.json` (roster first, then configured external sources):

- `VoltAgent/awesome-claude-code-subagents`
- `VoltAgent/awesome-agent-skills`
- `wshobson/agents`
- `heilcheng/awesome-agent-skills`
- `msitarzewski/agency-agents`
- `mk-knight23/AGENTS-COLLECTION`

The roster remains the curated preferred source.

## Repo Layout

```text
agent-roster/
├── agents/
├── skills/
├── rules/
├── hooks/
├── recruiter/
├── governor/
├── schema/
├── scripts/
├── index.json
├── AGENTS.md
└── CHANGES.md
```

## Development Workflow

To add or update components manually:

1. create or edit the component file in the appropriate directory
2. follow the relevant schema in `schema/`
3. rebuild the index:

```bash
npm run build:index
```

4. update `AGENTS.md` if the inventory changes
5. open a PR

Commit style follows conventional commits:

- `feat:`
- `fix:`
- `docs:`
- `chore:`

## Changes

Durable change history lives in [CHANGES.md](CHANGES.md).

Temporary updater-facing release notes may appear inside installable prompts during migration windows, but the repo-level history belongs in `CHANGES.md`.
