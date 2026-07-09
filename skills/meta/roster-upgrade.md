---
name: roster-upgrade
description: Propose-only upgrader for roster-contract skills — evidence-mined, gate-checked, human-landed diffs.
version: 0.1.2
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

**In one sentence:** you are propose-only behind two fail-closed gates, and the wall keeps
target-specific learning out of the generic skill (it routes down to `/specialize` overlays) —
the **Rules** section at the end is the canonical statement of all three.

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

### 3. Promote each candidate at its natural altitude

Classify each surviving candidate with roster's own Express/Fast/Full rule and route via `roster-run`:

- a methodology **prose** tweak ("improve *how*, not *what*") → **Fast**;
- a **new capability / contract change** (new `allowed_tools`, a new skill, structural change) → **Full**.

**Altitude controls pipeline depth/cost only — never whether the quiz fires.** The quiz is run by
**step 5 of this skill directly** (not left to the pipeline's `plan` phase, which is Full-only).
So a Fast candidate is just as quiz-gated as a Full one.
Batch coherent candidates; the §2 funnel (promote only evidence-backed, check-bearing candidates)
keeps cost down without skipping the quiz.

### 4. Two gates inside review/QA — fail closed

A proposal lands only if **both** pass:

1. **Generic gate.** Two checks:
   - **Leak scan (mechanical, generic):** run `bash scripts/check-leak-diff.sh <base-ref>` — it
     derives the file set from `git diff` (NOT a hand-picked argv) and runs `check-leak.js` over it,
     so a proposal cannot narrow the scan by omitting a file. Exit 1 (HIGH secret/credential) blocks;
     `WARN` (PII/blobs) feeds the low-assurance flag. This is the same script roster's CI runs on
     every PR; for an external target, wire it into THAT target's CI/pre-land hook. Catches only
     **literal** leaks, not semantic over-fit (human-judgment + quiz concern — see Enforcement status).
   - **Contract check (generic, per-file):** `node scripts/check-skill-contract.js <edited-skill>...`
     — buildless and dependency-free, it validates the roster skill contract (frontmatter `name`/
     `description`/semver `version`, `## Steps`, and the meta sections + `jsonl` friction log) on ANY
     target's `SKILL.md`, not just roster's own. Exit 1 kills the proposal. (Roster's repo-wide
     `check-skill-structure` still guards roster's own `skills/` in CI; this is the portable per-file
     version for external targets.)
2. **The target's own validator** — discovered in this order (resolve once, at the target root):

   ```bash
   GATE="$(jq -r '.project.validate_command // empty' "$TARGET/.harness/harness.json" 2>/dev/null)"
   [ -z "$GATE" ] && [ -f "$TARGET/scripts/validate.sh" ] && GATE="bash scripts/validate.sh"
   ```

   - `project.validate_command` in the target's `.harness/harness.json` (preferred — portable;
     see schema/harness-schema.md);
   - else the `scripts/validate.sh` convention at the target root;
   - else **none → STOP and report.** Do **not** "flag low-assurance and proceed": a proposal whose
     only per-target backstop is a sentence in a report is not fail-closed. No validator → no land.

   For bounty-skills this resolves to `scripts/validate.sh` (its leak gate); for a roster project it
   resolves to `validate_command` (e.g. `npm test`). The upgrader is generic; the **gate is
   per-target**, so each target keeps its own rules in force.

Run both. A red gate kills the proposal — no green, no land.

### 5. Human lands — run the quiz HERE (altitude-independent)

The quiz is run **by this step**, not delegated to the pipeline's `plan` phase (which only Full runs).
Running it here is what makes the quiz fire for every candidate regardless of mode. Follow
`rules/governance/human-validation.md`:

1. **Write the proposal to a file** — `docs/plans/roster-upgrade-<slug>-<date>.md`: the diff + a
   rationale citing each candidate's evidence, its deterministic check or manual-judgment flag, both
   gate results, and its `source:` tag. Tell the human the path.
2. **tl;dr** — 3-5 bullets that orient, not substitute for reading the file.
3. **Quiz** — 3-5 questions the human must *actively answer*. Exactly **one** is a consistency-check:
   a plausible-but-wrong option that contradicts the proposal, aimed at its highest-risk change.
   Format it **identically** to the others and **never label it** as a check/trap in any
   user-visible text. Gate on correct answers; a triggered consistency-check is explained, then
   re-asked, before proceeding.
4. **Only on a passed quiz:** hand the branch to the human to merge; bump the edited skill's
   `version` + the target's `CHANGELOG`. **Never auto-merge.** Bounded: propose *N* (small default);
   the human picks what lands.

## When to Go Back

| Condition | Action |
|---|---|
| Target does not conform to the roster contract | Stop — report the contract gaps; do not edit |
| A candidate only helps the current target | Reject here → route to `/specialize` (overlay), not a skill edit |
| No citation, or neither a check nor the manual-judgment flag | Reject the candidate — never propose ungrounded |
| Either gate is red (generic or per-target validator) | Kill that proposal; do not land |
| Target exposes no validator (no `validate_command`, no `scripts/validate.sh`) | **STOP — do not land.** Generic-gate-only is not enough; report and ask the human to declare a validator |
| Editing `/roster-upgrade`'s OWN Rules/gates (self-upgrade) | Full only; require explicit human review of the **Rules/gate diff** specifically (see Enforcement status) |
| Maintainer fails the quiz on a proposal | Do not land — surface the ambiguity (the proposal or its evidence is unclear) |

## What Next

- **Accepted proposals** → handed to the human to merge; the per-skill `version` + `CHANGELOG` bump
  rides with the merge.
- **Rejected-to-overlay** items → noted for `/specialize` (pack-side), keeping the wall intact.
- Re-run on cadence — outward research (platform capabilities, new techniques) is point-in-time and
  goes stale.

> 💡 `/roster-upgrade` rides roster FULL-mode governance and reuses `improvement-loop-planner` →
> `improvement-loop` for the bounded, verification-first funnel. It does not invent its own governance.

## Enforcement status — what is mechanical vs. what relies on this skill being followed

**The real backstop is propose-only + human review of the diff before merge** — most of the "gates"
are instructions to the running agent, not code that blocks. Be honest about which is which; do not
present aspirational controls as enforced.

| Safety claim | Status |
|---|---|
| Leak scan (literal secrets/credentials) | **Mechanical** — `check-leak.js`, fail-closed exit code, adversarially tested. |
| "Scan every edited file" / "non-zero exit kills the proposal" | **Enforced for roster** — `scripts/check-leak-diff.sh` derives the file set from `git diff` and roster's CI runs it on every push/PR (`.github/workflows/ci.yml`), blocking the merge. For an EXTERNAL target, the same script must be wired into that target's CI/pre-land hook (the upgrader can't enforce a gate in a repo it doesn't control). |
| The wall (no target data up) | **Mechanical only for literal leaks.** Semantic over-fit (a target invariant generalized with names filed off) is **human-judgment + quiz**, not gated. |
| Quiz on every proposal | **Decoupled.** Step 5 runs the `human-validation.md` quiz directly against the proposal, so it fires for every candidate regardless of altitude (not dependent on the Full-only `plan` phase). Includes the mandated consistency-check. Still relies on the agent running step 5 honestly — the quiz itself is human-in-the-loop by construction. |
| Evidence + check/flag per candidate | **Prose** — no script verifies a citation or flag exists. Human checks at the quiz. |
| Self-upgrade can't weaken its own gates | **Enforced.** `scripts/check-roster-upgrade-invariants.test.js` (in `npm test`/CI) fails if this skill stops naming propose-only, both gates, the wall, the quiz, or maintainer-only — so a weakening self-edit can't land green. Plus the self-edit row in *When to Go Back* (Full + human Rules-diff review). |
| Generic per-target contract check | **Enforced (generic).** `scripts/check-skill-contract.js` validates the contract on any target's `SKILL.md` (buildless, per-file) — no longer roster-repo-scoped. |

Most pillars are mechanically backed. The residual honest caveat:
the **wall's semantic half** (over-fit with names filed off) and **evidence/flag presence** remain
human-judgment at the quiz — they are not, and likely cannot be, fully mechanized. The backstop for
those is the quiz (now altitude-independent) + propose-only.

## Friction Log

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-upgrade"`.

## Rules

- **Propose only — never land.** A human merges through the quiz. No auto-merge, ever.
- **The wall holds.** Target-specific → `/specialize` overlay (down). Generic → here (up). Never merge the two.
- **No ungrounded change.** Every candidate cites a verifiable signal and carries a deterministic check or the explicit manual-judgment flag.
- **Both gates, fail closed.** Generic leak scan AND the target's own validator must pass. **No per-target validator → STOP, do not land** (not "flag and proceed").
- **Natural altitude, quiz always.** Route each candidate at its real mode (Fast for prose, Full for new capability); the quiz fires from step 5 regardless of mode, so altitude never skips it.
- **Competition is inspiration, not a diff.** Re-derive ideas; never port another pack's content. `source: competition` → mandatory human originality review.
- **Maintainer-invoked only.** Not auto-discovered; runs on an explicit cadence.
- **Self-application under the same rigor.** Upgrading `/roster-upgrade` itself uses the identical contract and both gates.
