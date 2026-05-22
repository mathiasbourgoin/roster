# TA Dashboard Roster Metadata QA - 2026-05-22

## Verdict

PASS after local and independent QA.

## Automated Checks

- `dune runtest --no-print-directory`: pass.

## Automated Coverage

- `Roster_index` parses display name, description, domain, tags, path, and
  source for agent entries.
- Dashboard model enrichment attaches roster metadata without changing counts.
- Dashboard rendering keeps ACL text visible after adding the roster column.
- Selected preview renders full roster metadata.
- `tactl dashboard render --roster-index` renders enriched metadata.
- `tactl dashboard render-socket --roster-index` renders enriched metadata.

## Manual Tmux Evidence

A disposable two-agent workspace was launched with `tactl launch start --state`.
QA then ran:

```text
tactl socket serve --socket <socket> --state <state>
tactl dashboard render-socket --socket <socket> --actor lead --roster-index <fixture-index> --key r --key Down --width 120 --lines 20
```

Observed result:

```text
loop23 live tmux QA passed: socket dashboard roster metadata and live preview verified
```

The smoke verified:

- Agent rows included compact roster hints such as `QA/testing`.
- The selected preview included
  `Roster: QA | domain testing | source local | tags qa,tmux`.
- The selected preview showed `Preview: loop23/qa`.
- The selected preview contained live `qa-roster-ready` pane output.
- ACL text such as `R:qa W:-` remained visible.
- The disposable tmux session, socket server, and temporary files were cleaned
  up.
- Independent QA repeated focused tests, state and socket CLI checks, bad roster
  path checks, live tmux rendering, redaction checks, and cleanup verification
  with no findings.
