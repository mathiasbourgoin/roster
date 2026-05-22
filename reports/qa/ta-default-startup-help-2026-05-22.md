# TA Default Startup And Help QA - 2026-05-22

## Verdict

PASS after automated checks, manual startup probes, independent QA, and tmux
smoke.

## Automated Checks

- `dune build @all`: pass.
- `dune runtest`: pass.
- `dune build @install`: pass.
- `dune test`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.

## Automated Coverage

- Startup path resolver prefers default state, then default config, then
  reports missing defaults.
- Startup guide includes the `dune exec ta` entrypoint, real workspace commands,
  bundled example commands, and `.harness/ta.json`.
- Empty temp workspace prints `TA quickstart`.
- Temp workspace with `.harness/ta.json` renders a config-backed dashboard.
- Temp workspace with `examples/ta.example.json` renders a dashboard through
  the source-tree fallback.
- `ta --help=plain` documents default startup and current MIAOU adapter status.
- `tactl quickstart` prints the startup guide.
- `tactl --help=plain` exposes `quickstart` and the dashboard start path.

## Manual Evidence

- `dune exec ta -- --width 92 --height 12` from `ocaml/agent-manager` rendered
  the dashboard from the bundled example fallback.
- `dune exec tactl -- quickstart` showed:
  - real workspace setup through `.harness/ta.json`;
  - bundled example setup through `ta.json`;
  - socket-backed dashboard commands;
  - current MIAOU adapter status.
- `dune exec tactl -- tmux smoke --session ta-loop34-final-smoke` printed
  `ta-smoke-ready` and cleaned up.
- Copy/save/dry-run probe:

```text
cp examples/ta.example.json ta.json
dune exec tactl -- state save --output /tmp/ta-loop34-state.json ta.json
dune exec tactl -- launch start --dry-run --state /tmp/ta-loop34-state.json ta.json
```

The dry-run output used `tmux ... -c .`, confirming the bundled example keeps
`root "."` at the package root when copied to `ta.json`.

Independent QA rechecked the final split guide and confirmed `dune exec ta`
still renders the dashboard from the package root.
