# Review: TA Miaou TUI

## Scope

Reviewed loop 36 changes replacing the Notty bootstrap with a `miaou-tui`
runner, adding a renderer-neutral full-screen dashboard layout model, and
updating CLI/help/tests/package metadata.

## Findings

- Resolved: the first pass rendered a footer inside `Dashboard_tui_layout`
  while also exposing MIAOU `key_hints`. `ta_tui` now calls
  `Dashboard_tui_layout.render ~show_footer:false`, so the MIAOU driver owns
  footer hints in real terminal mode.
- Resolved: the first pass forced a minimum 60-column layout. The layout now
  computes responsive sidebar/main widths that stay within the requested
  viewport, with a narrow-width regression test.
- Resolved: `--tui` help now documents that `MIAOU_DRIVER=headless` can enter
  full-screen mode without a TTY for automation.
- Environment risk: the `octez-setup` switch cannot currently install
  `miaou-tui` because its pinned `cohttp.5.3.1~octez` conflicts with Miaou's
  current `cohttp-eio >= 6.2.1` dependency chain. Source/package metadata is
  correct; verification was run in the `/home/mathias/dev/miaou` switch where
  `miaou-tui` installs cleanly.

## Checks

- `opam exec --switch=/home/mathias/dev/miaou -- dune build @all @install`
- `opam exec --switch=/home/mathias/dev/miaou -- dune runtest`
- `opam exec --switch=/home/mathias/dev/miaou -- dune test`
- `opam install --switch=/home/mathias/dev/miaou --deps-only --dry-run . --with-test`
- `opam lint agent-roster-agent-manager.opam`
- `ocamlformat --check --enable-outside-detected-project ...`
- `git diff --check -- . ':(exclude)index.json'`

## Decision

Approved for loop 36 after the footer, narrow-width, and help-text fixes.
