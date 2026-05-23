# Review: TA Import-Safe Index Tests

## Scope

Reviewed loop 57 changes that make `build-index` safe to import from tests.

## Findings And Fixes

No blocking findings. The CLI entrypoint is guarded by `require.main ===
module`, so imports no longer execute the index builder while direct
`build:index` execution still does.

## Final Result

Clean.

## Residual Risk

The root `index.json` hash check is documented and QA-verified but not encoded
as a repository-wide automated mutation guard. The entrypoint guard also relies
on the current CommonJS module setup.

## Verified

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `npm run -s build:index -- --output <tmp> --quiet`
- `git diff --check`
- `npm test` SHA check around `index.json` remained unchanged.
- tmux-backed MIAOU smoke for TA start and refresh.

Generated `index.json` remains unstaged.
