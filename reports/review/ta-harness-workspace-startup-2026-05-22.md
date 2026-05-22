# Review: TA Harness Workspace Startup

## Scope

Reviewed loop 42 changes for deriving a TA workspace config from
`.harness/harness.json`, startup resolution order, generated config shape, and
initial `tech-lead` selection.

## Findings

- Approved by the loop planner for the bounded harness-backed startup slice.
- Approved by independent code review.
- The implementation keeps generated config creation inside startup only when
  no TA config exists, so hand-written `.harness/ta.json` and `ta.json` remain
  authoritative.
- `Harness_ta_config` parses the canonical harness through structured JSON and
  existing typed identifiers rather than string-splicing a config file.
- `Workspace_config.to_yojson` makes generated config serialization use the
  same typed config model that validation consumes.
- Startup now chooses harness data before examples, so a real roster workspace
  does not accidentally show fixture agents.
- Tests now prove existing TA configs win over harness derivation and malformed
  harness JSON does not silently fall through to examples.
- `.gitignore` now excludes generated `.harness/ta.json`, `.ta-state.json`, and
  `.ta-state.json.lock`, avoiding a dirty tree from first launch.
- Independent review confirmed there are no blocking findings in the startup
  precedence, harness projection, generated file behavior, or `tech-lead`
  selection.

## Residual Risks

- Generated agents currently use a fixed `codex` command. The TUI needs a
  profile selector before this feels complete for Claude/OpenCode/Codex
  surfaces.
- Creation authority is inferred into coordinator ACLs for `tech-lead` and
  `recruiter`, but it is not yet shown as a first-class capability in the TUI.
- The generated `.harness/ta.json` is persistent but ignored. Future loops
  should add a clear regeneration/update path when the canonical harness
  changes.
- Defaulting the selected agent to `tech-lead` is global when that agent exists.
  This helps the TA workflow but should be revisited if generic workspaces need
  a different explicit default selection.

## Checks

- `opam exec -- dune build @all @runtest`
- `opam exec -- dune build @fmt`
- `opam exec -- dune build @doc`
- `npm test`
- `git diff --check`

## Decision

Approved for loop 42.
