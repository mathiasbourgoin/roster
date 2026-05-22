# TA Socket Runtime Snapshot Review - 2026-05-22

## Verdict

PASS after authorization remediation.

## Review Notes

- The socket endpoint delegates to `Runtime_snapshot.collect_agent`, so pane
  identity verification and preview trimming remain centralized while the API
  returns only the requested workspace/agent snapshot.
- `runtime-snapshot` responses are compact JSON strings inside the existing
  socket success envelope.
- The CLI and socket server both enforce positive preview lines and the
  `Runtime_snapshot.max_preview_lines` cap.
- Runtime previews now cap individual line bytes and total preview bytes before
  JSON serialization, keeping scoped socket responses under the one-line
  transport limit.
- The endpoint now requires `workspace`, `agent`, and `actor`, then authorizes
  either self-read or a workspace `Permission.Read` edge before returning pane
  previews.
- Earlier review feedback flagged the unscoped snapshot as a preview-disclosure
  bug. That blocker was addressed by actor scoping and read authorization.
- Follow-up review feedback flagged unbounded preview bytes and stale `--actor`
  help text. Both were remediated before commit.

## Verification

- `dune runtest --no-print-directory`: pass.
- Runtime snapshot tests cover long-line truncation and total preview byte caps.
- Manual `socket serve --once` runtime snapshot tmux smoke: pass for self-read,
  read-edge access, and denied actor access.
- Independent re-review after byte-cap remediation: pass, no new findings.

## Residual Risks

- Runtime snapshots still expose terminal preview text to authorized local
  socket clients. The future UI should treat previews as sensitive local data
  and keep using scoped actor requests rather than global snapshots.
