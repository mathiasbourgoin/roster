# TA State Show QA - 2026-05-22

## Verdict

PASS.

## Checks

- `dune build @all`: pass.
- `dune build @install`: pass.
- `dune runtest`: pass.
- `ocamlformat --enable-outside-detected-project --profile=default --check ...`:
  pass.
- `opam lint`: pass.
- `dune exec tactl -- state save --output /tmp/... examples/ta.example.json`:
  pass.
- `dune exec tactl -- state set-status ... --status running --actor qa`: pass.
- `dune exec tactl -- state attach-pane ... --pane %88 --actor qa`: pass.
- `dune exec tactl -- state show --audit-limit 2 /tmp/...`: pass.
- `dune exec tactl -- state show --audit-limit=-1 /tmp/...`: pass as expected
  rejection.
- `dune exec tactl -- validate --roster-index ../../index.json
  examples/ta.example.json`: pass.
- `dune exec tactl -- tmux smoke --session ta-state-show-loop8-final`: pass.
- Root `npm test`: pass, 32 Node tests and all 25 agent files.

## tmux Evidence

```text
ta-smoke-ready
```

## Notes

`index.json` remains dirty after root `npm test`; it is generated output and was
left out of the loop commit.
