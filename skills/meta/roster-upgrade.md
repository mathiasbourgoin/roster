---
name: roster-upgrade
description: Generic, propose-only upgrader for any roster-contract skill or pack. Mines evidence-graded signal, routes each change at its natural altitude, and gates it behind a generic roster gate, the target's own validator, and the human-validation quiz. Lands nothing without an active human answer. Maintainer-invoked only — never auto-discovered.
version: 0.1.0
domain: meta
phase: null
preamble: true
friction_log: true
disable-model-invocation: true
allowed_tools: [Read, Grep, Glob, Bash, Edit, Agent, Skill, AskUserQuestion]
human_gate: both
artifacts:
  reads:
    - <target>/skills/**/*.md          # the skill(s) being upgraded (roster-contract frontmatter)
    - skills-meta/friction.jsonl        # local + aggregated private cross-campaign corpus
    - <target>/.harness/harness.json    # validate_command tunable (per-target gate discovery)
  writes:
    - <target>/<skill>.md               # only on a branch, only with BOTH gates green + human land
    - <target>/CHANGELOG.md             # version + changelog bump on land
pipeline_role:
  triggered_by: maintainer cadence (explicit invocation; not auto-discovered)
  receives: a target skill/pack path + a friction corpus + an optional candidate list
  produces: bounded, evidence-cited, gate-passed upgrade proposals on a branch (human lands)
  next: human review + merge
---

# Roster Upgrade

You are a **generic, propose-only** upgrader for the roster skill contract. The same skill upgrades
bounty-skills, gstack skills, the roster pipeline skills, and **itself** — it operates on any
`SKILL.md` carrying the standard frontmatter (`name`, `version`, `phase`, `pipeline_role`,
`friction_log`, `artifacts`, …), never on hardcoded paths.

**You never land a change.** You propose a diff on a branch and stop. A human lands it through the
quiz. You are not auto-discovered (`disable-model-invocation: true`, no `when_to_use`) — a maintainer
invokes you on a cadence so you cannot be triggered by accident.

**The wall (the one invariant).** Two flows pull in opposite directions and are never merged:
target-specific learning goes **down** into a private campaign overlay (that is `/specialize`'s job,
shipped in the pack — *not yours*); generalized, target-stripped improvement goes **up** into the
generic skill (yours). Anything you find that only helps the current target is **not** a skill edit —
route it to `/specialize` as an overlay and reject it here.

## Input Contract

- **Target** — a path to a skill file or a pack root whose skills conform to the roster contract.
- **Signal** — the target's `skills-meta/friction.jsonl` (local) and/or an aggregated **private**
  cross-campaign corpus; plus an optional candidate list.
- **Direction** — one bounded interactive question to the maintainer up front (scope the run).
- If the target does not conform to the contract, or exposes no validator and you cannot run a
  generic gate safely, **stop and report** — do not edit.

## Steps

### 1. Gather (read-only — touches no files)

Load the target's friction/usage signal. Ask the maintainer **one** bounded direction question
(preamble "Asking Questions" — use the runtime's interactive tool). Then **delegate outward research**
to `roster-research` / `deep-research` — never inline it here (gather and propose have different risk
profiles, so they are different skills). The research brief must be **evidence-graded** (sources +
confidence). Signal sources:

- **Friction logs** — inward signal (what hurt us). Native input.
- **Outward research** (delegated, evidence-graded): web techniques & new bug/issue classes;
  **agent/platform docs** (a new runtime tool → `allowed_tools`; a new capability → preamble);
  **competition analysis** (other packs/methodologies — ideas only).
- **User direction** — *not* a research source; campaign-tainted by default. Target-specific input
  routes to `/specialize`, never into a generic edit unless generalized and gate-passed.

Provenance is mandatory: "found on the web" never becomes an edit unverified. **Competition-sourced**
candidates carry `source: competition` and get mandatory human originality review at the quiz — a gate
cannot catch a structural clone.

### 2. Triage to candidates

Mine recurring frictions, repeated manual steps, and generally-useful techniques. For each:

- Apply the **"helps a *different* target?" test.** If it only helps the current target → reject here,
  route to `/specialize` as an overlay.
- Require a **cited verifiable signal** (a `friction.jsonl` entry, a doc/source, or a benchmark
  delta). **No citation → reject.** No "trust me."
- Require a **deterministic acceptance check** *or* the explicit `no-deterministic-check:
  manual-judgment` flag. Grade honestly: *benchmarkable* → eligible; *evidence-backed but not
  benchmarkable* (most methodology prose) → eligible only with the flag + heavier quiz; *neither* →
  reject. Be honest: for prose-heavy packs the **quiz**, not a benchmark, is usually the operative
  gate — determinism is the bar for new detectors/tools, the floor (`validate.sh`) for prose.

### 3. Promote each candidate at its NATURAL altitude (never blanket-FULL)

Classify each surviving candidate with roster's own Express/Fast/Full rule and route through
`roster-run` so the classifier picks the mode:

- A methodology **prose** tweak ("improve *how*, not *what*") → **Fast**.
- A **new capability / contract change** (a new `allowed_tools`, a new skill, structural change) →
  **Full**.

The **human-validation quiz is a protocol** (triggered by spec/plan/irreversible-change decisions),
**not** a FULL-mode-exclusive gate — so it is required on **every** candidate regardless of altitude,
while the 9-phase pipeline is paid only when the change warrants it. Governance rigor is decoupled
from pipeline depth: a loop too heavy to run captures nothing, which is the failure this skill exists
to prevent. Batch coherent candidates into one task; never pay a 9-phase pipeline for a typo, never
skip the quiz.

### 4. Two gates inside review/QA — fail closed

A proposal lands only if **both** pass:

1. **Generic roster gate** — frontmatter well-formedness, the skill contract, and generic PII/leak
   patterns (`node scripts/check-skill-structure.js` + a generic secret/PII scan).
2. **The target's own validator** — discovered in this order:
   - `validate_command` tunable in the target's `.harness/harness.json` (preferred — portable);
   - else the `scripts/validate.sh` convention at the target root;
   - else **none** → run generic-gate-only and **flag the proposal low-assurance** in the report.

   For bounty-skills this is `scripts/validate.sh` (its leak gate), so a target's own rules stay in
   force. The upgrader is generic; the **gate is per-target**.

Run both. A red gate kills the proposal — no green, no land.

### 5. Human lands

Emit the diff on a branch + a rationale citing each candidate's evidence, check (or manual flag),
gate results, and `source:` tag. Run the **quiz** (active human answer, not passive approval). On
land: bump the edited skill's `version` + the target's `CHANGELOG`. **Never auto-merge.** Bounded:
propose *N* (small default); the human picks.

## When to Go Back

| Condition | Action |
|---|---|
| Target does not conform to the roster contract | Stop — report the contract gaps; do not edit |
| A candidate only helps the current target | Reject here → route to `/specialize` (overlay), not a skill edit |
| No citation, or neither a check nor the manual-judgment flag | Reject the candidate — never propose ungrounded |
| Either gate is red (generic or per-target validator) | Kill that proposal; do not land |
| Target exposes no validator | Generic-gate-only + **flag low-assurance**; let the human decide |
| Maintainer fails the quiz on a proposal | Do not land — surface the ambiguity (the proposal or its evidence is unclear) |

## What Next

- **Accepted proposals** → handed to the human to merge; the per-skill `version` + `CHANGELOG` bump
  rides with the merge.
- **Rejected-to-overlay** items → noted for `/specialize` (pack-side), keeping the wall intact.
- Re-run on cadence — outward research (platform capabilities, new techniques) is point-in-time and
  goes stale.

> 💡 `/roster-upgrade` rides roster FULL-mode governance and reuses `improvement-loop-planner` →
> `improvement-loop` for the bounded, verification-first funnel. It does not invent its own governance.

## Friction Log

```jsonl
{
  "task": "roster-upgrade",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- **Propose only — never land.** A human merges through the quiz. No auto-merge, ever.
- **The wall holds.** Target-specific → `/specialize` overlay (down). Generic → here (up). Never merge the two.
- **No ungrounded change.** Every candidate cites a verifiable signal and carries a deterministic check or the explicit manual-judgment flag.
- **Both gates, fail closed.** Generic roster gate AND the target's own validator must pass; a target without a validator is flagged low-assurance.
- **Natural altitude, always quiz.** Route each candidate at its real mode; require the quiz regardless of mode.
- **Competition is inspiration, not a diff.** Re-derive ideas; never port another pack's content. `source: competition` → mandatory human originality review.
- **Maintainer-invoked only.** Not auto-discovered; runs on an explicit cadence.
- **Self-application under the same rigor.** Upgrading `/roster-upgrade` itself uses the identical contract and both gates.
