# TA Dashboard Frontmatter Metadata QA - 2026-05-22

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

- Frontmatter parser accepts CRLF, inline arrays, quote stripping, and ignores
  nested indented YAML.
- Frontmatter parser rejects missing opening or closing markers.
- Roster enrichment overlays local matching frontmatter and skips remote or
  name-mismatched entries.
- State dashboard rendering shows frontmatter profile, compatibility, and role
  metadata.
- Socket dashboard rendering shows the same metadata after actor-scoped socket
  snapshot decode.

## Manual Tmux Evidence

Local QA launched a disposable two-agent tmux workspace, served it through the
TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --roster-index test/fixtures/roster-index.json --key Down --width 120 --lines 20
```

Observed result:

```text
loop24 live tmux QA passed: frontmatter metadata, live preview, ACL, and socket redaction verified
```

The smoke verified:

- selected QA preview showed frontmatter domain, tags, profile, compatibility,
  version, author, isolation, and role text.
- selected QA preview captured live `qa-frontmatter-ready` tmux output.
- ACL text such as `R:qa W:-` remained visible.
- rendering as actor `qa` did not show hidden lead metadata or lead preview
  text.
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

Independent QA repeated focused deterministic tests, the broad suite, a live
tmux socket render, and actor-redaction checks with no defects.
