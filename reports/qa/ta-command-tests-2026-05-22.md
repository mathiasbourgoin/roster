# TA Command Tests QA - 2026-05-22

## Verdict

PASS.

## Checks

- `dune build @all`: pass.
- `dune build @install`: pass.
- `dune runtest`: pass.
  - Core suite: 11 tests.
  - Command-level `tactl-cli` suite: 3 tests.
- `ocamlformat --enable-outside-detected-project --profile=default --check ...`:
  pass.
- `opam lint`: pass.
- `dune exec -- tactl validate --roster-index ../../index.json
  examples/ta.example.json`: pass.
- Direct command-level tests:
  - Plain validate: pass.
  - `--roster-index` valid config: pass.
  - `--roster-index` missing agent: expected rejection, pass.
- `dune exec -- tactl tmux smoke --session ta-iteration3-qa-smoke`: pass.
- Root `npm test`: pass, 32 tests and all 25 agent files.

## Negative CLI Evidence

```text
$.workspaces[0].agents.lead.roster_agent: unknown roster agent: missing-agent
```

## tmux Evidence

```text
ta-smoke-ready
```
