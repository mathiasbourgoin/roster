# TA Socket Mutations QA - 2026-05-22

## Verdict

PASS.

## Checks

- `dune test`: pass.
- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Root `npm test`: pass, 32 Node tests and all 25 agent files.
- No disposable socket server or tmux processes remained after QA.

## Manual Evidence

Socket `set-status` self-write through `lead` succeeded and persisted audit
event `#2`.

```text
client=0 server=0
TA state snapshot: 1 workspace(s), 2 agent(s), 2 audit event(s)
- fixture: 2 agents, 1 links

Agents:
  - lead [running] roster=tech-lead pane=-
Recent audit:
  #2 fixture actor=lead status lead: not-started -> running
```

A config with an explicit `lead -> qa [write]` edge allowed `lead` to update
`qa`, proving the positive cross-agent ACL path.

```text
Links:
  - lead -> qa [write] lead can update qa
Recent audit:
  #2 w actor=lead status qa: not-started -> running
```

## Independent QA Agent Evidence

The QA agent verified:

- `set-status` self-write: `lead` set `lead` to `running`.
- `attach-pane` self-write: `qa` attached `%88` to `qa`.
- Unauthorized write: `lead` trying to attach `%99` to `qa` was rejected with
  `actor lead cannot write agent qa in workspace fixture`.
- The state hash before and after the rejected mutation was identical.
- Final state had only the expected three audit events.

## Notes

`index.json` remains dirty after root `npm test`; it is generated output and was
left out of the loop commit.
