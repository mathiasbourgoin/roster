# Chamallaw + Roster : installation locale

This installs a no-effect decision shadow beside the normal Roster pipeline.
It does not let Chamallaw choose a route, verify its own labels, or authorize
work.

## Prerequisites

You need a Roster project with `.harness/harness.json`, a local
`chamallaw-decision` MCP configured for the agent runtime, and an active
Chamallaw decision contract in the MCP's fixed scope. The contract ID is owned
by the project owner; do not use a draft ID.

Start the server without mutation capabilities for the first observation
period. It needs a DB already initialized/migrated by a trusted Chamallaw host:

```bash
chamallaw-mcp \
  --database-uri sqlite3:/absolute/path/chamallaw-roster.db \
  --scope-kind project --organization-id 7 --project-id 42
```

## Install

From this Roster checkout, run:

```bash
bash scripts/install-chamallaw-roster.sh \
  --target /absolute/path/to/roster-project \
  --contract-id 12
```

The installer copies the two skills into `.harness/skills`, writes the fixed
contract mapping `.harness/chamallaw-shadow.json`, installs post-`roster-intake`
and post-`roster-ship` skill hooks, updates `harness.json`, and reprojects
Claude/Codex/OpenCode surfaces. It refuses to overwrite local hook or config
files; review them and use `--force` only for an intentional replacement.
Inspect without writing with `--dry-run`.

Commit the resulting `.harness`, `.agents`, `.claude`, `.opencode`, and
configuration files to the Roster project.

## Runtime behavior

After a deterministic intake, the post-intake hook asks the runtime agent to
run `chamallaw-shadow`. It calls only read tools and writes
`roster/<task>/chamallaw-shadow.md`; `Routing changed: no` is mandatory.

After a ship, the post-ship hook may request `chamallaw-feedback` only if the
task has an independently observed binary result, durable evidence reference,
and RFC3339 observation time. Feedback submission requires the server's
explicit `--allow-outcome-submission` capability and records `Submitted` only.
A distinct trusted validator must later verify or reject that evidence through
the Chamallaw library; only `Verified` events affect the model.

## Evaluate

Before collecting observations, copy and tailor the evaluation shape:

```bash
cp examples/chamallaw-shadow-evaluation.json \
  /absolute/path/to/roster-project/roster/chamallaw-shadow-evaluation.json
```

After its predeclared period:

```bash
npm run report:chamallaw-shadow -- roster
npm run gate:chamallaw-shadow -- roster roster/chamallaw-shadow-evaluation.json
```

The gate can return only `eligible_for_human_review`. It never promotes a route
or enables automation.
