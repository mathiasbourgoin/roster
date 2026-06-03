# Evaluating an Agentic Dev Harness — Research (for roster eval methodology)

*Local, not committed. Single-agent web research (practitioner + academic), 2026-05-31.
STRONG vs WEAK/contested separated. Feeds the adversarial pass + final methodology doc.*

## 0. The core hazard
**Harness-vs-model confound:** "roster+Opus beats vanilla Cursor+GPT-4" tells you nothing
about the *harness*. And roster's actual claims (quality, maintainability, consistency, low
friction) are **invisible to standard benchmarks**, which measure binary task resolution.
Capability benchmarks are a necessary *floor* (a harness that regresses task-solving is
broken) but **construct-invalid** for the value proposition.

## 1. Benchmarks — what they measure & where they break
SWE-bench/Verified/Multimodal, SWE-bench Pro (1,865 tasks, frontier ~23%), SWE-Lancer ($-valued
Upwork), Multi-SWE-bench (multilingual), Aider polyglot (Exercism toys), LiveCodeBench
(date-stamped, contamination-resistant), Terminal-Bench, Commit0/RepoBench/DevBench. **All
pass/fail functional-correctness.**
- **Contamination (STRONG):** "SWE-Bench Illusion" (arXiv 2506.12286) — models ID buggy file
  paths with **up to 76% accuracy from the issue text alone**, dropping to **<53% on external
  repos** (23–47pt gap = memorization); up to **35% 5-gram overlap**, 11.7–31.6% verbatim
  instance-match, across 10 vendor models. ~94% of Verified issues predate cutoffs; **~31% of
  "passing" instances have weak oracles**. OpenAI **no longer reports SWE-bench Verified** for
  frontier eval (contamination + scaffolding sensitivity).
- **Construct invalidity (decisive):** "% resolved" says nothing about readable/minimal/
  idiomatic/well-tested/maintainable. Two oracle-green patches can differ 10× in review burden
  and future defects. A quality-optimizing harness measures something these benchmarks
  **structurally cannot see** — a different construct, not a gap to close with a better pass/fail.

## 2. Metrics & validity
- resolve-rate / **pass@k**: STRONG capability floor; Goodhart-prone if eval set is visible.
- **DORA** (deploy freq, lead time, change-fail, MTTR): STRONG team diagnostic; DORA itself warns
  "inform, don't target"; 2024 data showed throughput/quality **decoupling** (don't treat one as
  "productivity").
- **SPACE** (Satisfaction, Performance, Activity, Communication, Efficiency): STRONG *framework*
  (never a single metric, never Activity alone — anti-Goodhart by design); WEAK for hard numbers
  (survey-based).
- Goodhart ranking (most→least gameable): Activity (LOC/commits) ≫ deploy-freq ≫ resolve-rate (if
  eval visible) ≫ change-fail ≫ multi-axis composites on held-out data.

## 3. Fair harness comparison (the core)
1. **Pin the model** — same model/version/temp/context for every harness; the only variable is the
   harness. Most public comparisons violate this → uninterpretable.
2. **Same-model/different-harness ablation:** `roster@X` vs `vanillaClaudeCode@X` vs `Aider@X`.
3. **Component ablation within roster** (reviewer off, planner off…) → attribute lift to parts.
4. **Held-out, contamination-resistant suite:** post-cutoff/private/date-stamped (LiveCodeBench
   design) + SWE-bench Pro / Multi-SWE-bench; not Verified alone.
5. **Multi-seed + intervals:** LLM eval is nondeterministic even at temp 0 (FP non-associativity,
   hardware). Single numbers unsound. (arXiv 2410.03492: CIs/SEs, intervals stabilize ~**n≈30**;
   report max–min.) Use **paired** designs + paired tests (bootstrap/McNemar) + **clustered SEs**
   when tasks share repos.
6. **Cost normalization:** tokens/$/wall-clock per resolved task — a first-class confound.
7. **Human eval with reliability:** blinded rubric (correctness, minimality, readability, test
   quality, idiomaticity), ≥2 raters, **report κ/α** or it's anecdote.

## 4. Measuring roster's OWN improvements
- Frozen versioned before/after suite; deltas with intervals.
- **Dev/holdout split (cardinal):** a holdout roster is **never tuned against**; iterate on a
  separate dev suite; promote only on **holdout** improvement. Tuning prompts/rules on the
  reported suite = training on the test set = Goodhart.
- Feature **ablation per release** (justify each new agent/rule with measured holdout lift).
- Eval-as-CI: gate releases on no significant regression (capability) + no quality-rubric regression.
- Refresh suite as holdout ages into training data.

## 5. Quality / maintainability / friction directly (the real claims; harder, weaker)
- **Quality/defect (moderate):** longitudinal rework / regression / change-failure rate on
  produced code; STRONG in principle, WEAK to attribute to the harness without RCT/long windows/large n.
- **Maintainability (WEAK — flag):** Maintainability Index & cyclomatic complexity are poorly
  validated (van Deursen "think twice before MI"; Teamscale; Shepperd; Landman; Kapser-Godfrey).
  **Do not report MI as ground truth.** Defensible substitute: **controlled human maintainability
  review** — a follow-up modification task measuring time-to-modify + defect-injection, κ reported.
- **Friction/DX (framework-strong, number-weak):** **intervention / human-takeover rate** +
  correction rounds per task (primary; behavioral, cheap, hard to game); SPACE survey (secondary).
- **Cautionary anchor (STRONG): METR RCT** (arXiv 2507.09089) — 16 experienced devs, 246 tasks,
  >1M-LOC repos: AI made them **19% slower** while they *believed* ~20% faster. → **never accept
  self-reported productivity as the endpoint; measure outcomes.** Caveat: narrow setting; doesn't
  show AI fails most devs.

## 6. Threats & controls
contamination → post-cutoff/private + track dates; overfitting/Goodhart → strict dev/holdout split,
multi-axis; nondeterminism → ≥10–30 seeds, CIs, paired tests, fix temp; small-n → clustered SEs,
bootstrap, single run = anecdote; cost confound → normalize; cherry-picking → pre-register suite+metrics;
construct validity → don't claim quality from resolve-rate; external validity → validate on real repos;
rater unreliability → ≥2 blinded raters + κ/α.

## 7. Recommended protocol — three disjoint axes
- **Axis A — Capability (floor; STRONG methods):** same-model/different-harness ablation vs vanilla
  Claude Code/Aider/OpenHands on held-out post-cutoff mix; ≥10 seeds; resolve-rate + bootstrap CIs +
  paired significance + **cost-normalized**. Proves roster doesn't *regress*. No quality claims here.
- **Axis B — Quality & maintainability (the real claim; MIXED):** blinded human rubric, ≥2 raters, κ;
  **follow-up-modification task** (time-to-modify + defect-injection); longitudinal rework/change-fail.
  MI/complexity only as secondary, explicitly-weak descriptor.
- **Axis C — Friction/DX (framework-strong, number-weak):** intervention/takeover rate + correction
  rounds (primary); SPACE survey (secondary); outcomes over self-report (METR).
- **Cardinal disjointness rule:** a holdout suite roster is never tuned on; promote only on holdout
  gains across all axes with intervals. The moment a suite tunes roster, it stops being a measurement.

**Evidence ledger.** STRONG: contamination real+quantified; nondeterminism→multi-seed+CIs; model
confound decisive; perceived≠actual (METR); pass/fail construct-invalid for quality. WEAK/CONTESTED:
MI/CC validity; DORA co-movement; single-setting DX generalization; small-n human review without κ.

## Sources
SWE-Bench Illusion 2506.12286 · "Agent ability or model memory" 2512.10218 · OpenAI Verified intro +
"why we no longer evaluate Verified" · SWE-bench Pro 2509.16941 · SWE-Lancer 2502.12115 ·
Multi-SWE-bench 2504.02605 · Commit0 2412.01769 · Terminal-Bench 2601.11868 · LiveCodeBench ·
Aider polyglot · Reproducible LLM eval 2410.03492 · Non-determinism 2408.04667 · Defeating
Nondeterminism 2506.09501 · METR RCT 2507.09089 · DORA/SPACE (ScopeCone, Waydev, LinearB) ·
MI critique (van Deursen, Teamscale) · maintainability-metric validity (Shepperd 1991, ESEM'09,
Ardito 2020).
