# TA Launch Start QA - 2026-05-22

## Verdict

PASS.

## Checks

- `dune build @all`: pass.
- `dune build @install`: pass.
- `dune runtest`: pass.
- `ocamlformat --enable-outside-detected-project --profile=default --check ...`:
  pass.
- `opam lint`: pass.
- `dune exec tactl -- launch start --dry-run examples/ta.example.json`: pass.
- Real `tactl launch start` with temporary shell agents: pass.
- Captured tmux pane 0: `lead-ready` plus literal prompt evidence.
- Captured tmux pane 1: `qa-ready`.
- Duplicate-session dry-run validation: pass.
- Cleanup ownership failure-path smoke: pass.
- `dune exec tactl -- validate --roster-index ../../index.json
  examples/ta.example.json`: pass.
- `dune exec tactl -- tmux smoke --session ta-launch-start-loop10-final`: pass.
- Root `npm test`: pass, 32 Node tests and all 25 agent files.

## tmux Evidence

```text
ta-smoke-ready
```

## Notes

`index.json` remains dirty after root `npm test`; it is generated output and was
left out of the loop commit.
