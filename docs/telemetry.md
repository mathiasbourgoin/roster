# Local commit telemetry

Roster telemetry runtime **1.0.0** and `/roster-telemetry` skill **1.0.0** add optional,
agent-reported commit trailers. Nothing is transmitted to a telemetry service. Committing
and pushing makes the enabled metadata visible to repository readers.

## Installation and configuration

`init-harness.sh` silently installs and activates owned hooks in the current Git worktree.
`roster-init` and full `roster-doctor` do the same; preflight/status remain read-only with
respect to hook setup. Explicit disable persists. Custom hooks or unrelated hooksPath cause
an actionable conflict, never replacement. No implicit package installation or download.

```sh
node scripts/roster-telemetry.js install --root /path/to/project
node .harness/bin/roster-telemetry.cjs status
node .harness/bin/roster-telemetry.cjs configure --enabled false
node .harness/bin/roster-telemetry.cjs configure --enabled true --policy advisory --tokens false
# Update using the trusted NEWER local source, not an old installed copy:
node /path/to/roster/scripts/roster-telemetry.js update --root /path/to/project
```

The versioned `.harness/telemetry.json` records schema_version 1, enabled (true by default),
policy (advisory by default), and a fields object with elapsed_seconds, tokens, agents, mode,
formal booleans (all true by default). This is project policy. Git activation is local to each
worktree; new clones/worktrees must run init or doctor. Activation is not merely file presence:
status checks hooksPath, wrapper bytes, execute permissions and runtime version.

`configure --enabled false` makes wrappers no-ops; it does not remove unrelated hooks or erase
historical commits. There is no attempt to chain arbitrary hooks automatically. Integration with
Husky or another hooksPath owner requires a reviewed manual dispatch arrangement.

## Report format (schema version 1)

Stage first, then create a template with `report <task>` and fill it from actual evidence:

```json
{
  "schema_version": 1,
  "task": "commit-telemetry",
  "harness_version": "1.0.0",
  "staged_tree": "<git write-tree output>",
  "elapsed_seconds": null,
  "input_tokens": null,
  "output_tokens": null,
  "agents": null,
  "mode": "full",
  "formal": { "status": "not-used", "backend": null }
}
```

Store at `.harness/.local/commit-report.json`; installation adds the local directory to Git's
local info/exclude. No raw transcripts, prompts, secrets or provider credentials are needed.
All keys are required; unknown measurements are null, not zero. task and agents use safe
1–80-character identifiers. Participants are actual agent role names, not planned membership.
Mode is express/fast/full or null. Formal status is not-used/specified/verified/unavailable,
with backend rocq/quint required for specified/verified. Verification needs actual successful
checker evidence for the candidate; field validation alone cannot authenticate that assertion.

Time and token counters are cumulative for a task, including amendments. Input includes cached
input without double counting. The runtime never sums old totals into new ones. The staged tree
and current harness version must match. Retain measurement provenance separately in local evidence.

## Commit metadata

prepare-commit-msg idempotently replaces only terminal owned trailers, preserving commit-body
examples and positioning metadata before comments/scissors cleanup. commit-msg checks consistency.
reference-transaction verifies prepared final metadata and the actual amendment parent relation
before a matching prepared commit updates its ref (including --amend -m/-F, without mistaking
ordinary -C message reuse for an amendment). Its ignored local commit-intent.json binds the
prepared Git process (parent PID, plus process start identity on procfs platforms), HEAD, staged
tree and expected fields. Abandoned/malformed receipts do not inspect unrelated ref transactions;
disabled telemetry does not parse receipts. The process binding is consistency bookkeeping, not
an authenticated identity. Folded continuation lines are invalid for owned single-line trailers.

The installed runtime uses .cjs so it can start in ESM consumers without changing the module
semantics of any neighboring consumer script. Layouts with shared core.bare:true/core.worktree
that require config migration are refused before modification; migrate them explicitly first.

Example trailers:

```text
Harness-Telemetry-Version: 1.0.0
Harness-Version: 1.0.0
Harness-Task: commit-telemetry
Harness-Metrics-Source: agent-reported-cumulative
Harness-Mode: full
Harness-Formal: not-used
```

Available enabled measurements also produce Harness-Elapsed-Seconds, Harness-Input-Tokens,
Harness-Output-Tokens and Harness-Agents (comma-separated). Unknown/disabled fields are omitted.
Advisory permits a commit with warnings when its report is missing/invalid, removing old owned
trailers rather than recycling stale claims. Strict rejects invalid/missing reports and unavailable
enabled time/token metrics. In both policies, a known final contradiction after valid preparation
(e.g. changed amendment identity or metadata stripped by cleanup) is refused before publishing
the ref; missing advisory measurements still never require invention or block a commit.
Strict does not turn agent statements into authenticated measurements.
Same-task totals cannot decrease relative to HEAD. Amend preserves the prior recorded task.
Counters are cumulative snapshots: do not sum trailers across a task's commits to get its total.

Local hooks can be bypassed: --no-verify skips commit-msg but not prepare-commit-msg; overriding
core.hooksPath can skip all three. No CI/provider attestation is implied. Existing advisory
`skills-meta/cost.jsonl` snapshots remain separate and must not be blindly added to these counters.

## Tests

`node --test scripts/roster-telemetry.test.js` exercises real commits, strict/advisory policies,
field controls, stale reports, amendments, conflicts and linked worktree isolation. The suite
is included in `npm test`. It does not claim that a particular runtime exposes native UI controls.
