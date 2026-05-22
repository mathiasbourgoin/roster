# TA Dashboard Pipeline Role Review - 2026-05-22

## Verdict

PASS after local and independent review.

## Review Notes

- `pipeline_role` metadata is parsed from local markdown only after the
  dashboard model has been built or decoded, preserving the socket boundary.
- The parser is deliberately narrower than YAML: leading frontmatter only,
  top-level `pipeline_role:`, indented scalar subfields, and all four required
  fields.
- Rendering is scoped to selected-agent detail lines; no graph inference or new
  navigation mode is introduced in this loop.
- Initial review found one parser bug: duplicate subfields were effectively
  last-non-empty-wins. This was fixed so duplicate keys are true
  last-write-wins and an empty final required value rejects the block.
- Initial review also asked for scoped-render assertions. Tests now verify the
  `Pipeline:` line appears exactly once in the preview detail.

## Verification

- `dune runtest --no-print-directory`: pass.
- Independent review:
  - `dune runtest --no-print-directory`: pass.
  - `git diff --check -- ':(exclude)index.json'`: pass.

## Residual Risks

- Current `pipeline_role` values are natural-language contracts. Future graph
  views must label inferred edges clearly or use additional structured
  metadata.
