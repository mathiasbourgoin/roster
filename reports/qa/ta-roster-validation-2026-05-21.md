# TA Roster Validation QA - 2026-05-21

## Verdict

PASS.

## Checks

- `dune build`: pass.
- `dune build @install`: pass.
- `dune runtest`: pass, 11 tests.
- `ocamlformat --enable-outside-detected-project --profile=default --check ...`:
  pass.
- `dune exec -- tactl validate examples/ta.example.json`: pass.
- `dune exec -- tactl validate --roster-index ../../index.json
  examples/ta.example.json`: pass.
- Negative CLI check changing one `roster_agent` to `missing-agent`: expected
  failure, pass.
- `dune exec -- tactl tmux smoke --session ta-iteration2-qa-smoke`: pass.
- `opam lint`: pass.
- `npm test`: pass.

## Negative CLI Evidence

```text
$.workspaces[0].agents.tech-lead.roster_agent: unknown roster agent: missing-agent
```

## tmux Evidence

```text
ta-smoke-ready
```
