# TA Tmux Agent Manager

TA is an OCaml, MIAOU-backed, tmux-first agent manager for `agent-roster`.

The product goal is stronger than a terminal dashboard: TA manages roster
teams, workspaces, permissions, handoffs, and pipeline state. tmux provides the
durable execution substrate, while agent-roster provides agent identity,
contracts, tunables, and governance.

## Architecture

- `agent-roster` remains the source of agent metadata.
- `.harness/harness.json` remains the project harness manifest.
- `.harness/ta.json` is the TA runtime manifest for workspaces, views, agents,
  launch commands, and ACLs.
- `ta` is the interactive TUI.
- `tactl` is the scriptable CLI.
- `ta-daemon` will own socket API, supervised polling, audit events, and MCP
  process lifecycle.

## Workspace Model

- Workspace: isolated project or task container.
- View: named layout inside a workspace, equivalent to Herdr-like tabs.
- Pane: runtime terminal process owned by tmux.
- Agent: roster identity attached to a pane.
- Link: explicit read/write ACL between agents within one workspace.

Cross-workspace communication is denied by default.

## Engineering Rules

- OCaml is mandatory.
- Public modules have `.mli` interfaces.
- Use strong types for IDs and permissions.
- Use phantom types or GADTs where they remove invalid states.
- Keep MIAOU view functions pure and cheap; polling belongs in supervisors.
- Do not expose raw tmux commands through MCP.
- Runtime-visible changes require tmux QA evidence.

## UI Quality Bar

TA must meet the same operational quality bar as Herdr before TUI milestones
are accepted:

- Workspace switching must be immediate, persistent, and obvious.
- Agent state must be visible without opening each pane.
- Pane previews must be readable, scrollable, and safe from accidental writes.
- Keyboard workflows must cover common actions without modal confusion.
- Detach, resume, stop, and archive actions must have clear confirmations and
  post-action state.
- Layouts must remain usable in narrow tmux panes and full-size terminals.
- QA must verify UI milestones through tmux execution and capture evidence, not
  only unit tests.
