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
- Initial Unix socket control plane for read-only state summary and detailed
  state inspection.
- Unix socket state mutations for agent status and pane attachment, guarded by
  owner-only sockets and workspace write permissions.
- Unix socket supervised launch requests for dry-run and start, reusing the
  launch runtime and persisting captured native pane ids back into state.
- Cacheable runtime snapshots for attached tmux panes, including live/missing
  status and bounded pane previews for future UI rendering.
- Actor-scoped Unix socket runtime snapshot endpoint so future UI clients can
  fetch authorized, cacheable pane previews through the local control plane.
- Dashboard view model and static TUI frame renderer for workspace navigation,
  agent runtime health, ACL summaries, and pane preview panels.
- Dashboard interaction state with keyboard-style selection, refresh requests,
  and selected preview rendering for the future MIAOU page.
- Actor-scoped socket dashboard snapshots and `render-socket`, allowing the
  dashboard to refresh through the local control plane with redacted state and
  bounded authorized runtime previews.
- Dashboard refresh intent now executes through a typed socket refresh source,
  preserving selections on success and rendering stale snapshots with explicit
  error state when refresh fails.
- Pure dashboard refresh cadence policy for the future TUI runner, including
  interval decisions, manual override, retry throttling, stale thresholds, and
  user-visible last-refresh metadata.
- Dashboard roster enrichment from `index.json`, showing role/domain/source/tag
  hints while preserving compact agent rows and selected preview detail.
- Dashboard roster enrichment now also loads local agent markdown frontmatter
  client-side, adding model, complexity, compatibility, version, author,
  isolation, and description detail without changing socket payloads.
- Dashboard selected-agent details now include typed `pipeline_role`
  frontmatter metadata: trigger, input contract, output contract, and human
  gate text.
- Dashboard now includes a first pipeline overview section that lists visible
  agents, whether each has a typed contract, and declared ACL edges while
  labelling them as non-inferred workflow order.
- Dashboard key/tick handling now has a pure typed runner boundary for future
  MIAOU pages, with cadence-aware refresh outcomes and existing CLI key replay
  routed through that boundary where refresh sources are available.
- Dashboard pipeline topology now has a pure focusable model with typed node
  ids, declared ACL edge categories, and keyboard traversal across visible
  agents without inferring workflow edges from `pipeline_role` prose.
- Dashboard pipeline topology can now focus declared ACL edges, move from a
  source node to its visible target, and keep the selected edge highlighted
  across refreshes.
- Dashboard focused pipeline edges now expose pure socket-safe affordances,
  including source/target pane metadata and typed read/write action
  descriptions for future MIAOU bindings.

## Near-Term Milestones

- Add a concrete MIAOU page adapter once `miaou-tui` is installed in the
  current switch, using the dashboard runner, interaction state, cadence
  policy, and socket refresh boundary.
- Add target-specific focused-edge commands, including cycling among multiple
  edge targets and exposing explicit source/target pane jump intents for future
  MIAOU key bindings.
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
