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


# Roster Preamble

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction: present the recommendation,
explain why, state what context you might be missing, and ask — never act unilaterally.

### Escalation

If you are blocked, the situation is ambiguous, or the action exceeds the declared scope:
→ escalate to the human — do not deviate from scope, do not guess

### Asking Questions

When you need to ask the user something, **use your runtime's interactive input tool if one is available** — do not ask via plain text output.

Known runtime tool names:

| Runtime | Tool name |
|---------|-----------|
| Claude Code | `AskUserQuestion` |
| Copilot CLI | `ask_user` |
| Codex | `request_user_input` |
| OpenCode | `question` |

Rules:
- One question at a time — never bundle multiple questions into one message
- Prefer multiple-choice options over open-ended when the answer space is predictable
- If no interactive tool is available, output a clearly marked plain-text question and wait for the user's reply before proceeding


### Friction Log

**Write your entry when THIS phase ends — before you hand off, before you report, before you
stop.** Not at session end. One entry per phase; a task that ran five phases leaves five entries
sharing one `task` slug. Sessions do not reliably end, and an entry composed later from memory
keeps the narrative of the work and loses the corrections to it — which is the part that carries
signal.

Record honestly:
- **frictions** — workarounds, long searches, ambiguities, and every place a confident conclusion
  of yours was later refuted. A user correction is the highest-value entry there is; write it.
- **classes** — the closed vocabulary below, most load-bearing first.
- **methods** used, and any suggestion for a tool, skill, or adaptation.
- **skipped** — any mandated step this phase did not perform, as `"<step>: <reason>"`. A skipped
  step that goes unrecorded is indistinguishable from a step that ran. Omit the key if nothing
  was skipped; never omit it *instead of* admitting a skip.

A run with nothing to report is a **clean run**: `"frictions": []` and `"classes": []`. Log it.
Clean runs are the denominator — without them no rate can be computed, and "zero clean runs" is
then an artefact of the log rather than a fact about the work.

This is not a performance review. It is cross-run memory.

Canonical entry template (append to `skills-meta/friction.jsonl`; set `"skill"` to your
skill's name — extra documented fields like `class_note`, `event` or `mode` are allowed):

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",
  "task": "<task-slug>",
  "frictions": [],
  "classes": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

**Friction classes — closed vocabulary.** Pick by *remedy*, not by symptom:

`gate-vacuous` (a check passed while checking nothing) · `evidence` (a conclusion asserted
without, or against, the evidence) · `process-bypass` (a mandated step not performed, absence
unrecorded) · `missing-artifact` (a referenced file absent, untracked, or not installed) ·
`stale-tooling` (tool present but stale/misbehaving) · `agent-isolation` (worktree or
shared-checkout boundary damage) · `parallel-collision` (concurrent agents contending) ·
`schema-drift` (two artifacts disagree about a shape, or a contract is undocumented at the call
site) · `scope` (scoped too narrowly/broadly, or duplicating delivered work) · `git-mechanics`
(a git/forge operation whose real result differs from its reported one) · `human-gate` (a human
decision unavailable, deferred, or handed back) · `runtime-limits` (session limit, compaction,
killed job, rejected tool arity) · `external-dep` (third-party service or machine unavailable) ·
`positive-signal` (**not** a friction — a gate that worked, a discovery; excluded from
clustering) · `other` (requires a non-empty `class_note`).

The list above is the contract — it is injected into this skill, so it is readable wherever this
skill runs. Do not invent values: use `other` plus a `class_note`, which is how the vocabulary
earns its next entry.

Full definitions, one canonical instance per class, and the classification rules live in the
roster source at `schema/skill-schema.md` → *Friction classes*, where the vocabulary is closed
and validated by `scripts/check-friction-shape.js --log`. **That path resolves in the roster
repo, not necessarily in an installed harness** — if it is absent here, the list above is
complete and authoritative on its own; nothing above depends on opening it.


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
all three). `reference-transaction` checks prepared final metadata and amendment identity before
a matching prepared commit updates HEAD. Its local receipt is bound to the preparing Git process;
abandoned receipts cannot block unrelated resets, and disabled mode ignores even malformed ones.
Missing advisory measurements remain nonblocking, but neither policy publishes final metadata
known to contradict a valid preparation. Only terminal trailers are owned; commit-body examples
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
