# Harness Manifest Schema

The `harness.json` file is the project-level manifest describing the complete shared harness configuration. It is generated during install and maintained by layer-specific agents.

Canonical location:

- `.harness/harness.json`

Compatibility views may also be generated for specific runtimes, for example:

- `.claude/harness.json`

## Top-Level Fields

```yaml
version: <semver>            # Schema version (currently "1.0.0")
profile: <string>            # Active install profile: core|developer|security|full
source_of_truth: <string>    # Canonical shared harness root, usually ".harness"
runtimes:
  - name: <claude-code|codex|codex-global|opencode|copilot>
    enabled: <bool>
    entrypoint: <string>     # e.g. ".claude/" or ".agents/skills/"
project:
  name: <string>             # Project name (from package.json, dune-project, etc.)
  languages: [<string>]      # Detected languages (e.g., ["ocaml", "python"])
  frameworks: [<string>]     # Detected frameworks (e.g., ["react", "dune"])
  ci: <string|null>          # CI system if detected (github-actions, gitlab-ci, etc.)
  issue_tracker: <string|null>  # Issue tracker URL or type
  validate_command: <string|null>  # Optional. The project's own quality/leak gate, run as the
                             # PER-TARGET gate by /roster-upgrade (e.g. "npm test",
                             # "bash scripts/validate.sh"). Discovery order when absent:
                             # scripts/validate.sh convention → none (generic-gate-only,
                             # flagged low-assurance). See skills/meta/roster-upgrade.md.
```

## Layers

Each layer is populated and maintained by a specific agent. Layer content is runtime-neutral; runtime-specific files should be generated from these layers rather than drifting independently.

### `layers.agents`

Populated by: **tech-lead** (via recruit)

```yaml
- name: <string>             # Agent name (kebab-case, matches roster)
  source: <roster|external|custom>  # Where the agent definition lives
  version: <semver>          # Installed version
  role: <string>             # One-line role description
  tunables: {}               # Local overrides for agent tunables
```

### `layers.rules`

Populated by: **governor**, **tech-lead**

```yaml
- name: <string>             # Rule name (kebab-case)
  source: <roster|governor-generated|custom>  # Origin
  scope: <global|path:glob>  # Where the rule applies
  category: <safety|style|workflow|language|governance>  # Classification
```

### `layers.hooks`

Populated by: **tech-lead**

```yaml
- name: <string>             # Hook name (kebab-case)
  event: <PreToolUse|PostToolUse|SessionStart|Stop|SessionEnd>
  matcher: <string|null>     # Tool matcher for Pre/PostToolUse events
  source: <roster|custom>    # Origin
```

### `layers.skills`

Populated by: **tech-lead**, **roster-skill-evolve**

```yaml
- name: <string>             # Skill name (kebab-case). The roster- prefix is a naming
                             # convention for pipeline/meta skills, not a hard requirement —
                             # standalone skills are exempt (e.g. git-conventions, kb-update,
                             # tdd-workflow, image-generation)
  source: <roster|external|custom>  # Origin
  version: <semver>          # Installed version
  domain: <kb|media|meta|operational|pipeline|shared|testing|workflow>  # Skill domain
  phase: <intake|question|research|spec|plan|implement|review|qa|ship|null>  # Pipeline phase (null if not a pipeline skill)
  tunables: {}               # Local overrides for skill tunables
```

### `layers.metabolism`

Populated by: **roster-init**, maintained by **roster-skill-health** and **roster-skill-evolve**.
Controls the skill metabolism system.

```yaml
friction_log: <string>         # Path to friction log (default: "skills-meta/friction.jsonl")
health_schedule: <manual|N-tasks>  # When to trigger roster-skill-health
                               # "manual" = human-triggered only
                               # "10-tasks" = suggest after every 10 completed tasks
health_reports_dir: <string>   # Directory for health reports (default: "skills-meta/")
last_health_run: <date|null>   # ISO 8601 date of last skill-health run
completed_tasks: <int>         # Counter for health_schedule trigger
```

### `layers.mcp`

Populated by: **mcp-vetter**

```yaml
- name: <string>             # MCP server name
  status: <vetted|unvetted|blocked>  # Vetting status
  vetted_by: <mcp-vetter|null>       # Who approved it
```

### `layers.kb`

Populated by: **kb-agent**, audited by configured auditors

```yaml
structure: <minimal|standard|large>  # KB tier (see kb-schema.md)
bootstrapped: <bool>                 # Whether initial KB was generated
last_audit: <date|null>              # ISO 8601 date of last audit
auditors: [<string>]                 # Agent names that audit the KB
```

## Example

```json
{
  "version": "1.0.0",
  "profile": "developer",
  "source_of_truth": ".harness",
  "runtimes": [
    { "name": "claude-code", "enabled": true, "entrypoint": ".claude/" },
    { "name": "codex", "enabled": true, "entrypoint": ".agents/skills/" },
    { "name": "codex-global", "enabled": false, "entrypoint": "~/.codex/skills/" },
    { "name": "opencode", "enabled": true, "entrypoint": ".opencode" },
    { "name": "copilot", "enabled": false, "entrypoint": ".github" }
  ],
  "project": {
    "name": "my-ocaml-lib",
    "languages": ["ocaml"],
    "frameworks": ["dune"],
    "ci": "github-actions",
    "issue_tracker": "https://github.com/org/repo/issues",
    "validate_command": "dune build @runtest"
  },
  "layers": {
    "agents": [
      { "name": "tech-lead", "source": "roster", "version": "1.0.0", "role": "Orchestrates agent team and manages harness", "tunables": {} },
      { "name": "reviewer", "source": "roster", "version": "1.0.0", "role": "Code review with language-aware checks", "tunables": {} },
      { "name": "implementer", "source": "roster", "version": "1.0.0", "role": "Writes code following TDD workflow", "tunables": {} }
    ],
    "rules": [
      { "name": "sycophancy", "source": "roster", "scope": "global", "category": "safety" },
      { "name": "ocaml-style", "source": "governor-generated", "scope": "path:lib/**", "category": "language" }
    ],
    "hooks": [
      { "name": "block-dangerous", "event": "PreToolUse", "matcher": "Bash", "source": "roster" },
      { "name": "post-edit-lint", "event": "PostToolUse", "matcher": "Edit|Write", "source": "roster" }
    ],
    "skills": [
      { "name": "git-conventions", "source": "roster", "version": "1.0.0", "domain": "workflow", "phase": null },
      { "name": "kb-update", "source": "roster", "version": "1.0.0", "domain": "operational", "phase": null },
      { "name": "tdd-workflow", "source": "roster", "version": "1.0.0", "domain": "testing", "phase": null },
      { "name": "roster-run", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": null },
      { "name": "roster-init", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": null },
      { "name": "roster-intake", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": "intake" },
      { "name": "roster-plan", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": "plan" },
      { "name": "roster-implement", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": "implement" },
      { "name": "roster-review", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": "review" },
      { "name": "roster-qa", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": "qa" },
      { "name": "roster-ship", "source": "roster", "version": "1.0.0", "domain": "pipeline", "phase": "ship" },
      { "name": "roster-investigate", "source": "roster", "version": "1.0.0", "domain": "operational", "phase": null },
      { "name": "roster-audit", "source": "roster", "version": "1.0.0", "domain": "operational", "phase": null },
      { "name": "roster-skill-health", "source": "roster", "version": "1.0.0", "domain": "meta", "phase": null },
      { "name": "roster-skill-evolve", "source": "roster", "version": "1.0.0", "domain": "meta", "phase": null }
    ],
    "metabolism": {
      "friction_log": "skills-meta/friction.jsonl",
      "health_schedule": "manual",
      "health_reports_dir": "skills-meta/",
      "last_health_run": null,
      "completed_tasks": 0
    },
    "mcp": [
      { "name": "context-mode", "status": "vetted", "vetted_by": "mcp-vetter" }
    ],
    "kb": {
      "structure": "minimal",
      "bootstrapped": true,
      "last_audit": "2026-03-30",
      "auditors": ["kb-agent"]
    }
  }
}
```

## File Location

Canonical manifest: `.harness/harness.json`

If a runtime also needs its own compatibility manifest, generate it from the canonical manifest. Agents should prefer the canonical shared manifest when both exist.
