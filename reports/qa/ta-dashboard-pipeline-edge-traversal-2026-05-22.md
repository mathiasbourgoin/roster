# TA Dashboard Pipeline Edge Traversal QA - 2026-05-22

## Verdict

PASS after local QA, independent QA, and reviewer re-review.

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

- Topology edge ids are private and round-trip through workspace/source-agent
  accessors.
- Declared ACL edge movement wraps and resolves to visible target nodes.
- Focused edge rendering marks the selected edge row.
- Pipeline `Right` selects the current node's outgoing declared ACL edge when
  one exists.
- Pipeline edge selection moves the preview to the first visible edge target.
- Agent/workspace navigation clears selected edge focus.
- Refresh preserves selected edge focus while the edge still exists.
- Refresh drops selected edge focus when the declared link disappears.
- CLI key replay for `dashboard render --key p --key Right` renders the
  focused edge and target preview.

## Manual Tmux Evidence

Local QA and independent QA both launched disposable two-agent tmux workspaces,
served them through the TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --key r --key p --key Right --width 120 --lines 20
```

Observed local result:

```text
loop29 live tmux QA passed for ta-loop29-1779457743-2021085
```

The smoke verified:

- manual refresh did not produce a stale banner when served by a multi-request
  socket server;
- `p` focused the pipeline section;
- `Right` selected the declared ACL edge from `loop29/lead`;
- the focused edge rendered as
  `> ACL loop29/lead -> read qa | write qa`;
- the selected preview changed to `Preview: loop29/qa`;
- the selected preview contained live `qa-edge-ready` pane output;
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

## Notes

- A one-request socket server is insufficient for `--key r`, because
  `render-socket` first fetches the initial dashboard model and then fetches a
  refreshed model after the manual refresh key.
