# Agent Definition Schema

Every agent in this roster MUST follow this format: a markdown file with YAML frontmatter.

## Required Frontmatter Fields

```yaml
---
name: <string>              # Unique identifier (kebab-case)
display_name: <string>      # Human-readable name
description: <string>       # One-line summary of what this agent does
domain: [<string>, ...]     # Primary domains (e.g., security, devops, frontend)
tags: [<string>, ...]       # Searchable tags for discovery
model: <string>             # Recommended model (opus, sonnet, haiku)
complexity: <low|medium|high>  # Task complexity this agent handles
compatible_with: [<string>, ...]  # Platforms: claude-code, codex, cursor, aider, etc.
---
```

`model` remains required for backward compatibility with the current roster index and Claude-oriented install path. If an agent needs runtime-specific model recommendations, add them through optional metadata rather than overloading the core workflow.

## Optional Frontmatter Fields

```yaml
pipeline_role:               # How this agent fits into a team pipeline
  triggered_by: <string>     # What invokes this agent (e.g., "tech-lead spawn request", "user directly")
  receives: <string>         # Expected input format (e.g., "sub-brief at briefs/<task>-<role>.md")
  produces: <string>         # Output format and destination (e.g., "diff + review comments → tech-lead")
  human_gate: <before|after|both|none>  # Where human validation sits relative to this agent's work
tunables:                    # Parameters that can be overridden locally
  <key>: <default_value>
requires:                    # Tool and MCP server dependencies
  - name: <tool-name>        # e.g., playwright, web-search
    type: <mcp|builtin|cli>  # mcp = MCP server, builtin = Claude built-in tool, cli = external CLI tool
    install: <string>        # Install command or instructions (optional)
    check: <string>          # Command to verify it's available (optional)
    optional: <bool>         # If true, agent works without it but with reduced capability
runtime_hints:               # Optional runtime-specific recommendations
  claude-code:
    model: <string>
  codex:
    model: <string>
entrypoints:                 # Optional runtime-specific thin wrappers
  claude-code:
    type: <agent|command|rule|hook>
  codex:
    type: <agent|skill|cli|agents-md>
isolation: <worktree|none>   # Whether the agent needs an isolated workspace
replaces: [<agent-name>, ...] # Agents this one supersedes (for upgrade proposals)
version: <semver>            # Version for tracking updates
author: <string>             # Who created/maintains this agent
source: <url>                # Original source if forked/adapted
```

## Body Structure

After the frontmatter, the markdown body should contain:

1. **Role description** — Who is this agent? What's its mission?
2. **Workflow** — Step-by-step process the agent follows
3. **Rules** — Hard constraints and invariants
4. **Runtime notes** — Claude-only or Codex-only invocation details, isolated from the core workflow
5. **Output format** — Expected deliverable structure (if applicable)

The main workflow should stay runtime-neutral whenever possible. Do not hard-code `.claude/...` paths in the core behavior unless the agent is truly Claude-only.

## Example

```markdown
---
name: vuln-triager
display_name: Vulnerability Triager
description: Analyzes security vulnerability reports, assigns severity scores, and recommends remediation priority.
domain: [security, triage]
tags: [bounty, cve, severity-scoring, vulnerability]
model: sonnet
complexity: medium
compatible_with: [claude-code, codex]
tunables:
  severity_threshold: medium
  auto_escalate: false
requires: [web-search]
version: 1.0.0
---

# Vulnerability Triager

You are a security triage specialist...
```

## Naming Convention

Files are named `<agent-name>.md` matching the `name` frontmatter field.
Placed in `agents/<primary-domain>/` directory.
