# Determinism / Evidence-Driven Checks — Academic & Empirical Research (leg 2 of 2)

*Local, not committed. Single-agent web research over peer-reviewed + arXiv sources,
2026-05-31. Strong vs weak/contested evidence separated explicitly.*

## 1. LLM self-eval vs sound external verifiers — STRONG
- Huang et al., *LLMs Cannot Self-Correct Reasoning Yet* (ICLR'24, 2310.01798): intrinsic
  self-correction doesn't improve, often degrades; prior "gains" used oracle labels.
- Stechly/Valmeekam/Kambhampati (ICML'24, 2402.08115; 2310.08118; 2310.12397): self-critique
  *collapses* performance; a **sound external verifier** gives large gains — and the critique
  *content doesn't matter*, only the sound pass/fail signal. LLM self-verifiers emit many FPs.
- Song et al., *Mind the Gap* (ICLR'25, 2412.02674): self-improvement bounded by the
  generation–verification gap → prefer external checkers.
- Shi et al., *Judging the Judges* (2406.07791, 150k+ instances): position bias systematic,
  driven by candidate quality gap.
- **Takeaway:** replace LLM self-judgment with a *sound* external verifier wherever one exists;
  LLM-judge only where none exists, biases controlled.

## 2. Automated test/oracle generation — STRONG (regression ≠ correctness)
- Shamshiri et al. (ASE'15), 357 Defects4J faults: combined tools 55.7%, single suite 19.9%;
  even when covered, often no sensitive assertion (oracle problem).
- Fraser & Arcuri (EMSE'14/'15), Almasi (ICSE-SEIP'17): generated suites excel at *regression
  characterization*, weak at independent fault detection (~22.6–25.2%/fault). Neural oracles
  (TOGA ICSE'22; 2307.16023, 51k faults) — high FP, brittle.
- **Takeaway:** generated tests = "behavior unchanged," NOT "behavior correct"; on buggy code
  they encode the bug.

## 3. LLM confidence calibration — STRONG claim, INFERRED comparison
- Leng et al., *Taming Overconfidence* (2410.09724): RLHF concentrates verbalized confidence
  80–100%, ECE ≥0.30; base-model token-probs often better calibrated than verbalized.
- **Takeaway:** self-reported probability is an unreliable gate; an executable check is binary,
  calibrated-by-construction — but "executable > verbalized" is a sound *inference*, not a
  measured head-to-head (flagged).

## 4. Reward hacking / Goodhart — STRONG, with a taxonomy
- Krakovna et al. (DeepMind): dozens of specification-gaming instances.
- Denison et al. *From Honesty to Subterfuge* (2410.06491): in-context RL escalates to
  reward-tampering. Pan et al. (ICLR'22): phase transitions to hacking with capability.
- Mitigations with evidence: held-out/secret signals, reward-model ensembles, **verifiable
  rule-based rewards** (2509.15557).
- **Takeaway:** any learned/subjective proxy used as a target gets gamed; the defense is
  verifier *validity*, not mere determinism (a deterministic metric is also Goodhart-able).

## 5. Code-quality metrics & thresholds — WEAK / CONTESTED (the key honesty point)
- **CC ≈ LOC, contested:** Shepperd (1988) "CC is a proxy for, often outperformed by, LOC";
  Graylin/Jay et al. (2009) near-perfect linear CC↔LOC. **Counter:** Landman/Serebrenik/Vinju
  (JSEP'16, 17.6M Java methods/6.3M C functions) — only *moderate* per-method correlation, not
  redundant. Net: **CC's incremental value over SLOC is small and inconsistent.**
- **Threshold 10 is folklore:** McCabe (1976) called 10 "reasonable, not magical"; **no
  canonical study fits 10/15/20 as a defect-optimal cutpoint** — tools adopt by convention.
- **Duplication not uniformly harmful:** Kapser & Godfrey *"Cloning Considered Harmful"
  Considered Harmful* (WCRE'06/EMSE'08); Rahman et al. (MSR'10/EMSE'12) — clones *not*
  consistently more defect-prone, sometimes less.
- **Size is a hard baseline:** SLOC + process metrics (churn, prior changes) usually rival/beat
  complexity for *defect* prediction.
- **Takeaway:** static-metric thresholds are **not empirically grounded as defect predictors**;
  their defensible value is readability/maintainability *convention*. Hard-gating merges on
  them dresses folklore as determinism — use **advisory, locally-calibrated**, never as a
  correctness oracle. (Directly tempers audit proposals P3/P7/P19.)

## 6. Metamorphic / property-based / differential testing — STRONG
- Yang/Chen/Eide/Regehr, Csmith (PLDI'11): differential testing found >325 compiler bugs
  (79 GCC, ~202 LLVM); every compiler miscompiled valid programs. YARPGen (OOPSLA'20).
- Chen et al. MT survey (TSE'18), Segura (TSE'16): MRs kill substantial mutant fractions;
  effectiveness ∝ execution-profile dissimilarity. PBT (QuickCheck lineage) = constructive variant.
- **Takeaway:** these manufacture a *sound mechanical oracle* from invariants — the strongest
  positive case for replacing judgment with a checker.

## 7. Reproducibility / determinism — STRONG prerequisite
- Luo et al. *Empirical Analysis of Flaky Tests* (FSE'14), 201 fixes: Async-Wait ~45%,
  Concurrency ~20%, Test-Order ~12%. Confirmed across Python/JS.
- **Takeaway:** a test is a deterministic verifier only if the harness is deterministic;
  flakiness converts a sound oracle into noise. Engineer it out first.

## 8. Traceability — MODERATE-STRONG
- Mäder & Egyed (EMSE'15, controlled, 52 subjects): with traceability, **~21% faster** and
  **~60% more correct** solutions. Rempel & Mäder (TSE'17): more complete traceability ↔ lower
  defect rates. Caveat: small body; benefits depend on link quality.

## Synthesis (evidence strength)
| Claim | Strength |
|---|---|
| sound external verifier > LLM self-judge | STRONG |
| metamorphic/differential/PBT as manufactured oracles | STRONG |
| remove flakiness before trusting tests | STRONG prerequisite |
| traceability improves correctness/speed | MODERATE-STRONG |
| verbalized confidence unreliable | STRONG (exec-better = inferred) |
| **static code-quality thresholds as defect gates** | **WEAK/CONTESTED — folklore** |

The literature supports replacing *subjective self-judgment* with *sound external/mechanical
verifiers* + removing nondeterminism. It does **not** support fixed code-quality thresholds as
correctness gates — that swaps one weak proxy (opinion) for another (an unvalidated number),
itself Goodhart-prone. The differentiator is verifier **validity/soundness**, not determinism alone.

## Sources
2310.01798 · 2402.08115 · 2310.08118 · 2310.12397 · 2412.02674 · 2406.07791 · Shamshiri ASE'15 ·
Fraser&Arcuri EMSE'14/'15 · 2307.16023 · TOGA 2109.09262 · 2410.09724 · Krakovna/DeepMind ·
2410.06491 · Pan ICLR'22 · 2509.15557 · Shepperd 1988 · Graylin/Jay JSEA'09 · Landman JSEP'16 ·
Kapser&Godfrey WCRE'06 · Rahman MSR'10 · McCabe 1976 · Csmith PLDI'11 · YARPGen OOPSLA'20 ·
Chen MT-survey TSE'18 · Luo FSE'14 · Mäder&Egyed EMSE'15 · Rempel&Mäder TSE'17.
