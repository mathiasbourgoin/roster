# QA: TA Miaou Widget View

## Result

Pass. QA used the local opam switch at `ocaml/agent-manager/_opam`.

## Local Switch

- Created with `opam switch create . ocaml-base-compiler.5.3.0 --yes`.
- Installed package dependencies, `miaou-tui`, `alcotest`, and `ocamlformat`.
- Confirmed `opam exec --switch=. -- ocamlfind query miaou-runner.tui` resolves
  inside the local switch.

## Automated Checks

- `opam exec --switch=. -- dune build @all @install` passed.
- `opam exec --switch=. -- dune runtest` passed.
- `opam exec --switch=. -- dune test` passed.
- `opam exec --switch=. -- ocamlformat --check --enable-outside-detected-project src/bin/ta_tui.ml src/bin/ta_miaou_view.ml test/test_ta_cli.ml`
  passed.
- `opam lint agent-roster-agent-manager.opam` passed.
- `git diff --check -- . ':(exclude)index.json'` passed.

## TUI QA

- Headless MIAOU JSON flow covers render, pipeline navigation, short viewport
  height, collapsed width, and clean quit.
- tmux Matrix `80x10` smoke from the local switch showed `TA Dashboard`,
  `Agent detail`, footer hints, bottom border, `Pipeline edge`, and clean quit.
- tmux Matrix `39x18` smoke from the local switch showed collapsed layout using
  enough width to display `tech-lead | id tech-lead` after dismissing the
  narrow-terminal modal.

## Herdr Comparison

- Installed Herdr 0.6.1 into `/tmp/herdr-loop37-qa/bin` only.
- Ran `HERDR_SESSION=ta-loop37 herdr` in a `120x34` tmux session with isolated
  `HOME=/tmp/herdr-loop37-home`.
- Ran `herdr workspace create --cwd /home/mathias/dev/agent-roster --label agent-roster --focus`.
- Ran `herdr agent start tech-lead --cwd /home/mathias/dev/agent-roster --workspace <id> --split right --no-focus -- bash -lc ...`.
- Captured result: Herdr immediately showed a real split pane labelled
  `tech-lead` plus a sidebar agent row `idle · tech-lead`.

Comparison finding: TA's current TUI is now technically stable, but it is still
too much of a dashboard over pre-existing state. Herdr's product value is that
workspace and agent creation are operational controls. The next TA loop should
make `Start agent` a first-class TUI action with a two-selection path for
starting a Codex `tech-lead`.

Reference sources checked:

- https://herdr.dev/
- https://herdr.dev/docs/quick-start/
- https://herdr.dev/docs/cli-reference/

## Product Follow-Up

The manual JSON/CLI sequence to start a Codex tech lead is not acceptable as
the primary workflow. The next loop should implement the TUI-first
start/connect/create flow described in the roadmap.
