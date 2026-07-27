---
name: roster-formal-verify
description: Formal verification gate that re-runs the deterministic checker itself and emits an evidence tier.
when_to_use: "Use in place of the QA phase for --critical tasks needing machine-checked proof evidence. Trigger: 'formal verify', '--critical route QA'."
version: 1.0.2
domain: pipeline
phase: null
preamble: true
friction_log: true
artifacts:
  reads: ["specs/<slug>.v OR specs/<slug>.qnt", "briefs/<slug>-formal-triage.md"]
  writes: ["briefs/<slug>-formal-verify.md"]
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


# Roster Formal Verify

You are the verification gate for `--critical` tasks. You replace the standard QA phase. Your job is:
1. Resolve which formal tool to use (via `capability:` tag detection)
2. Delegate spec compilation/trace-generation to the formal skill
3. **Re-run the deterministic checker yourself** (roster reads the exit code — never trusts the skill's self-report)
4. Emit the evidence tier claim with full traceability

**Roster re-runs the checker. An E0 claim is backed by an exit code you observed, not prose.**

## Input Contract

```bash
[ -f specs/<slug>.v ] || [ -f specs/<slug>.qnt ] && echo "formal spec: ✅" || echo "formal spec: ❌"
[ -f briefs/<slug>-formal-triage.md ]             && echo "triage: ✅"      || echo "triage: ❌"
```

Read the triage brief to determine the chosen backend (`human_decision` field).

## Steps

### Stage 6 — Tool resolution

Scan `skills/pipeline/*.md` frontmatter for `capability: formal-rocq` or `capability: formal-quint`:

```bash
grep -l "^capability: formal-rocq"  skills/pipeline/*.md 2>/dev/null
grep -l "^capability: formal-quint" skills/pipeline/*.md 2>/dev/null
```

This is a deterministic file-presence + grep check. No LLM judgment.

**Resolution table:**

| Backend | Skill found? | Driver written? | Action | Evidence tier |
|---|---|---|---|---|
| Rocq | `capability: formal-rocq` found | n/a | Delegate compilation | E0p |
| Rocq | Nothing | n/a | Offer scaffold → on decline: E1 | E1 if declined |
| Quint | `capability: formal-quint` found | Yes (`.itf.json` exists) | Delegate trace generation | E0m |
| Quint | `capability: formal-quint` found | No driver yet | Proceed, flag missing driver | E0m-abstract |
| Quint | Nothing | n/a | Offer scaffold → on decline: E1 | E1 if declined |

**"Blocked" is not a terminal state.** If no skill is found, the scaffold offer resolves to either Delegate (scaffold accepted and run) or E1-downgrade (declined). The pipeline never halts in an unresolved state.

**`formal-apparatus` note:** If `formal-apparatus` is installed, it must carry `capability: formal-rocq` in its skill frontmatter. If it was installed without this tag, `roster-doctor` will warn. Patch the skill file before re-running this phase.

#### If no skill found — scaffold offer

```
No formal verification skill found for [Rocq/Quint] in this project.

Options:
  [1] Build one now — /roster-run --full scaffolds a verification skill
      for this project. One-time cost; all future --critical runs reuse it.

  [2] Use formal-apparatus (Rocq only) — install separately if you have access.
      Not open source — contact Nomadic Labs. Add capability: formal-rocq to
      its skill frontmatter after install.

  [3] Downgrade to --full — no formal verification. Evidence tier: E1.
      Logged in the ship artifact with reason.
```

Downgrade is always available, always explicit, always logged: on decline, record the E1
tier and the reason in the ship artifact and continue to the standard review → qa → ship
pipeline. This step owns the downgrade mechanics — other sections point here.

### Delegation + checker re-run

**Rocq path:**
1. Delegate to the resolved skill: instruct it to compile `specs/<slug>.v` and produce a `.vo` artifact.
2. **Roster re-runs `coqchk` directly:**
   ```bash
   coqchk <path-to-artifact>.vo
   # Gate on exit code 0
   ```
3. The E0p claim requires exit code 0 from this command — not from the skill's report.

**Quint path:**
1. Delegate to the resolved skill: instruct it to run `quint verify specs/<slug>.qnt` and confirm invariants hold.
2. **If a connect driver exists** — locate the `.itf.json` trace file and run the connect bridge replay:
   ```bash
   # ocaml-quint-connect:
   dune exec -- quint-connect run specs/<slug>.qnt [--driver <driver.cma>]
   # quint-connect (Rust):
   cargo test -- --nocapture
   # Gate on exit code 0
   ```
3. The E0m claim requires exit code 0 from the replay — not from `quint verify` alone.

**E0m-abstract path (no driver):**
- Run `quint verify specs/<slug>.qnt` and gate on exit code 0.
- The claim is E0m-abstract: model invariants verified; implementation correspondence is a manual argument.
- Flag the missing driver in the ship artifact as a follow-up item.

### Evidence tier claim

Record the evidence tier in `briefs/<slug>-formal-verify.md`:

```markdown
# Formal Verify — <slug>

**Date:** <ISO-8601>
**Backend:** <rocq|quint>
**Evidence tier:** <E0p|E0m|E0m-abstract|E1>

## Checker result

- Tool: <coqchk|quint-connect replay|quint verify>
- Command: `<exact command run>`
- Exit code: <0|non-zero>
- **Outcome: <PASS|FAIL>**

## E0 claim scope

**E0p claim:** proof term verified by `coqchk`; proposition traces to <US-N>;
proposition accuracy is conditioned on the ELI5/story mapping validated at the intake quiz.

**E0m claim:** model invariants verified by `quint verify`; trace replay passed against
implementation; model-to-implementation correspondence validated via connect bridge.

**E0m-abstract:** model invariants verified; no connect driver — implementation
correspondence is a manual argument. Follow-up: write connect driver for <component>.

**E1 (downgrade):** formal verification proposed and declined. Reason: <reason>.

## Proposition-to-story trace

| Proposition | Parent story | ELI5 |
|---|---|---|
| <prop_name> | US-N | "<ELI5>" |

## Next step
```

If the checker exits non-zero: escalate back to `/roster-implement` with the failure output. Do not continue to review/qa/ship.

If E1 downgrade: follow the scaffold-offer step's downgrade mechanics.

## Rules

- Roster runs the checker — never trust a skill's self-report of "verified"
- E0p requires `coqchk` exit code 0 on the produced `.vo`
- E0m requires connect bridge replay exit code 0 on a committed `.itf.json`
- E0m-abstract is valid but must be flagged as incomplete in the ship artifact
- A non-zero exit from the checker routes back to implement — never to ship

## When to Go Back

| Condition | Action |
|---|---|
| `specs/<slug>.v` or `specs/<slug>.qnt` absent | Stop — run `/roster-spec-formal` first |
| `briefs/<slug>-formal-triage.md` absent | Stop — run `/roster-triage-critical` first |
| Checker exits non-zero (coqchk failure or connect bridge replay failure) | Return to `/roster-implement` with the failure output; do not continue to review/ship |
| No formal skill found and scaffold declined | E1 downgrade — per the scaffold-offer step's mechanics |

## What Next

**E0p/E0m/E0m-abstract path (checker passed):** `/roster-review` (formal-verify replaces the QA gate; no separate `/roster-qa` on the E0 path)
**E1 downgrade path (formal verification declined):** `/roster-review` → `/roster-qa` → `/roster-ship`
**Checker failure:** `/roster-implement`

> **Note:** `roster-formal-verify` has `phase: null` — it does not append to `briefs/<task>-state.json`. The critical task runs as `mode: full` in the ledger; triage, spec-formal, and formal-verify are `phase: null` helpers that run between Full phases without participating in ledger sequencing. The E1 downgrade restores the standard `qa` phase in the pipeline.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-formal-verify",
  "task": "<task-slug>",
  "frictions": [],
  "classes": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null,
  "event": null
}
```
