# TA Dashboard Edge Target Commands QA - 2026-05-22

## Verdict

PASS after local QA, independent QA, review remediation, and final sweep.

## Automated Checks

- `dune build @all --no-print-directory`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.

## Automated Coverage

- Focused-edge preview rendering marks a selected target.
- `Focus_pane` intent strings include workspace, agent, and pane metadata.
- Pipeline `]` and `[` cycle selected edge targets and update preview
  selection.
- Selected edge target survives refresh when still visible.
- Focused edge affordances remain hidden outside Pipeline focus.
- Write-only targets suppress read preview and pane-focus intents while keeping
  actor-bound write intents.
- CLI `dashboard render --key p --key Right --key ]` exercises multi-target
  replay.

## Manual Tmux Evidence

Local QA and independent QA both launched disposable three-agent tmux
workspaces, served them through the TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --key r --key p --key Right --key ] --width 160 --lines 9
```

Observed local result:

```text
loop31 live tmux QA passed for ta-loop31-1779459979-2067663
```

The smoke verified:

- manual refresh did not produce a stale banner;
- the focused ACL edge stayed highlighted;
- `]` changed the selected edge target to `loop31/qa`;
- `> Edge target: loop31/qa` rendered with live pane and session metadata;
- `Action: focus target pane | focus-pane loop31/qa pane %...` rendered;
- `Action: read target preview | runtime-snapshot loop31/qa lines 9` rendered;
- the actor-bound write intent for `lead -> qa` rendered;
- the preview panel selected `loop31/qa` and contained live `qa-target-ready`
  output;
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

## Notes

- Direct `dune exec ./test/test_tactl_cli.exe` is not the supported harness for
  fixture-backed CLI tests because `TACTL_EXE` is set by the Dune `runtest`
  stanza.
