---
name: roster-formal-verify
description: Formal verification gate — tool resolution via capability tag, roster re-runs coqchk/.itf replay directly, emits E0p/E0m/E0m-abstract evidence tier. Replaces the QA gate for --critical tasks.
version: 1.0.0
domain: pipeline
phase: null
preamble: true
friction_log: true
artifacts:
  reads: ["specs/<slug>.v OR specs/<slug>.qnt", "briefs/<slug>-formal-triage.md"]
  writes: ["briefs/<slug>-formal-verify.md"]
---

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

Downgrade is always available, always explicit, always logged.

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

If E1 downgrade: log in the ship artifact and continue to standard review → qa → ship.

## Rules

- Roster runs the checker — never trust a skill's self-report of "verified"
- E0p requires `coqchk` exit code 0 on the produced `.vo`
- E0m requires connect bridge replay exit code 0 on a committed `.itf.json`
- E0m-abstract is valid but must be flagged as incomplete in the ship artifact
- Downgrade to E1 is always available, always explicit, always logged
- A non-zero exit from the checker routes back to implement — never to ship

## When to Go Back

| Condition | Action |
|---|---|
| `specs/<slug>.v` or `specs/<slug>.qnt` absent | Stop — run `/roster-spec-formal` first |
| `briefs/<slug>-formal-triage.md` absent | Stop — run `/roster-triage-critical` first |
| Checker exits non-zero (coqchk failure or connect bridge replay failure) | Return to `/roster-implement` with the failure output; do not continue to review/ship |
| No formal skill found and scaffold declined | Downgrade to E1 — log in ship artifact and continue to standard review → qa → ship |

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
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null,
  "event": null
}
```
