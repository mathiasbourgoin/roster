# TA Dashboard Runner Boundary QA - 2026-05-22

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

- First tick refreshes when the dashboard has never refreshed.
- Tick refresh waits until the configured interval after a success.
- Manual refresh preserves the selected agent.
- Refresh failure records cadence failure state and renders stale output.
- Quit suppresses later automatic refresh work.
- Runner render output includes cadence status and refresh reason lines.
- Opaque keys roundtrip, and unknown long keys remain no-op events for CLI
  compatibility.
- Existing `ta` and `tactl` dashboard CLI tests pass through the runner-backed
  replay path.

## Manual Tmux Evidence

Local QA and independent QA both launched disposable two-agent tmux workspaces,
served them through the TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --key r --key Down --width 120 --lines 20
```

Observed local result:

```text
loop27 live tmux QA passed: runner refresh and key navigation verified
```

The smoke verified:

- manual refresh did not produce a stale banner;
- `Down` selected `loop27/qa`;
- the selected preview showed live `qa-runner-ready` pane output;
- the pipeline overview and ACL rows still rendered;
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

## Notes

- Direct CLI test executable runs without Dune's test action are expected to
  fail if `TACTL_EXE` or `TA_EXE` is not set. The proper `dune runtest` and
  `dune test` paths passed.
