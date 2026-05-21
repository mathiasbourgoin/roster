# TA Bootstrap QA - 2026-05-21

## Verdict

PASS.

## Checks

- `dune build @all`: pass.
- `dune build @install`: pass.
- `dune runtest`: pass, 9 tests.
- `ocamlformat --check src/lib/*.ml src/lib/*.mli src/bin/*.ml test/*.ml`:
  pass.
- `dune exec tactl -- validate examples/ta.example.json`: pass.
- `dune exec ta -- --config examples/ta.example.json`: pass.
- `dune exec tactl -- tmux smoke --session ta-bootstrap-smoke-final`: pass.
- `opam lint`: pass.
- `npm test`: pass.

## tmux Evidence

The tmux smoke command created a detached session, captured the pane, and
cleaned it up. Captured output:

```text
ta-smoke-ready
```

## Notes

- Dune executable commands should be run serially in this subproject; parallel
  `dune exec` calls can contend on the build lock and fail executable lookup.
- `index.json` was already modified before this work. Root `npm test` rewrites
  it through the existing `build:index` script, so it is excluded from this TA
  bootstrap commit.
