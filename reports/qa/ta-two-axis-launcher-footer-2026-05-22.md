# QA: TA Two-Axis Launcher Footer

## Scope

Validated loop 50 launcher navigation and pinned launch footer behavior in the
MIAOU TUI.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- Pure interaction coverage for Left/Right workspace switching from the normal
  launcher view.
- MIAOU headless coverage for switching to a second workspace and seeing the
  pinned launch footer.
- Short and collapsed terminal coverage keeps the launcher visible within frame
  height.
- Tiny 5-row MIAOU coverage keeps the pinned footer visible even when the body
  has no useful row budget, fills the frame, and keeps the footer as the last
  rendered line.

## Tmux Smoke

The manual smoke used a two-workspace config backed by real tmux sessions.

Covered cases:

- `Right` selected the second workspace.
- `Enter` started the selected second-workspace agent.
- The final MIAOU frame showed `Launch docs/writer` and `Enter Refresh
  attached`.
- A follow-up refresh captured `loop50-writer-ready` from the running pane.
- A 5-row follow-up frame still showed `Launch docs/writer` on the final line.

## Result

Passed.

Generated `index.json` remains unstaged.
