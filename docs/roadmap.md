# TA Roadmap

TA is the roster-native tmux agent manager. It is developed as an
agent-roster project: the `tech-lead` selects the next loop action, the team
implements or improves the roadmap, then review and QA verify the result before
commit.

Primary product constraint: TA should stay as simple to start and operate as
Herdr. Roster-native authority, workspace state, and agent connections are
advantages only when they reduce manual setup; the default path must remain
pick workspace, pick agent, start or connect.

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
- Dashboard focused pipeline edges can now cycle selected visible targets with
  `[` and `]`, preserve target focus across refresh, and expose read-gated
  source/target pane-focus intents.
- Dashboard focused pipeline edge actions now have a structured, non-mutating
  JSON export through pure model APIs plus `tactl dashboard actions` and
  `actions-socket`, so future TUI, MCP, and test clients no longer need to
  parse rendered preview text. Exports include refresh status and preserve
  write-only targets as pane-less action metadata.
- Dashboard rendering now has a shared viewport height contract and `--height`
  clipping across `ta`, `tactl dashboard render`, and `render-socket`, giving
  the Herdr-quality UI baseline an enforceable terminal-size gate.
- `ta` now starts from workspace defaults: it prefers saved state snapshots,
  falls back to config-backed dashboards, supports this source tree's bundled
  example config, and prints a concrete quickstart only when no defaults exist.
  `tactl quickstart` and root help/man sections document the source-tree and
  installed startup flows.
- `ta` now has a first full-screen dashboard TUI mode. `--tui=auto` enters an
  alternate-screen terminal loop on real terminals while redirected output stays
  static; `--tui=always` and `--tui=never` make the mode explicit for QA and
  automation.
- `ta` now uses the `miaou-tui` opam package for full-screen terminal mode.
  The executable is a MIAOU `Direct_page` backed by the pure dashboard runner,
  with JSON-driveable `MIAOU_DRIVER=headless` coverage and tmux QA over the
  MIAOU terminal backend.
- `ocaml/agent-manager` now has a local opam switch that installs the TA
  package, `miaou-tui`, test dependencies, and formatting tools so the project
  can compile without relying on the broader development switch.
- The MIAOU dashboard now uses MIAOU widget helpers for an agent/workspace
  sidebar, agent status table, and selected-agent description panel while
  preserving short-terminal and narrow-terminal behavior under headless and
  tmux Matrix QA.
- The MIAOU dashboard now has a selected-agent start action. Pressing `Enter`
  on a detached selected agent sends a socket `start-agent` request for the
  current workspace/agent, uses write ACLs, reuses server-trusted typed launch
  planning, persists the captured tmux pane id, and cleans up a created
  pane/session if state persistence fails. The `s` key remains a guarded
  direct start alias.
- The local `ta` TUI can now start the selected agent directly when it has a
  trusted config path, without requiring a manually launched socket server.
  Config-only startup also bootstraps `.ta-state.json`, and successful starts
  mark the selected agent `running`.
- `ta` now presents the TUI as the normal startup path. Help, quickstart, and
  startup guide text lead with `dune exec ta`, selecting an agent, and pressing
  `Enter`; manual `tactl state save` and `launch start` flows are documented
  as advanced CLI fallbacks. The MIAOU dashboard mirrors this with a compact
  selected-agent action bar in both full and collapsed layouts.
- `ta` is now workspace-enabled from the canonical agent-roster harness. When
  no TA config exists but `.harness/harness.json` does, startup derives
  `.harness/ta.json`, bootstraps `.ta-state.json`, opens the real roster
  workspace, and selects `tech-lead` first so the primary TUI action can start
  the lead without showing example fixture data.
- Harness provenance and coordinator scope are now visible in TA views. The
  durable state snapshot preserves `harness_path`, dashboards show the selected
  workspace source, and the MIAOU agent detail panel shows both the harness
  source and write privilege count for the selected agent.
- The repo now dogfoods a canonical `.harness/` for TA development with a
  12-agent roster: `tech-lead`, `recruiter`, `harness-builder`, `planner`,
  `ocaml-implementer`, `implementer`, `ocaml-dune-specialist`, `reviewer`,
  `architect`, `terminal-ux-reviewer`, `qa`, and `mcp-vetter`. OpenCode,
  Claude, and Codex surfaces are generated from that harness.
- `terminal-ux-reviewer` now exists as a roster source agent with a Herdr-style
  tmux evidence contract and the two-selection Codex `tech-lead` start bar.
- TA now has typed product capabilities for future creation and connection
  flows. Harness-derived workspaces grant `create-agent` and `connect-agents`
  only to `tech-lead` and `recruiter`; all other agents default to no special
  authority, and the MIAOU selected-agent detail shows the result.
- TA's MIAOU dashboard now has a Herdr-simpler primary action: `Enter` starts a
  detached selected agent and refreshes an attached selected agent, so the
  normal flow is select workspace, select agent, press Enter.
- Detached selected-agent start actions now show the launch profile and
  shell-safe command, for example `Enter Start tech-lead | Codex | 'codex'`,
  so the Enter-first workflow is explicit without opening a config form.
- Attached live agents now render their pane preview before metadata in the
  MIAOU main panel, keeping session output visible on short terminals while
  detached agents keep the detail-first view.
- The MIAOU dashboard now has a preview focus toggle for live agents. Pressing
  `v` gives the selected live pane the full body area while keeping the
  Enter-first workflow unchanged. The focus is anchored to the selected live
  workspace/agent/view, survives refresh for that same selection, and clears
  when the operator moves elsewhere.

## Near-Term Milestones

- Upgrade selected-agent start into the full two-selection TUI workflow: pick
  workspace, pick roster agent or template, confirm command/profile only when
  needed, and TA creates the tmux pane plus state snapshot without requiring
  hand-written JSON.
  Acceptance bar: from `dune exec ta`, starting a Codex `tech-lead` must take
  no more than two primary selections in the TUI.
- Keep capability-driven create/connect flows equally simple: privileged agents
  should get one visible action, while non-privileged agents see request or
  disabled states instead of configuration-heavy forms.
- Add a TUI-visible regeneration/update path for generated `.harness/ta.json`
  and `.ta-state.json` when `.harness/harness.json` changes.
- Add a command/profile selector for generated harness agents so TA can start
  Codex, Claude, or OpenCode explicitly instead of hard-coding Codex in the
  generated TA config.
- Add a TUI connection editor: choose source agent, choose target agent, select
  read/write permissions, and persist the ACL edge with an audit event.
- Add capability-gated agent creation: only roster agents with an explicit
  creation capability, such as `tech-lead` and `recruiter`, can generate or
  install new agent definitions. Other agents may request creation through
  those privileged actors.
- Upgrade the MIAOU full-screen TUI from text-frame sections to a Herdr-grade
  layout with workspace/agent sidebar, pane preview focus area, action footer,
  mouse/keyboard affordances, and blocked/working/done rollups.
- Deepen the current MIAOU widget layout with richer preview panes, explicit
  focus rings, modals, command palette flows, and launch/connect actions.
- Establish a Herdr-quality UI baseline: fast keyboard workflows, persistent
  workspace navigation, clear agent state, readable pane previews, detach/resume
  confidence, and polished terminal layouts beyond the first height-clipping
  gate.
- Add a Herdr comparison QA gate for each major TUI loop. At minimum, compare
  empty state, start-agent flow, sidebar scan quality, real-pane visibility,
  narrow terminal behavior, keyboard discoverability, and runtime API parity
  against current Herdr docs/screenshots or a temporary Herdr tmux run.
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
