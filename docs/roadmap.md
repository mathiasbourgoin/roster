# TA Roadmap

TA is the roster-native tmux agent manager. It is developed as an
agent-roster project: the `tech-lead` selects the next loop action, the team
implements or improves the roadmap, then review and QA verify the result before
commit.

## Loop Policy

- The loop is intentionally open-ended and stops only when Mathias stops it.
- Each cycle chooses either roadmap discovery or bounded implementation.
- Implementation cycles require review, tests, tmux QA evidence when behavior
  touches runtime sessions, and a commit.
- The `tech-lead` is delegated to answer ordinary planning questions and choose
  tradeoffs without waiting for Mathias.

## Current Milestone: Bootstrap Runtime Core

- Standalone OCaml subproject under `ocaml/agent-manager/`.
- Strong typed identifiers and permission witnesses.
- `.harness/ta.json` compatible parser and validator.
- `tactl` CLI for config validation and tmux smoke diagnostics.
- Initial `ta` launcher placeholder that loads and summarizes config.
- QA report with tmux execution evidence.
- Pure workspace state store with audit log, ACL checks, and JSON snapshots.
- Snapshot file save/load commands for initial workspace state.
- Snapshot mutation commands for agent status and tmux pane attachment.
- Detailed state inspection command with bounded recent audit output.
- Deterministic supervised tmux launch planning with pane and target metadata.
- Supervised tmux launch start with dry-run, literal prompt sending, and
  cleanup ownership.
- Launch-created native tmux pane ids persisted back into state snapshots.
- Launch runtime captures native pane ids from `tmux -P -F "#{pane_id}"`,
  allowing launches under non-default `base-index` and `pane-base-index`.

## Near-Term Milestones

- Add roster metadata loading from `index.json` and agent markdown frontmatter.
- Add supervised agent launch from workspace config.
- Add Unix socket API mirroring `tactl` commands.
- Add MIAOU dashboard with cached runtime state, not direct render-time polling.
- Establish a Herdr-quality UI baseline: fast keyboard workflows, persistent
  workspace navigation, clear agent state, readable pane previews, detach/resume
  confidence, and polished terminal layouts at common viewport sizes.
- Add MCP bridge with ACL-checked read/write tools only.

## Ambitious Product Direction

- Workspace graph view: projects, views, panes, agents, and ACL edges.
- Pipeline mode: tech-lead, implementer, reviewer, QA, and human gate state.
- Agent-to-agent communication through permissioned channels and audit events.
- Reinforcement loop metrics: cycle time, failed reviews, QA failures, repeated
  defect classes, and roadmap churn.
- Runtime backend abstraction that can support tmux first, then richer PTY or
  alternate multiplexers later.
- UI quality gates that compare TA against Herdr-level ergonomics before
  accepting major TUI milestones.
