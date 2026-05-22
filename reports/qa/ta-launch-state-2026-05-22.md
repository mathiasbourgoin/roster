# TA Launch State QA - 2026-05-22

## Verdict

PASS.

## Checks

- `dune test`: pass.
- `dune build @all --no-print-directory`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass for touched
  OCaml files.
- Root `npm test`: pass, 32 Node tests and all 25 agent files.
- Independent QA agent ran `dune runtest`: pass.
- Real `tactl launch start --state` with disposable shell agents: pass.
- Native tmux pane ids matched persisted state snapshot panes: pass.
- State update failure cleanup smoke with unwritable state directory: pass.
- No disposable tmux sessions remained after QA.

## tmux Evidence

```text
tmux list-panes -t ta-loop11-postreview-wkmLpi -F '#{pane_index} #{pane_id} #{pane_current_command} dead=#{pane_dead}'
0 %0 sleep dead=0
1 %1 sleep dead=0

tactl state show --audit-limit 5 /tmp/ta-loop11-postreview.wkmLpi/state.json
Agents:
  - lead [not-started] roster=tech-lead pane=%0
  - qa [not-started] roster=qa pane=%1
Recent audit:
  #2 loop11 actor=system pane lead: %0
  #3 loop11 actor=system pane qa: %1
```

## Failure-Path Evidence

```text
/tmp/ta-loop11-cleanup.9SUtaH/state.json: ... Permission denied
launch-created tmux sessions cleaned up after state update failure
has_session_exit=1
```

## Notes

`index.json` remains dirty after root `npm test`; it is generated output and was
left out of the loop commit.
