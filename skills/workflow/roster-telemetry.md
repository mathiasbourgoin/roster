---
name: roster-telemetry
description: Configure local commit telemetry, inspect hook activation and versions, disable collection or update the installed runtime.
when_to_use: "Use to configure or disable commit metrics, participant names, Roster mode and formal verification metadata. Trigger: '/roster-telemetry'."
version: 1.0.0
domain: workflow
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion]
tunables:
  enabled: true
  policy: advisory
  elapsed_seconds: true
  tokens: true
  agents: true
  mode: true
  formal: true
artifacts:
  reads:
    - .harness/harness.json
    - .harness/telemetry.json
  writes:
    - .harness/telemetry.json
---

# Roster Telemetry

Manage local commit metadata. No network transmission, package installation, global Git
configuration or provider authentication. Runtime version, skill version, harness version
and report/config schema versions are distinct.

## Steps

### 1. Runtime resolution

Read `.harness/harness.json` first. Prefer `scripts/roster-telemetry.js` when this is a
trusted Roster checkout; otherwise use `.harness/bin/roster-telemetry.cjs`. Invoke through
`node`, with `--root <project-root>` if not running at the project root. If neither exists,
locate a trusted local Roster checkout and run its runtime's `install --root <project-root>`.
If unavailable, report the missing distribution and stop; do not download or invent a runtime.

### 2. Interface

Run `status` and present effective activation, installed/available runtime versions, skill
version (frontmatter), current policy and collection fields. Native runtime UI is optional:
use a multi-select/checklist for fields, boolean controls if supported, or a numbered text
menu with explicit current values. Never claim plain text is an interactive toggle.

Offer:
1. Enable/disable collection (default enabled).
2. Select fields: elapsed time, tokens, actual participating agents, express/fast/full mode,
   formal specification/verification status (all enabled initially).
3. Advisory (default) or strict policy. Explain strict blocks commits when enabled time/token
   measurements are missing; advisory allows commits with explicit warnings and no fake values.
4. Update from a trusted local Roster runtime. Show installed and available versions first.
5. Show status / leave unchanged.

Apply the user's selection using `configure` with `--enabled true|false`,
`--policy advisory|strict`, `--elapsed_seconds true|false`, `--tokens true|false`,
`--agents true|false`, `--mode true|false`, `--formal true|false`. Example:

```bash
node .harness/bin/roster-telemetry.cjs configure --tokens false --agents true
node .harness/bin/roster-telemetry.cjs status
```

`configure --enabled false` leaves owned wrappers in place as no-ops, preserves all unrelated
hooks and is respected by init/doctor. Re-enabling installs/repairs owned wrappers. Custom
hooks/config conflicts require manual integration, never replacement. `update` must be run
using the newer trusted runtime (running an old installed runtime cannot discover a release).
Check effective `active`, not just file presence, after enable/update.

### 3. Commit report

After staging, use `report <task>` once to create `.harness/.local/commit-report.json` with
explicit nulls; it never overwrites an existing report. Fill/update the JSON with actual evidence
and refresh `staged_tree` using `git write-tree`. See `docs/telemetry.md` in Roster for the schema.
Never scrape unrelated session data or include prompts, credentials, user names or raw transcripts.

- Time/tokens: nonnegative cumulative task totals or null. Input includes cache reads/writes
  without counting them twice. Do not infer tokens from character counts. Preserve the measurement
  source in local evidence; trailers label all data agent-reported, not authenticated.
- Agents: unique safe role names actually invoked (including the executing role when known),
  not a planned team, model guesses or human identities; null if unknown.
- Mode: actual ledger mode express/fast/full, otherwise null.
- Formal: status not-used/specified/verified/unavailable, backend null/rocq/quint. A saved spec is
  not verification. Only report verified with a successful checker result tied to the candidate;
  this remains an agent assertion, not a cryptographic attestation.
- Amend and same-task follow-ups: cumulative totals, never deltas or adding previous totals twice.

A local report is not uploaded by this feature; enabled available fields become public to anyone
who can read the commit. Disabling a field does not rewrite historical commits. Git hooks are
bypassable (`--no-verify` skips commit-msg, not prepare-commit-msg; hooksPath overrides can skip
all three). `reference-transaction` checks final strict metadata and amendment identity before
a matching prepared commit updates HEAD. Only terminal trailers are owned; commit-body examples
remain untouched. Bare-parent/core.worktree layouts requiring shared-config migration are refused
without changing configuration. No local telemetry hook is a security or CI evidence gate.

## When to Go Back

On a hook conflict, missing trusted runtime or invalid existing configuration, stop the change
and report exact remediation. Never reset preferences or overwrite custom hooks to get green.

## What Next

Return to the caller with the applied settings. Configuration alone does not trigger ship.

## Friction Log

Append an honest phase entry using the canonical template in `skills/shared/preamble-friction.md`
(injected into the installed skill). Do not include
sensitive measurement evidence in the friction log.

## Output

Summarize changed settings and effective activation. Report conflict/missing-runtime states
explicitly. Do not perform commit/push operations for configuration alone.
