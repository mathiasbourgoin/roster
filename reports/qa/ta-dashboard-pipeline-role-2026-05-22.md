# TA Dashboard Pipeline Role QA - 2026-05-22

## Verdict

PASS after local and independent QA.

## Automated Checks

- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.

## Automated Coverage

- Parser covers CRLF, duplicate last-write-wins, termination at the next
  top-level key, and missing required fields.
- Enrichment skips remote, absolute, parent-directory, and name-mismatched
  entries without attaching pipeline metadata.
- `tactl dashboard render --roster-index` displays pipeline detail lines.
- `tactl dashboard render-socket --roster-index` displays pipeline detail lines
  after socket snapshot decode.
- Raw `dashboard-snapshot` JSON is asserted not to contain frontmatter,
  profile, or pipeline detail metadata.

## Manual Tmux Evidence

Local QA launched a disposable two-agent tmux workspace, served it through the
TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --roster-index test/fixtures/roster-index.json --key Down --width 120 --lines 20
```

Observed result:

```text
loop25 live tmux QA passed: pipeline detail, raw socket boundary, ACL, and redaction verified
```

The smoke verified:

- selected QA preview showed `Pipeline`, `Receives`, `Produces`, and
  `Human gate` detail.
- selected QA preview captured live `qa-pipeline-ready` tmux output.
- ACL text such as `R:qa W:-` remained visible.
- raw `socket request ... dashboard-snapshot` output did not contain
  frontmatter/profile/pipeline metadata.
- rendering as actor `qa` did not show hidden lead metadata, pipeline text, or
  lead preview output.
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

Independent QA repeated focused CLI/socket/core tests, the broad suite, and a
live tmux socket smoke with the same boundary checks. No defects found.
