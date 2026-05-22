# Review: TA Roster Harness

## Scope

Reviewed loop 38 harness changes: source agent additions, committed `.harness/`
state, OpenCode projection support, governance docs, and generated runtime
surfaces.

## Findings

- Resolved: `.harness/` was initially created but ignored by git. The loop now
  commits `.harness/` as this repository's canonical project harness, matching
  the approved direction.
- Resolved: harness schema and README examples mentioned shared harness support
  but did not show OpenCode in the runtime list or installed layout. Both now
  include OpenCode.
- Resolved: `init-harness.sh` previously validated only the Claude agent
  projection. It now validates OpenCode agent count, rule count, and
  `opencode.json` agent count during fresh installs.
- Resolved: OpenCode runtime support generated agents/config only while docs
  listed `.opencode/rules/`. `sync-harness.sh` now projects rules as well.
- Resolved: a fresh `init-harness.sh <project> developer` failed unless
  `--force` was passed because the script created `.harness/` before checking
  for an existing harness. The guard now runs before directory creation, and a
  scratch install without `--force` passes.
- Resolved: OpenCode projection no longer projects agents that do not declare
  `compatible_with: [..., opencode]`. The installed TA team declares OpenCode
  compatibility explicitly.
- Resolved: OpenCode permissions are no longer hardcoded by agent name in the
  projection script. `sync-harness.sh` reads `tunables.opencode_permission` from
  `.harness/harness.json`, with a deny-all fallback.
- Resolved: generated OpenCode `tech-lead` no longer receives `task`
  permission, matching the source agent's human-mediated spawning contract.
- Resolved: `AGENTS.md` now lists the `human-validation` governance rule.
- Resolved: OpenCode compatibility detection now handles both inline and
  multiline `compatible_with` frontmatter arrays.

## Checks

- `bash -n scripts/init-harness.sh scripts/sync-harness.sh`
- `jq '.' .harness/harness.json .claude/harness.json opencode.json`
- `./scripts/sync-harness.sh .`
- scratch `./scripts/init-harness.sh <tmp> developer`
- `npm test`
- `git diff --check`
- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`

## Decision

Approved for loop 38 after the independent reviewer findings above were fixed
and the local checks passed.
