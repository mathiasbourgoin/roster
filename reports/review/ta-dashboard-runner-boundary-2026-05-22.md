# TA Dashboard Runner Boundary Review - 2026-05-22

## Verdict

PASS after local and independent review.

## Review Notes

- The runner is pure and dependency-free, keeping `miaou-tui` out of the opam
  package until the current switch can build that dependency directly.
- `Dashboard_runner` exposes private key values and typed key/tick events with
  a GADT boundary, while keeping refresh effects behind an injected source.
- Existing `ta` and `tactl` key replay now enter the runner when refresh
  callbacks are available, preserving existing selected-state behavior.
- Initial review found one compatibility issue: long CLI `--key` values were
  rejected where the previous interaction layer ignored unknown keys.
- The issue was fixed by making runner keys opaque but non-restrictive, adding
  explicit long/unknown-key coverage, and preserving CLI no-op behavior.

## Verification

- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Targeted `tactl` and `ta` CLI smokes with a 65-byte `--key`: pass; both exit
  zero, produce no stderr, and treat the unknown key as a no-op.

## Residual Risks

- The concrete MIAOU adapter is still future work. This loop deliberately
  landed the runner boundary first so the page adapter can be small and
  testable once `miaou-tui` is installed in the active switch.
