# TA Dashboard Pipeline Overview QA - 2026-05-22

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

- Dashboard model rendering includes the pipeline overview section, contract
  flags, ACL disclaimer, and ACL edge rows.
- State dashboard CLI rendering includes the pipeline overview with roster
  contract metadata.
- Socket dashboard CLI rendering includes the same overview after actor-scoped
  snapshot decode and client-side roster enrichment.
- Negative model coverage proves natural-language pipeline text does not create
  an ACL edge without a declared link.
- Socket CLI coverage proves actor `qa` does not see hidden lead overview rows
  or ACL rows.

## Manual Tmux Evidence

Local QA launched a disposable two-agent tmux workspace, served it through the
TA Unix socket, and rendered:

```text
tactl dashboard render-socket --socket <socket> --actor lead --roster-index test/fixtures/roster-index.json --key Down --width 120 --lines 20
```

Observed result:

```text
loop26 live tmux QA passed: pipeline overview, ACL labelling, preview, and redaction verified
```

The smoke verified:

- `Pipeline overview` rendered with contract flags.
- the ACL disclaimer labelled rows as declared links, not inferred workflow
  order.
- selected preview still showed pipeline detail and live `qa-overview-ready`
  tmux output.
- rendering as actor `qa` hid lead overview rows, lead ACL rows, and lead pane
  output.
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

Independent QA repeated focused dashboard/socket tests, the broad suite, and a
live tmux socket smoke with raw socket metadata and actor-redaction checks. No
defects found.
