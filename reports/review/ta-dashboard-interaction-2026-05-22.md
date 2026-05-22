# TA Dashboard Interaction Review - 2026-05-22

## Verdict

PASS after independent review.

## Review Notes

- `Dashboard_interaction` keeps the MIAOU page boundary pure: state, key update,
  refresh preservation, and rendering are independent of terminal drivers.
- `Dashboard_model.render` now accepts an explicit selection, so renderer
  callers can mark the active workspace/agent and show the selected preview
  without duplicating model traversal.
- `tactl dashboard render --key` and `ta --key` make keyboard behavior
  deterministic and scriptable for QA until the concrete MIAOU runner is wired.
- The loop intentionally does not add a `miaou-tui` dependency yet because the
  package is not available in the current TA opam switch. The code follows
  MIAOU's state-view-handler shape so the next dependency step stays small.

## Verification

- `dune runtest --no-print-directory`: pass.
- Manual tmux dashboard interaction smoke: pass for selected live QA preview
  through both `tactl dashboard render` and `ta --state`.
- Independent review: pass, no findings. Reviewer also verified explicit
  `--workspace fixture --agent lead --key Down` selection through both CLIs.

## Residual Risks

- The interaction layer is still rendered as deterministic text frames. The
  concrete MIAOU runner, refresh ticks, and terminal event loop remain for a
  later branch.
