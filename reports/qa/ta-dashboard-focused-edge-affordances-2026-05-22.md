# TA Dashboard Focused Edge Affordances QA - 2026-05-22

## Verdict

PASS after local QA, independent QA, reviewer remediation, and re-QA.

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

- Pure focused-edge affordance rendering includes source metadata, target
  metadata, permissions, and typed action descriptions.
- Focused edge affordance lines respect fixed dashboard widths.
- `Dashboard_model.edge_affordance` derives visible source and target metadata
  from the redacted model.
- Hidden edge targets do not appear in affordance rendering.
- Non-source actors suppress write affordances.
- Focused-edge affordances are hidden after focus leaves Pipeline.
- Requested preview line counts are propagated into runtime-snapshot read
  intents.
- CLI `dashboard render --key p --key Right` renders focused edge metadata and
  read actions.

## Manual Tmux Evidence

Local QA and independent re-QA both launched disposable two-agent tmux
workspaces, served them through the TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --key r --key p --key Right --width 140 --lines 7
```

Observed local result:

```text
loop30 live tmux QA passed for ta-loop30-1779459070-2049394
```

The smoke verified:

- manual refresh did not produce a stale banner;
- `p` focused the pipeline section;
- `Right` selected the declared ACL edge from `loop30/lead`;
- edge source and target metadata included live pane ids, the tmux session, and
  live runtime state;
- read actions used `lines 7`;
- the actor-bound write intent rendered for actor `lead`;
- the selected preview changed to `Preview: loop30/qa`;
- the selected preview contained live `qa-affordance-ready` pane output;
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

## Notes

- Direct `dune exec ./test/test_tactl_cli.exe` requires `TACTL_EXE`; the Dune
  `runtest` stanza sets it correctly.
