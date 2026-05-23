# Review: TA Visible Launch Profile

## Scope

Reviewed loop 49 changes for visible launch profiles, start preflight safety,
path handling, write-only redaction, and the default Enter-start flow.

## Findings And Fixes

- Blocker: write-only action targets could expose launch fields through action
  visible state. Fixed by stripping command, cwd, env, and startup prompt from
  write-only target placeholders.
- Blocker: start preflight only checked command drift. Fixed by checking
  command, configured cwd, env, startup prompt, workspace root, and tmux
  session.
- Blocker: workspace root/session drift could false-fail the simple default
  startup path because relative and absolute config paths derived different
  roots. Fixed with shared lexical path normalization across state bootstrap,
  launch planning, socket launch planning, `ta`, and `tactl`.
- Blocker: drift errors could leak command/env/prompt/root/session values to
  write-authorized but read-unauthorized actors. Fixed by redacting drift error
  payloads while preserving actionable workspace/agent error text.
- Blocker: leading relative parents such as `../..` were incorrectly collapsed
  by the path resolver. Fixed and covered with path resolver tests.

## Final Result

Clean. Final reviewer pass found no blocking findings.

## Verified

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`
- real tmux default `.harness/ta.json` MIAOU smoke for Enter start and live
  refresh

Generated `index.json` remains unstaged.
