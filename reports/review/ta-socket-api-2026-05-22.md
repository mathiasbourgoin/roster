# TA Socket API Review - 2026-05-22

## Verdict

PASS after remediation.

## Findings Addressed

- `socket serve` originally removed any existing path before bind. It now
  removes only stale Unix socket files and fails if the requested socket path is
  an existing non-socket file.
- A client could previously block the synchronous server forever by connecting
  without sending a newline. Request reads now have a bounded timeout and maximum
  line size.
- Client read/write failures previously could escape into the server accept
  loop. Per-client I/O is now contained so long-running serving can continue.
- Tests were expanded to cover unknown commands, negative audit limits, and
  refusal to overwrite a regular file path.

## Verification

- Reviewer recheck: no remaining blockers.
- `dune runtest`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Manual socket smoke and independent QA: pass.

## Residual Risks

- The socket API is intentionally read-only in this loop.
- Concurrent clients and long-running daemon lifecycle management are still
  future work.
