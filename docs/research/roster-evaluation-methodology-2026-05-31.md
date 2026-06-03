# Roster Evaluation Methodology — FINAL

*Definitive, runnable methodology for evaluating the roster harness: against other harnesses
and against its own prior versions. Integrates the 3-axis research protocol
(`roster-evaluation-research-2026-05-31.md`) with the adversarial pass
(`roster-evaluation-adversarial-2026-05-31.md`). Date 2026-05-31.*

---

## 0. Budget-first framing (read this before anything else)

**An evaluation method must be chosen against an explicit budget — tokens, dollars, and
human-hours — before its statistics are chosen.** This is the load-bearing finding of the
adversarial pass, and it inverts the usual order of these documents.

The prior research doc is statistically honest: it confronts contamination, nondeterminism,
construct invalidity, and weak instruments (MI, DORA, self-report). What it never states is the
**operating-scale assumption**. Every method it endorses — n≈30 seeds, ≥2 blinded raters with
κ, scheduled holdout refresh, per-release component ablations — is a *lab* method. A solo or
small maintainer cannot run any of them at the prescribed power. So the real axis of the
methodology is not *rigorous vs sloppy*; it is **run vs unrun**.

This matters because an unrun rigorous protocol has **lower** validity than a cheap honest one.
A protocol that is too expensive to execute produces zero bits of evidence, and the maintainer
falls back to exactly the vibes the protocol was meant to replace — now with a methodology doc
sitting unused as a credential. **Specifying a test you will not run is itself a validity
threat.** It is theater that crowds out the cheap real thing.

Where is the line between rigor and theater?

- **Rigor** = running a weak instrument and labeling its weakness exactly: "8 tasks, 5 seeds,
  wide CIs, screening only, local claim."
- **Theater** = specifying a strong instrument (30 seeds, two raters, κ) you never execute, then
  shipping on intuition when release day comes.

Therefore this document is organized **around what is runnable at a given budget**, not around
what is statistically ideal. It defines two tiers:

- **Tier 0 — Minimum Viable Eval.** The default. Cost target ≈ **one focused day per release**,
  mostly unbabysat machine time. Runnable *now*, by one person. This is what you actually do.
- **Tier 1 — Aspirational / lab-grade.** The full 3-axis protocol. **Only when resources exist**
  (a team, a rater pool, a token budget in the thousands per release). Never the default.

A maintainer who can only afford Tier 0 runs Tier 0 honestly. That strictly beats specifying
Tier 1 and running nothing.

---

## 1. Tier 0 — Minimum Viable Eval (the default; step-by-step)

Design target: total cost ≈ one focused day per release; deliberately under-powered and
**labeled** as such. Tier 0 has four components. The first two are the floor (automatable, every
release); the second two are rare/occasional. Everything compares **roster vs ONE open-source
baseline harness on the SAME pinned open model** — never against a closed tool (see §3).

### 1.1 The frozen paired suite

- **5 tasks**, drawn from **your own repo's real issues**, dated *after* the pinned model's
  training cutoff. Using your own future commits as the suite is the keystone move: zero
  authoring overhead, intrinsically post-cutoff (contamination-resistant by construction), and
  externally valid because it is literally your maintenance work. This replaces the prior doc's
  "build a private post-cutoff suite and refresh it on a schedule," which has no owner and no
  budget and contaminates within 6–12 months as model versions roll.
- **3 seeds** per task (LLM eval is nondeterministic even at temp 0). 3 seeds is *screening*,
  not a population estimate — accept wide intervals and label them so.
- **Two harnesses only:** `roster@model` vs one open baseline (`vanillaClaudeCode@model` *or*
  `Aider@model` *or* `OpenHands@model` — pick one and pin it). **Paired** on identical tasks and
  seeds.
- **Pin the model:** same model/version/temperature/context for both harnesses. Pinning removes
  the *weights* confound only — it does **not** isolate the harness (§3, threat #4). Do not claim
  it does.

Total: ~30 runs. ~1–2 hours of machine time.

### 1.2 Promote / reject decision — Gate (a): hard capability regression

Tier 0 gates on **hard regression only**, not statistical significance (a solo holdout is too
small to detect a realistic 10pp lift — its CI swallows the effect; trying to gate on
significance means the gate either never fires or never runs).

- **Reject** a roster change if any task that **passed last release now errors, crashes, or
  fails its own test** at the same seed. A crash is a crash; no significance math needed.
- **Promote** (w.r.t. this gate) if no task hard-regresses.

This is a one-sided tripwire: it catches roster getting *worse*, which is the failure mode a
maintainer most needs an alarm for. It does **not** detect or claim improvement.

### 1.3 Promote / reject decision — Gate (b): cost-per-outcome (CO-PRIMARY)

Cost-per-outcome is **promoted to a co-primary axis**, not a normalization footnote. Because
pinning the model does not pin the *inference* — roster fans out multi-agent calls and can spend
5–20× the tokens of a vanilla harness — the realistic decision is "roster spends N× the tokens;
is the quality delta worth N×?" That is the actual question a maintainer faces, it is *cheaper*
to measure than statistical lift (the numbers are already in the run logs), and it is the
apples-to-apples cut that survives the pinning critique.

**What to log, per run** (this is the exact log schema; see §6 for the W0 tie-in):

| Field | Source | Why |
|---|---|---|
| `harness` (`roster` / baseline) | runner | pairing key |
| `task_id`, `seed` | runner | pairing key |
| `model`, `model_version`, `temperature` | runner config | pin verification |
| `resolved` (bool) | task's own test exit code | outcome |
| `input_tokens`, `output_tokens`, `total_tokens` | provider API / log | cost |
| `usd_cost` | tokens × price | cost |
| `wall_clock_s` | runner timestamps | cost |
| `agent_calls` (count) | runner | inference-procedure context |
| `date`, `model_cutoff` | config | contamination audit |

**Decision rule:** report, per harness, **tokens / $ / wall-clock per *resolved* task**
(total cost of the harness ÷ number of tasks it resolved). Then report the **ratio**
roster:baseline.

- **Reject** a roster change if its cost-per-resolved-task rises materially (suggested default:
  **>25% vs roster's own previous release** at equal or worse resolve count) with no
  corresponding outcome gain. Cost creep with no outcome gain is a regression.
- **Promote** if cost-per-outcome holds or improves, *and* gate (a) passes.

*Claim licensed:* "roster resolves these tasks at N× the token cost of `<baseline>`." Often the
single most decision-relevant number in the whole eval.

### 1.4 Self-blinded diff-preference check (the quality signal; rare)

The real value claim (quality, maintainability) is invisible to pass/fail. Tier 0 gets a *local*
quality signal cheaply, run **occasionally** (not every release — e.g. on a meaningful roster
change), ~1–2 hours:

1. For each task where both harnesses produced a patch, **strip provenance** and **shuffle
   order**.
2. **Cold-rate your own outputs** on a 3-item rubric: correctness / minimality / would-I-merge.
3. You are the only rater. **Drop κ** — it measures agreement, not validity, and there is no
   second independent expert on a solo project; high κ can even launder a bad rubric. Replace it
   with **within-rater self-blinding + intra-rater consistency**: re-rate a random 20% sample a
   week or more later, cold, and **disclose that consistency number**.

*Claim licensed:* "blind-to-source, I preferred roster's diff on 7/8 tasks (intra-rater
consistency 90%)." A local, dated preference statement — **never** "roster is better."

### 1.5 Maintainability spot-check (annual; never a gate)

The follow-up-modification task is the strongest *validity* signal for maintainability and the
weakest *feasibility* signal (each run needs a fresh realistic modification request, executed
under timing with defect counting — and re-modifying the same artifact triggers a **practice
confound** that kills repeat measurement). So:

- Run **once or twice a year**, on a **fresh artifact** (new code, to dodge the practice
  confound): pick a real modification, time it, count injected defects, on roster-produced vs
  baseline-produced code.
- Report as a **dated case study with n stated**. **Never gate releases on it.**

Note also: do **not** report Maintainability Index or cyclomatic complexity as ground truth —
both are poorly validated (see evidence ledger §5). At most use them as an explicitly-weak
secondary descriptor.

### 1.6 Pairing intervention-rate with outcome (if you track friction at all)

If you record a friction signal (human-takeover / intervention rate, correction rounds),
**never report it alone**. An agent that asks fewer questions and barrels ahead scores *better*
on intervention rate while producing *worse* outcomes — silence ≠ success — and it is fully
confounded by task difficulty. **Pair it with outcome:** friction counts as *low* only when
intervention drops **and** resolve+quality hold. A drop in asks with a drop in quality is a
**regression**, not a win. Use the paired same-task design so difficulty cancels.

### 1.7 The smallest honest signal

If you will do **only one thing**: run **§1.1 + §1.3 together** — the 5-task, 3-seed, paired
roster-vs-one-baseline run, gated on hard regression, reporting cost-per-outcome from the logs.
Cheap enough to run every release, answers the only universally relevant question ("did I break
anything, and what does this harness cost per result"), and makes no claim it can't back. That
is the floor that honestly beats vibes.

---

## 2. Tier 1 — Aspirational / lab-grade (only when resources exist)

**Do not run this as the default.** Tier 1 is the full 3-axis protocol, valid in a lab and
unaffordable solo. Adopt it incrementally only when you have a team, a rater pool, and a
per-release token budget in the thousands. Each Tier-1 element is the *powered* version of a
Tier-0 screen.

- **Axis A — Capability (floor).** Held-out, contamination-resistant suite (post-cutoff /
  private / date-stamped, LiveCodeBench design + SWE-bench Pro / Multi-SWE-bench — **not**
  Verified alone). Same-model / different-harness ablation vs vanilla Claude Code / Aider /
  OpenHands. **≥10–30 seeds** (intervals stabilize ~n≈30). Resolve-rate + **bootstrap CIs** +
  **paired significance** (McNemar / bootstrap) + **clustered SEs** when tasks share repos +
  **cost-normalized**. Proves roster doesn't *regress*; licenses **no** quality claims.
- **Axis B — Quality & maintainability (the real claim; mixed strength).** Blinded human rubric
  (correctness, minimality, readability, test quality, idiomaticity), **≥2 raters, report κ/α**;
  the **follow-up-modification task** (time-to-modify + defect-injection) across artifacts;
  longitudinal rework / change-fail. MI / complexity only as an explicitly-weak secondary.
- **Axis C — Friction / DX (framework-strong, number-weak).** Intervention / takeover rate +
  correction rounds (primary, paired with outcome), SPACE survey (secondary). Outcomes over
  self-report (METR). *Note: DORA / SPACE presuppose a team and a deployment pipeline; they do
  not down-scale and are cut from Tier 0 entirely.*
- **Component ablation** (reviewer off, planner off…) to attribute lift to roster parts — run
  when introducing a major component, not per release even at Tier 1.

Tier 1's validity depends on the **conjunction** (disjoint holdout AND n≈30 AND ≥2 raters AND κ
AND per-release cadence). The conjunction is what is unaffordable solo — which is precisely why
Tier 0 exists.

---

## 3. Applied adversarial verdicts (what changed and why)

Every verdict from the adversarial pass is applied above; recorded here for traceability.

1. **Disjointness redefined — "look-once-then-burn."** Prompt engineering cannot be blinded from
   its own error analysis: to fix a failure you must *read* it, and reading it leaks it into the
   next prompt edit. So the holdout is **spent the moment its failure is read**. Rule: a holdout
   instance, once read to fix it, is **permanently retired to the dev set and replaced**. Track
   **"holdout instances spent" (burn rate)** and disclose it. Honesty = disclosing the burn, not
   pretending you never looked. (The eval is itself subject to this rule — §6.)
2. **Closed-tool controlled comparison — DROPPED as structurally impossible.** Cursor / Devin are
   closed and bring their own model + scaffold; you cannot run them on your pinned model, so the
   one controlled comparison people want **cannot exist**. Tier 0/1 compare only against **open
   same-substrate** harnesses (Claude Code / Aider / OpenHands), clearly labeled "not Cursor."
   Closed-tool numbers are **non-comparable context only** — an uncontrolled, disclosed anecdote,
   never blended with controlled results.
3. **Cost-per-outcome promoted to co-primary** (§1.3): not bookkeeping. The realistic decision is
   a price-per-result comparison, and it is the cheapest high-value signal in the protocol.
4. **Pinning isolates weights, not inference.** Same weights ≠ same computation; roster's
   fan-out, context injection, and call count co-vary with the harness by construction. Drop the
   "only variable is the harness" claim; report cost as co-primary; compare at **equal token
   budget** where possible (cap roster's spend) for the only apples-to-apples cut.
5. **κ dropped for solo → self-blinded single-rater + intra-rater consistency** (§1.4). κ
   measures agreement not validity and needs a second independent expert that does not exist
   solo.
6. **Intervention-rate paired with outcome** (§1.6): silence ≠ success.
7. **Holdout reclassified from "proof of lift" to "regression tripwire"** (§1.2): power it to
   catch regressions, not to detect lift.
8. **Follow-up-modification demoted to annual spot-check** (§1.5): strongest validity, weakest
   feasibility; case-study cadence, never CI.
9. **DORA / SPACE dropped from solo scope** (team instruments; n=1 noise).
10. **METR forces a claims ledger** (§4): if a real RCT (16 pros, 246 tasks) is called narrow /
    non-generalizing, a solo 5–8 task screen certainly is. Honesty lives in the **scope of the
    claim**, not the size of n.

---

## 4. CLAIMS LEDGER (mandatory)

This table is **required** and makes over-claiming structurally hard. It is the anti-"best
because we feel it" mechanism. Every eval run must map its outputs onto the licensed-claim column
and **must not** state anything in the forbidden column.

| Eval activity | Licenses you to claim | Does NOT license |
|---|---|---|
| **Tier-0 5×3 paired run, gate (a) passes** | "roster did not hard-regress on these 5 tasks, on `<model@version>`, dated `<date>`, vs `<baseline>`" | "roster is reliable" / "roster passes more tasks" / any lift claim |
| **Tier-0 cost-per-outcome (gate b)** | "roster resolved these tasks at N× the token/\$/wall-clock cost of `<baseline>` on this run" | "roster is efficient in general" / cross-model cost claims |
| **Tier-0 self-blinded diff preference** | "blind-to-source I preferred roster's diff on X/Y tasks (intra-rater consistency Z%) on this date" | "roster produces better code" / "reviewers prefer roster" |
| **Tier-0 annual maintainability spot-check** | "in 1–2 dated case studies, roster-produced code took T to modify with D defects vs baseline" | "roster is more maintainable" (n too small; weak instrument) |
| **Closed-tool (Cursor/Devin) observation** | "uncontrolled, different-substrate anecdote — non-comparable context" | any controlled or comparative claim whatsoever |
| **Tier-1 Axis A (n≈30, CIs, paired)** | "roster does not regress capability vs `<open baselines>` at this CI on this suite" | "roster is better than Cursor/Devin"; quality claims |
| **Tier-1 Axis B (≥2 raters, κ)** | "raters preferred roster's diffs at rate R, κ=K, on this suite" | generalization beyond the suite/raters |
| **Any tier** | local, **dated, task-scoped** claims | **"roster is better"** — unlicensed by any feasible n |

**Hard rule:** the protocol can honestly say *"roster did not regress and I preferred its diffs
on my May tasks at N× cost."* It can **never** say *"roster is better than Cursor"* — that
comparison is uncontrollable and that generalization is unlicensed by any feasible n.

---

## 5. Threats & controls + Evidence ledger

### Threats & controls

| Threat | Control (Tier 0) |
|---|---|
| **Contamination** | own-repo post-cutoff tasks; record `date` + `model_cutoff`; look-once-then-burn |
| **Goodhart / overfitting** | holdout burn-rate disclosed; never tune on reported tasks |
| **Nondeterminism** | 3 seeds (screening); fix temperature; report range not point |
| **Small-n** | reclassify holdout to tripwire; no significance claims; label "screening" |
| **Cost confound** | cost-per-outcome co-primary, from logs; compare at equal token budget |
| **Construct invalidity** | never claim quality from resolve-rate; diff-preference is *local* |
| **Closed-tool incomparability** | DROP controlled closed-tool comparison; context-only |
| **Rater unreliability (solo)** | self-blinding + intra-rater consistency, disclosed |
| **Friction metric gaming** | pair intervention with outcome; paired same-task design |
| **Practice confound** | maintainability spot-check on fresh artifacts only |
| **Over-claiming** | mandatory claims ledger (§4) |

### Evidence ledger (preserved)

**STRONG.** Contamination is real and quantified — "SWE-Bench Illusion" (arXiv 2506.12286):
models ID buggy file paths with up to **76%** accuracy from issue text alone, dropping to
**<53%** on external repos (23–47pt memorization gap), up to **35%** 5-gram overlap; ~94% of
Verified issues predate cutoffs; ~31% of "passing" instances have weak oracles; OpenAI no longer
reports SWE-bench Verified for frontier eval. Nondeterminism is real → multi-seed + intervals
(arXiv 2410.03492; intervals stabilize ~n≈30; report max–min). Model-vs-harness confound is
**decisive**. Perceived ≠ actual productivity — **METR RCT** (arXiv 2507.09089): 16 experienced
devs, 246 tasks, >1M-LOC repos, AI made them **19% slower** while they believed ~20% faster.
Pass/fail is construct-invalid for quality.

**WEAK / CONTESTED (flagged).** Maintainability Index & cyclomatic complexity validity is poor
(van Deursen "think twice before MI"; Teamscale; Shepperd 1991; Landman; Kapser-Godfrey) — **do
not report MI as ground truth**. DORA throughput/quality co-movement (2024 data showed
decoupling). Single-setting DX generalization. Small-n human review without κ. **And the
honest caveats remain: maintainability metrics are weak; METR shows perceived≠actual; benchmark
contamination is pervasive.** None of these are "solved" by Tier 0 — Tier 0 only shrinks the
claim to fit the evidence.

---

## 6. Tie-in to the determinism program (G3 + W0)

This eval **is the measurement substrate** for the determinism program's gate-factory loop.

- **G3 — gate-factory loop.** Gates are *evidence-pulled, born advisory, and promoted to firm
  only on measured precision*. The principle is **measure before you mandate**. A roster change
  (a new agent, rule, or gate) is a change to the harness; **G3 promotes roster changes only on
  measured evidence**, and Tier 0 is the cheapest measurement that produces that evidence:
  gate (a) (no hard regression) and gate (b) (cost-per-outcome) are exactly the promote/reject
  signals G3 needs to move a change from advisory to firm.
- **W0 — per-target enforcement installer + measurement substrate.** W0 is the keystone: it
  installs the project's CI workflow / hooks **and records per-gate, per-run outcomes over time**.
  The Tier-0 MVP **reads those per-run logs** — the §1.3 log schema (tokens, \$, wall-clock,
  resolved, seeds, model pin) is precisely what W0 must emit. W0 is also the **disjoint oracle**:
  the task's own test, run by the project's CI, decides `resolved` independently of the authoring
  agent. Without W0, gate (a)/(b) are agent-honored prose; with W0 they are enforced and
  recorded.
- **The eval is itself subject to the disjointness rule.** The eval suite is a holdout for the
  harness. The moment you read a suite task's failure to tune roster, that task is **spent**
  (look-once-then-burn, §3.1) — retired to the dev set and replaced, burn-rate disclosed. The
  measurement substrate must not silently become the thing being optimized against, or the eval
  stops being a measurement and becomes Goodhart.

---

## 7. Sources

SWE-Bench Illusion 2506.12286 · "Agent ability or model memory" 2512.10218 · OpenAI Verified
intro + "why we no longer evaluate Verified" · SWE-bench Pro 2509.16941 · SWE-Lancer 2502.12115 ·
Multi-SWE-bench 2504.02605 · Commit0 2412.01769 · Terminal-Bench 2601.11868 · LiveCodeBench ·
Aider polyglot · Reproducible LLM eval 2410.03492 · Non-determinism 2408.04667 · Defeating
Nondeterminism 2506.09501 · METR RCT 2507.09089 · DORA / SPACE (ScopeCone, Waydev, LinearB) ·
MI critique (van Deursen, Teamscale) · maintainability-metric validity (Shepperd 1991, ESEM'09,
Ardito 2020). Internal: `roster-evaluation-research-2026-05-31.md`,
`roster-evaluation-adversarial-2026-05-31.md`, `determinism-FINAL-2026-05-31.md` (G3 §, W0 §).
