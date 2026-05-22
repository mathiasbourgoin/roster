# TA Dashboard Viewport Height Review - 2026-05-22

## Verdict

PASS after local review, independent review, and QA.

## Review Notes

- `Dashboard_viewport.height` makes positive height validation explicit before
  clipping.
- Height clipping is applied after `Dashboard_interaction.render` composes
  refresh and dashboard content, so status lines are included in the row budget.
- Existing render behavior remains unbounded unless `--height` is supplied.
- `ta`, `tactl dashboard render`, and `render-socket` share the same height
  parser and pure clipping path.
- Tests cover the pure module, interaction rendering, state CLI, socket CLI,
  and `ta` entrypoint.
- Independent review reported no blocking findings. Its only residual test gap,
  direct `render-socket --height 0` coverage, was closed with a socket CLI
  regression test.

## Verification

- `dune build @all --no-print-directory`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.

## Residual Risks

- The current clipping policy is top-preserving and simple. Future UI work may
  want section-aware clipping that prioritizes selected preview/action detail.
