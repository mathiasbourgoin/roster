# Determinism-Driven / Evidence-Driven Development for Coding Agents

**Date:** 2026-05-30
**Status:** research synthesis (design input for roster) — pending independent cross-check
**Method:** deep-research harness — 6 angles, 27 primary sources fetched, 129 claims
extracted, top 25 adversarially verified (3-vote refute), **20 confirmed / 5 refuted**.
**Confidence key:** each claim tags `[high]` / `[medium]` and the verify vote (e.g. `3-0`).
Sources are arXiv/venue IDs; see the Sources table. Refuted over-reaches are listed
in §8 so they are *not* repeated as fact.

---

## 0. Thesis verdict

**The core thesis holds, with one sharp boundary condition.** Deterministic,
executable verification artifacts are measurably more trustworthy than an LLM's
self-judgment — *and* the usefulness of any self-verification step is governed by a
single measurable quantity (the **generation–verification gap**), not uniformly
available. So the design rule is not "agents verify themselves" but:

> **Anchor every nontrivial decision in a deterministic, externally-sound, executable
> check whose verdict is an exit code — and use the LLM's own judgment only as a cheap
> pre-filter in front of that check, never as the final authority.**

This is exactly Evidence-Driven Development (EDD): trust is earned by a runnable
artifact, ranked by how strong the evidence is, not asserted by the producer.

---

## 1. LLMs are unreliable verifiers of their own work (the negative core)

The strongest, most consistent result in the literature is a *negative* one — and it
is the load-bearing justification for EDD.

- **Intrinsic self-correction does not work and can actively harm.** `[high, 3-0/2-1]`
  LLMs cannot reliably improve their own reasoning without external feedback;
  self-correction sometimes *degrades* it (GPT-3.5 on GSM8K: fixed 7.6 % of wrong
  answers while breaking 8.8 % of correct ones — net loss). Reported gains in prior
  work "result from using oracle labels … and vanish when oracle labels are not
  available." (arXiv 2310.01798, ICLR 2024; corroborated 2406.01297, TACL 2024)
  → **Mechanistic justification for EDD: substitute deterministic external oracles for
  self-judgment.**

- **Self-critique is worse than an external sound verifier, and LLM verifiers emit
  false positives** (accept wrong outputs as correct). `[high, 3-0 / 2-1]` In planning,
  GPT-4 as its own verifier *diminished* performance vs. a sound external verifier
  (VAL), and produced "a notable number of false positives, compromising the system's
  reliability." (arXiv 2310.08118, NeurIPS-2023 wksp; 2402.08115)

- **As an oracle/assertion judge, accuracy is below 50 %** (correct-code+correct-
  assertion ≈ 41–46 %; worse-than-random in 10/24 repos) — "all LLM suggestions will
  need human inspection." `[high, 3-0]` (arXiv 2410.21136)

- **That judgment is biased toward the *implementation*, not the *intent*.** `[high,
  3-0]` Classification accuracy drops ~8–9 % on buggy/mutated code — i.e. when the code
  is wrong, the model tends to *encode the bug* rather than catch it. (arXiv 2410.21136)
  This is the single most important failure mode for self-generated checks (see §7).

- **LLM-as-judge has systematic position bias.** `[high, 3-0]` Non-random, judge- and
  task-dependent; weakly affected by length but *strongly* affected by the quality gap
  between candidates — judges are reliable when candidates differ clearly and
  **unreliable on near-ties**. (arXiv 2406.07791, 15 judges, 150 k+ instances)
  → Gate self-verification *off* on near-tie decisions; it is least reliable exactly
  there.

## 2. Deterministic external oracles work (the positive core)

Where the check is external and executable, results are strong:

- **Metamorphic / consistency testing with no ground-truth oracle catches 75 % of
  erroneous GPT-4 programs** (HumanEval, 8.6 % FP). `[high, 3-0]` Paraphrase the prompt
  into semantically-equivalent variants, regenerate multiple implementations, and treat
  inter-output *inconsistency* as the fault signal. (arXiv 2406.06864)
  *Caveat: only the final differential comparison is deterministic; the upstream
  paraphrase/regeneration is non-deterministic.*

- **Differential fuzzing catches what fixed test suites miss.** `[high, 3-0]` 19–35 % of
  LLM code refactorings are semantically non-equivalent to the original; **~21 % of those
  semantics-breaking changes still pass the existing human-written tests.** A
  differential-fuzzing equivalence oracle (run thousands of generated inputs on both
  versions; equivalent iff all outputs match) gives a binary, exit-code-style verdict
  that fixed suites cannot. (arXiv 2602.15761 — preprint, n=6 models)
  → **Fixed test suites are an incomplete oracle. Input-generating checks (fuzz/PBT)
  find drift that examples miss.**

- **Composing checker types materially improves coverage.** `[high, 3-0]` On curated
  edge-case problems, property-based and example-based tests each catch 11/16; **their
  union catches 13/16 (81 %).** (arXiv 2510.25297, AIware 2025)
  → **No single check style suffices — compose PBT + examples + differential.**

- **LLM-synthesized oracles reach rough mutation-score parity with human ones** (43 %
  vs 45 % on 13,866 oracles / 135 Java projects) `[medium, 2-1]` — **but parity on
  mutation score is *not* practical-utility parity**: it ignores the ~25–47 % false-
  positive rates reported for assertion oracles (up to 81 % for exception oracles) and
  conditions on having a usable oracle at all. (lucadigrazia ASE 2025; 2410.21136)

## 3. The organizing principle: the generation–verification gap

`[high, 3-0]` (arXiv 2412.02674, "Mind the Gap", ICLR 2025)

- Self-verification usefulness is "largely governed by a quantity we formalize as the
  **generation–verification gap**" — *how much easier it is to verify than to generate*.
- A variant of this gap **scales monotonically with pretraining compute** (so newer/
  larger models self-verify better — see the recency caveat in §7).
- Iterative self-improvement **saturates after 2–3 rounds regardless of capacity**, and
  **fails on tasks where verification is as hard as generation** (the oracle problem),
  while succeeding where verification is cheap (e.g. Sudoku).

**Design implication:** prefer decision points where *verifying is cheaper than
generating*, and engineer that asymmetry deliberately — a deterministic external oracle
makes verification cheap by construction. Don't iterate self-critique past ~2 rounds.

## 4. Determinism for the harness itself

Beyond the produced code, the *pipeline's own* decisions should be auditable and
replayable: deterministic gates, reproducible runs, fact-checkable decision logs,
ADR/decision capture, and claim→evidence traceability. (angle surveyed across
2602.23193, 2601.15322, 2603.28988, 2508.02866, 2603.14332; audit-log practitioner
guidance — *these were surveyed for context; their specific claims were not in the
independently-verified top-25, so treat as directional, not established*.)

This maps directly onto roster's existing-but-unenforced substrate: `kb/decisions/`
(ADRs), the semantic KB index, and per-task briefs. EDD says: make those the *gate*,
not just documentation.

## 5. Operationalization — what an evidence-anchored harness should do

1. **Every nontrivial decision/finding ships a deterministic, executable artifact** (an
   exit-code oracle): a test, a property, a differential check, an invariant monitor, a
   validation script. The verdict is `0`/nonzero, not prose.
2. **Rank trust by evidence strength**, explicitly: `untested` < `code-read`
   (code-confirmed) < `executed-and-passing` < `differentially-fuzzed / property-checked`.
   (This is the evidence axis already imported into roster-investigate — the research
   validates it and adds the top rung.)
3. **LLM self-judgment is a cheap pre-filter only**, always gated by a sound external
   check. Never the final authority. Gate it *off* on near-tie decisions (§1 position bias).
4. **Compose checker types** (PBT + examples + differential) — no single style suffices.
5. **Engineer the verification asymmetry** (§3): structure decisions so verifying is
   cheaper than generating; stop self-iteration at ~2 rounds.
6. **Prefer differential / metamorphic oracles over implementation-derived ones**
   where possible (they don't encode the bug — §7).

## 6. Beyond tests/specs — other deterministic anchors (and how they compose)

- **Types & contracts** — cheapest always-on oracle; compile-time + runtime assertions.
- **Differential / golden testing** — compare against a reference impl or prior output;
  catches semantic drift fixed tests miss (§2).
- **Metamorphic relations** — correctness signal without ground truth (§2).
- **Property-based testing** — input-generating; finds edge cases examples miss (§2).
- **Runtime monitors / invariants** — assertions that fire in execution, not just tests.
- **Simulation / model-based testing** — for stateful/protocol logic.
- **Provenance / reproducible builds** — determinism of the *artifact*, not just its tests.

These compose as layers: types catch the cheapest class, PBT+differential the semantic
class, runtime monitors the deployment class. Stack them by cost.

## 7. Risks & limits (do not skip)

- **Oracle overfitting / implementation-derived checks encode the bug.** `[high]` The
  central risk: a check synthesized *against the code* tends to ratify what the code
  does, not what was intended (§1, 2410.21136). **Mitigation:** prefer differential and
  metamorphic oracles (no implementation reference), derive checks from the *spec/intent*
  not the code, and mutation-test the checks themselves.
- **Verifier false positives / hallucination.** `[high]` LLM verifiers accept wrong
  outputs (§1). Only *sound* external verifiers fully avoid this.
- **Goodhart / metric-gaming & vacuous checks.** Self-generated tests can pass trivially.
  *No surviving claim quantifies how often* — this is an open risk, not a measured one.
- **Cost / latency.** Fuzzing thousands of inputs, regenerating paraphrases, synthesizing
  properties — real overhead; break-even vs bug-detection gain is **unquantified** here.
- **Model-recency caveat (important).** The strongest negative results used GPT-3.5 /
  GPT-4-era-2023 models; the gen-verif-gap result predicts self-verification *improves*
  with compute. So "LLMs cannot self-verify" is correctly read as **scope-limited**
  (intrinsic, prompted, no external oracle, that model era) — **not permanent**. EDD's
  conclusion (gate on external oracles) is robust either way; the *degree* to which self-
  verification can pre-filter will improve with newer models.

## 8. Refuted over-reaches (do NOT state these as fact)

These were extracted but **failed verification** — listed so we don't repeat them:

- ✗ "Metamorphic/consistency testing **resolves** the oracle problem." (0-3) — it
  *mitigates*, does not resolve.
- ✗ "MR-violation gives a deterministic oracle that **sidesteps** the oracle problem." (0-3)
- ✗ "Self-generated oracles are suitable **only** for regression, not logic faults."
  (1-2) — the measured *accuracy drop on buggy code* stands; the universal generalization
  does not.
- ✗ "PBT and example-based tests have **complementary, non-overlapping** failure modes."
  (0-3) — they overlap (9/16 caught by both).
- ✗ "LLM oracle textual accuracy scales ~10× with model size (3 %→29 %)." (0-3)

## 9. Actionable practices for roster (the takeaways)

1. Make the **evidence-strength axis** a first-class, ranked field on every finding/
   decision (untested → code-read → executed → differentially-checked). *(partly landed
   in roster-investigate; promote it harness-wide).*
2. Require an **exit-code oracle artifact** for any nontrivial decision before it's
   trusted; store it with the decision (ties directly to the ADR-capture + traceability
   improvements already queued).
3. Use the LLM reviewer/qa as a **pre-filter gated by a sound deterministic check** —
   the independent-reviewer pattern we already use, but the *final* gate must be runnable.
4. **Compose** checker types in qa (types + PBT + differential), not a single test pass.
5. Prefer **spec/intent-derived and differential** oracles over implementation-derived
   ones to avoid encoding bugs.
6. Cap self-critique iteration (~2 rounds); spend the budget on external checks instead.

## Open questions (carry into the design discussion)

1. Do 2025–2026 reasoning models close the gen-verif gap enough to safely widen the
   self-verify pre-filter? (all strong negatives used older models)
2. How often do self-generated deterministic checks pass *vacuously* / overfit — and
   which anti-patterns (mutation-testing the test; differential vs implementation-derived;
   spec-derived oracles) measurably reduce it? (unquantified)
3. Real cost/latency of an exit-code-oracle-per-decision in a multi-agent harness, and
   the break-even vs bug-detection gain?
4. How to formally combine evidence signals (many weak agreeing vs one strong)?

## Sources (verified claims rest on these)

| ID | What it grounds |
|---|---|
| arXiv 2310.01798 (ICLR'24) | intrinsic self-correction fails/degrades; gains need oracle labels |
| arXiv 2406.01297 (TACL'24) | critical survey corroborating self-correction limits |
| arXiv 2310.08118 (NeurIPS'23 wksp) | self-critique < sound external verifier; verifier FPs |
| arXiv 2412.02674 (ICLR'25) | generation–verification gap; scales w/ compute; saturates 2-3 rounds |
| arXiv 2406.07791 | LLM-as-judge position bias; worst on near-ties |
| arXiv 2410.21136 | LLM oracle accuracy <50 %; implementation-biased on buggy code |
| arXiv 2406.06864 | metamorphic/consistency testing catches 75 % of bad GPT-4 programs |
| arXiv 2602.15761 (preprint) | LLM refactorings break semantics; differential-fuzz equivalence oracle |
| arXiv 2510.25297 (AIware'25) | PBT+EBT composition → 81 % edge-case detection |
| lucadigrazia ASE'25 | LLM-vs-human oracle mutation-score parity (with FP caveats) |
| Elsevier JSS S0164121224003741 | code-gen LLMs unstable under equivalent prompts |
| (surveyed, not in verified top-25) | debugml cheating-agents (Goodhart); weaver.pdf (weak-verifier aggregation); reproducibility/audit-log sources |

---

## Independent cross-check

**Verdict: PASS** (independent Haiku fact-checker, 2026-05-30, against the raw verified
research output — not the prose). Item-by-item result:

- **Numbers** — all substantive figures match the ground-truth findings exactly
  (7.6 %/8.8 %, <50 % & 41–46 %, 10/24 repos, ~8–9 % drop, 75 % & 8.6 % FP, 19–35 % &
  ~21 %, 11/16 & 13/16 = 81 %, 43 % vs 45 %, 2–3 rounds). No misleading rounding.
- **Citations** — every arXiv ID/source is attached to the finding it actually backs.
- **Refuted-as-fact** — none of the 5 refuted over-reaches leaked into §1–§7; §8 lists
  them correctly.
- **Confidence fidelity** — all `[high]`/`[medium]` + vote tags match (incl. the lone
  `[medium, 2-1]` oracle-parity claim).
- **Scope/overreach** — model-recency caveat, the "deterministic only in
  verdict-given-fixed-inputs" nuance, and the unquantified Goodhart/vacuous-check risk
  are all faithfully reproduced, not overstated.

No discrepancies found.
