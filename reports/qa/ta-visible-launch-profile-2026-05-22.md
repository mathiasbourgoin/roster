# QA: TA Visible Launch Profile

## Scope

Validated loop 49 launch-profile visibility across durable state, dashboard
rendering, MIAOU action labels, and real tmux startup.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- launch preflight rejects stale state/config launch drift for command, cwd,
  env, startup prompt, workspace root, and tmux session
- config paths are lexically canonicalized before state bootstrap and launch
  planning, including equivalent `/path/.` and `/path` roots
- path resolver coverage preserves leading relative parent segments such as
  `../..` while still normalizing absolute workspace paths
- stale-start drift errors redact command, env, startup prompt, root, and
  session details while still rejecting the launch
- write-only action targets redact launch command, cwd, env, and startup
  prompt
- socket launch/start authorization runs before launch preflight, preventing
  unauthorized actors from seeing state/config drift details

## Tmux Smoke

The manual smoke used a generated single-agent workspace backed by a real tmux
session. It covered both explicit config startup and the default
`.harness/ta.json` discovery path. The selected agent used shell commands such
as:

```text
sh -lc "printf loop49-ready; sleep 60"
```

Covered cases:

- Detached MIAOU action shows `Enter Start lead | shell` and compact command
  text.
- Agent detail shows a full `Launch` row before startup.
- Pressing Enter starts and attaches the real tmux pane.
- The default `.harness/ta.json` path starts without an explicit `--config` and
  does not trip workspace launch identity drift.
- Attached action remains `Enter Refresh | attached ...`.
- Manual refresh captures running pane output such as `loop49-ready` and
  `loop49-default-ready`.

## Result

Passed.

Generated `index.json` remains unstaged.
