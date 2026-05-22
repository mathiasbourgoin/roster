# QA: TA Miaou TUI

## Result

Pass, with one environment note: the active `octez-setup` switch has Octez
`cohttp` pins that prevent solving `miaou-tui`. QA used the
`/home/mathias/dev/miaou` switch, where the proper opam `miaou-tui` package and
libraries are installed.

## Automated Checks

- `opam exec --switch=/home/mathias/dev/miaou -- dune build @all @install`
  passed.
- `opam exec --switch=/home/mathias/dev/miaou -- dune runtest` passed.
- `opam exec --switch=/home/mathias/dev/miaou -- dune test` passed.
- `opam install --switch=/home/mathias/dev/miaou --deps-only --dry-run . --with-test`
  reported `Nothing to do`.
- `opam lint agent-roster-agent-manager.opam` passed.
- `ocamlformat --check --enable-outside-detected-project` passed for changed
  OCaml files.
- `git diff --check -- . ':(exclude)index.json'` passed.
- `npm test` passed for the repository index/tests.

## TUI QA

- Headless MIAOU JSON flow:
  - ran `MIAOU_DRIVER=headless dune exec ta -- --state <state> --tui always`;
  - sent JSON commands for render and quit;
  - verified frame JSON, `TA Dashboard`, `Workspaces`, and `Agent fixture/lead`.
- tmux with MIAOU term backend:
  - started `ta --state <state> --tui always` in a 110x32 tmux pane;
  - verified `TA Dashboard`, `Workspaces`, and `Agent fixture/lead`;
  - sent `p` and `Right`;
  - verified `Pipeline edge`, `Selected target`, and `Action:`;
  - sent `q` and confirmed the tmux session exited.
- tmux with MIAOU matrix backend:
  - verified dashboard render, pipeline edge render, and clean quit.

## Coverage Added

- `test_dashboard_tui_layout` covers selected-agent layout, pipeline edge
  layout, height clipping, narrow viewport width, and driver-owned footer mode.
- `test_ta_cli` covers MIAOU headless render/quit and documents headless mode
  in help output.
