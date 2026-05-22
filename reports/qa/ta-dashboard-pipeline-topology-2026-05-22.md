# TA Dashboard Pipeline Topology QA - 2026-05-22

## Verdict

PASS after local QA and independent QA.

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

- Topology nodes are emitted in visible workspace/agent display order.
- Declared ACL read/write edges are preserved and filtered to visible nodes.
- `pipeline_role` metadata creates contract state but does not infer edges.
- Topology movement wraps across all visible nodes.
- Focused topology rendering marks the selected node.
- `p` focuses pipeline and `Tab` cycles through agents, pipeline, and
  workspaces.
- Pipeline `Down` traverses visible nodes across workspaces and keeps preview
  selection in sync.
- Refresh preserves pipeline focus and selected node.
- CLI `dashboard render --key p --key Down` selects the next topology node and
  renders `Pipeline overview [focus]`.
- Width and existing socket dashboard regressions remain covered.

## Manual Tmux Evidence

Local QA and independent QA both launched disposable two-agent tmux workspaces,
served them through the TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --key r --key p --key Down --width 120 --lines 20
```

Observed local result:

```text
loop28 live tmux QA passed: pipeline focus navigation and topology rendering verified
```

The smoke verified:

- manual refresh did not produce a stale banner;
- `p` focused the pipeline section;
- `Down` selected `loop28/qa`;
- the focused topology section rendered edge categories and the declared ACL
  edge;
- the selected preview showed live `qa-topology-ready` pane output;
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

## Notes

- Direct CLI test executable runs without Dune's test action are expected to
  fail if `TACTL_EXE` or `TA_EXE` is not set. The proper `dune runtest` and
  `dune test` paths passed.
