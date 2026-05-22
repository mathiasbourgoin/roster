# Review: TA App-First Startup

## Scope

Reviewed loop 41 changes for TUI-first help text, startup guide messaging, and
the MIAOU selected-agent action affordance.

## Findings

- Approved after local review and independent roster review.
- Help and quickstart text now lead with the simple `ta` TUI path and demote
  manual state/launch commands to advanced fallback material.
- The startup guide explicitly says TA creates `.ta-state.json` automatically
  during config-backed startup.
- The MIAOU view uses a single selected-agent action label for the sidebar,
  detail pane, and post-start state, reducing drift between visible controls
  and key handling.
- Headless tests cover detached, attached, and collapsed action visibility.
- The independent reviewer found no blockers and confirmed the TUI-first path
  is now the primary story in `ta`, `tactl`, and `Startup_guide`.

## Residual Risks

- The normal path still assumes a config exists. The next milestone needs the
  TUI to create agents/workspaces through privileged roster actors instead of
  sending users to JSON.
- The action bar is still text-based. A richer Herdr-grade footer, focus ring,
  and command palette should replace it as the next TUI layout matures.
- Local direct start still binds the selected agent as actor for the human TUI
  path; future privileged creator flows should make actor/capability binding
  explicit in the model.

## Checks

- `opam exec -- dune build @all @runtest`
- `git diff --check`

## Decision

Approved for loop 41.
