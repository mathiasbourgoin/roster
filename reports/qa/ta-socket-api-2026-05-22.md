# TA Socket API QA - 2026-05-22

## Verdict

PASS.

## Checks

- `dune runtest`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Root `npm test`: pass, 32 Node tests and all 25 agent files.
- No socket server, socat, or tmux processes remained after QA.

## Socket Evidence

Manual smoke created a disposable state snapshot, served it once through a Unix
socket, and requested `state-show`.

```text
client=0
server=0
CLIENT_OUT:
TA state snapshot: 1 workspace(s), 2 agent(s), 1 audit event(s)
- fixture: 2 agents, 1 links
Workspace fixture (Fixture)
  root: .
  active_view: agents
  Agents:
  - lead [not-started] roster=tech-lead pane=-
  - qa [not-started] roster=qa pane=-
Recent audit:
  #1 fixture actor=system workspace-loaded
CLIENT_ERR:
SERVER_OUT:
SERVER_ERR:
```

## Timeout Evidence

A long-running server received a client that connected without sending a
request. The client received a protocol failure after the bounded timeout, and
the same server then served a valid `state-summary` request.

```text
BAD_OUT:
{"ok":false,"error":"request timed out"}
CLIENT_OUT:
TA state snapshot: 1 workspace(s), 2 agent(s), 1 audit event(s)
- fixture: 2 agents, 1 links
```

## Independent QA Agent Evidence

The QA agent independently verified `state-summary` and `state-show` through
`tactl socket serve --once`, confirmed empty server stdout/stderr, confirmed the
socket path was removed after exit, and cleaned the temp directory.

## Notes

`index.json` remains dirty after root `npm test`; it is generated output and was
left out of the loop commit.
