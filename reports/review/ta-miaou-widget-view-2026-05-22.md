# Review: TA Miaou Widget View

## Scope

Reviewed loop 37 after rebasing on latest `origin/main`, creating the local
opam switch, and replacing the inline MIAOU TUI text renderer with
`ta_miaou_view.ml`.

## Findings

- Resolved: the first widget pass allowed `Sidebar_widget` border rows to push
  content past short terminal heights. The view now reserves header and border
  rows before rendering the body, and headless coverage asserts a 10-row frame
  stays within the reported terminal height.
- Resolved: when MIAOU collapses the sidebar below 40 columns, the main panel
  was still rendered at split-pane width. The view now renders the main panel
  at full terminal width in collapsed mode, with headless coverage at 39
  columns.
- Resolved: the new `ta_miaou_view.ml` module is explicitly part of the commit
  set, avoiding the earlier untracked-file risk.

## Checks

- `opam exec --switch=. -- dune build @all @install`
- `opam exec --switch=. -- dune runtest`
- `opam exec --switch=. -- dune test`
- `opam exec --switch=. -- ocamlformat --check --enable-outside-detected-project src/bin/ta_tui.ml src/bin/ta_miaou_view.ml test/test_ta_cli.ml`
- `opam lint agent-roster-agent-manager.opam`
- `git diff --check -- . ':(exclude)index.json'`
- tmux Matrix smoke at `80x10`: dashboard, pipeline navigation, footer, and
  clean quit.
- tmux Matrix smoke at `39x18`: collapsed main panel shows the full roster id
  line after dismissing the narrow-terminal modal.

## Decision

Approved for loop 37 after the short-height and collapsed-width fixes.
