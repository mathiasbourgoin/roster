# TA Runtime Config Schema

Canonical location: `.harness/ta.json`.

This file describes runtime workspaces for the TA agent manager. It is separate
from `.harness/harness.json`: the harness defines the installed agent team,
while TA defines how that team is launched, displayed, and permitted to
communicate in tmux-backed workspaces.

## Top-Level Object

```json
{
  "version": "0.1.0",
  "workspaces": []
}
```

- `version`: schema version string.
- `workspaces`: list of workspace objects. Workspace IDs must be unique.

Unknown fields are ignored for now so the bootstrap parser can remain forward
compatible while the schema is still evolving.

## Workspace

```json
{
  "id": "agent-roster",
  "label": "Agent Roster",
  "root": ".",
  "harness_path": ".harness/harness.json",
  "tmux_session": "ta-agent-roster",
  "default_view": "agents",
  "views": [],
  "agents": [],
  "links": []
}
```

- `id`: stable workspace ID. Allowed characters: letters, digits, `.`, `_`,
  and `-`.
- `label`: display label.
- `root`: workspace root path. Relative paths are resolved by the future
  supervisor against the config file directory.
- `harness_path`: optional project harness path.
- `tmux_session`: managed tmux session name. Same character policy as IDs.
- `default_view`: ID of a view declared in `views`.
- `views`: list of unique view objects.
- `agents`: list of unique agent launch objects.
- `links`: optional list of explicit agent-to-agent ACLs.

## View

```json
{
  "id": "agents",
  "label": "Agents"
}
```

Views are Herdr-like tabs within one workspace.

## Agent

```json
{
  "name": "tech-lead",
  "roster_agent": "tech-lead",
  "command": ["codex"],
  "cwd": ".",
  "env": [{"name": "TA_ROLE", "value": "tech-lead"}],
  "startup_prompt": "Lead the TA roadmap loop from agent-roster."
}
```

- `name`: unique runtime agent ID in the workspace.
- `roster_agent`: agent name from `agent-roster`.
- `command`: non-empty argv-style launch command.
- `cwd`: optional working directory.
- `env`: optional environment bindings.
- `startup_prompt`: optional text sent after launch in a later milestone.

## Link

```json
{
  "from": "tech-lead",
  "to": "qa",
  "permissions": ["read", "write"],
  "reason": "The lead routes verification work and reads QA reports."
}
```

- `from` and `to` must refer to existing agents in the same workspace.
- `permissions` must contain one or both of `read` and `write`.
- `reason` documents why the ACL exists.

There are no implicit cross-agent or cross-workspace permissions.
