# TA Runtime Snapshot Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- Runtime snapshots initially trusted any live `%pane_id`. State snapshots now
  persist the expected workspace tmux session plus tmux `#{session_id}` and
  `#{window_id}` for launch-discovered panes, and runtime snapshots verify that
  stronger pane identity before marking a pane live or capturing preview text.
- Runtime cache output initially used direct `Yojson.Safe.to_file`. The CLI now
  writes through an owner-only temp file and atomic rename, leaving cache files
  at mode `0600`.
- `--lines` was initially unbounded. The runtime snapshot module now exposes a
  hard max of `200`, and the CLI rejects larger requests.
- Dashboard previews now trim trailing blank screen rows while preserving
  interior blank lines.

## Review Notes

- Runtime observations are modeled separately from `State_store`, so live tmux
  failures do not mutate audited state.
- The snapshot runner is injectable, which keeps tmux behavior unit-testable
  without a real tmux server.
- `Tmux.Capture_pane` now accepts a general target, which matches tmux behavior
  and lets snapshots capture by native `%pane_id`.
- `Tmux.Display_pane_identity` provides the stronger native identity check used
  before `capture-pane`.
- CLI output can be consumed either directly from stdout or as an explicit cache
  file through `--output`.
- Invalid `--lines` values are rejected at the CLI boundary.

## Verification

- Independent reviewer recheck: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `dune test --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check`: pass.
- Root `npm test`: pass.
- Manual launched-workspace runtime snapshot tmux smoke with pane-identity
  verification: pass.

## Residual Risks

- The runtime snapshot is currently CLI-only. The next loop should expose the
  same model over the socket API for the dashboard.
- Pane previews are still terminal output and may contain sensitive data. Later
  UI work needs a display policy for redaction, opt-in visibility, or local-only
  cache handling.
