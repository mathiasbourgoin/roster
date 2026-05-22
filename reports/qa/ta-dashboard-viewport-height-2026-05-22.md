# TA Dashboard Viewport Height QA - 2026-05-22

## Verdict

PASS after automated checks, independent QA, and live tmux/socket smoke.

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

- Pure viewport height rejects non-positive values.
- Short frames remain unchanged.
- Long frames clip to the requested row count and include a clipping marker.
- `Dashboard_interaction.render` respects height after keyboard edge focus.
- `tactl dashboard render --height` respects row count and rejects `0`.
- `tactl dashboard render-socket --height` respects row count.
- `tactl dashboard render-socket --height 0` rejects before requiring a live
  socket server.
- `ta --height` respects row count and rejects `0`.

## Manual Tmux Evidence

Local QA launched a disposable two-agent tmux workspace, attached live panes,
served the state through the TA Unix socket, then ran:

```text
tactl dashboard render-socket --socket <socket> --actor lead --width 80 --height 12 --key p --key Right
```

Observed result:

```text
live render-socket viewport QA passed: session=ta-loop33-live-2127727 lines=12 lead=%0 qa=%1
```

The smoke verified:

- output row count was exactly 12;
- every rendered line stayed within 80 columns;
- the clipping marker was present;
- the socket server, tmux session, and temporary files were cleaned up.

Independent QA also verified the `--height` help surface for `ta`, `render`,
and `render-socket`, bad-height rejection on all render paths, state and socket
row counts, max line width at 80 columns, and tmux cleanup.
