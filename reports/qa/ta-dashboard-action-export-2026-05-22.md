# TA Dashboard Action Export QA - 2026-05-22

## Verdict

PASS after automated checks, independent QA, review remediation, and live
tmux/socket smoke.

## Automated Checks

- `dune build @all --no-print-directory`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `npm test`: pass.

## Automated Coverage

- No focused edge exports `affordance: null`.
- Focused edge exports source endpoint, targets, selected target marker, read
  actions, focus actions, and actor-bound write actions.
- `--lines` flows into exported `runtime-snapshot` intents.
- Non-source actors do not receive `future-agent-message` write intents.
- Write-only selected targets suppress read and focus-pane intents.
- `tactl dashboard actions` exports parseable JSON after `--key p --key Right`.
- `tactl dashboard actions --actor lead` exports actor-bound write intents.
- Multi-target `--key ]` cycling is reflected in selected target JSON.
- `tactl dashboard actions-socket` requires `--actor` and exports parseable
  actor-scoped JSON through the existing socket dashboard snapshot path.
- Socket action export exposes write-only targets as selected, pane-less
  metadata with `future-agent-message` only; read and focus-pane intents remain
  hidden.
- Export JSON includes `refresh_status`, including stale refresh failures.

## Manual Tmux Evidence

Local QA launched a disposable three-agent tmux workspace, attached live pane
ids into a TA state snapshot, served it through the TA Unix socket, then ran:

```text
tactl dashboard actions-socket --socket <socket> --actor lead --key r --key p --key Right --key ] --lines 20
```

Observed local result:

```text
live actions-socket write-only QA passed: session=ta-loop32-live-2114629 lead=%0 writer-real-pane=%3
```

The smoke verified:

- JSON focus was `pipeline`;
- refresh status was `fresh`;
- selected edge source was `lead`;
- `]` cycling selected the write-only `writer` target;
- source endpoint pane id matched the live tmux pane;
- writer target endpoint pane was redacted despite a real attached pane;
- `runtime-snapshot` and `focus-pane` read intents were absent for `writer`;
- `future-agent-message` write intent was present for `lead -> writer`;
- the state snapshot hash was unchanged before and after export;
- the disposable tmux session, socket server, and temporary files were cleaned
  up.

Independent QA also probed state and socket exports with write-only targets and
stale socket refresh JSON. All focused probes passed without mutating state.
