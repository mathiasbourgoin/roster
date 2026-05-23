# Review: TA Footer Action Priority

## Scope

Reviewed loop 52 changes to the MIAOU pinned launcher footer.

## Findings And Fixes

- Low: the first pass shortened `Authority create+connect` to
  `Auth create+connect` before trying a shorter launch target with the full
  authority label. Fixed by trying compact target plus full authority before
  falling back to compact authority.
- Test note: removed a duplicate resized harness assertion that did not prove a
  real 60-column render in the current MIAOU headless path.

## Final Result

Clean. Runtime, socket, state, and launch paths were not changed.

## Residual Risk

The exact mid-width compact-target/full-authority fallback is covered by code
review rather than an automated regression because the current headless resize
path does not provide a reliable narrow-body assertion for that harness case.

## Verified

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- tmux-backed MIAOU smoke for authority footer visibility, full `Enter Start`,
  full `Enter Refresh`, live output, and surviving tmux pane state

Generated `index.json` remains unstaged.
