# TA Native Pane Targeting QA - 2026-05-22

## Verdict

PASS.

## Checks

- `dune runtest --no-print-directory`: pass.
- `dune build @all --no-print-directory`: pass.
- `dune build @install --no-print-directory`: pass.
- `opam lint agent-roster-agent-manager.opam`: pass.
- `ocamlformat --check --enable-outside-detected-project ...`: pass.
- `git diff --check -- . ':(exclude)index.json'`: pass.
- Root `npm test`: pass, 32 Node tests and all 25 agent files.
- No default tmux sessions remained after QA.

## Non-Default tmux Evidence

The local QA run used an isolated `TMUX_TMPDIR`, `base-index 7`, and
`pane-base-index 3`.

```text
tmux list-windows -t ta-loop12-qNXgzP -F "#{window_index}"
7

tmux list-panes -t ta-loop12-qNXgzP -F "#{pane_index} #{pane_id} #{pane_current_command} dead=#{pane_dead}"
3 %1 cat dead=0
4 %2 sleep dead=0

tactl state show --audit-limit 5 /tmp/ta-loop12.qNXgzP/state.json
Agents:
  - lead [not-started] roster=tech-lead pane=%1
  - qa [not-started] roster=qa pane=%2
Recent audit:
  #2 loop12 actor=system pane lead: %1
  #3 loop12 actor=system pane qa: %2
```

The lead agent had a startup prompt. Capturing pane `%1` showed the prompt in
that pane, proving prompts were sent to native pane ids rather than
`session:0.N` targets.

## Independent QA Agent Evidence

The QA agent also verified a separate isolated run with `base-index 3` and
`pane-base-index 4`.

```text
LAUNCH_STATUS=0
STATE_PANES=lead:%0 qa:%1
PANE_INDICES=lead:3.4 qa:3.5
SEND_KEYS_TARGETS=%0,%0,%1,%1
HARDCODED_TARGET_OUTPUT=session:0.0:%0 session:0.1:%0
PROMPT_TARGETS_MATCH_CAPTURED_PANES=yes
CLEANUP_TMPDIR_REMOVED=yes
```

## Notes

`index.json` remains dirty after root `npm test`; it is generated output and was
left out of the loop commit.
