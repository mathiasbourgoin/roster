# Claims Ledger — Quality/Cost Benchmark

Mandatory. A run licenses only the claims in the left column and **must not** state anything
in the right column. This is the anti-"best because we feel it" mechanism (methodology §4).

| A run on problem P, model M@date, K seeds licenses … | It does NOT license … |
|---|---|
| "roster did not regress earlier-stage contracts on P, M@date, K seeds, vs `<arm>`" | "roster is reliable / better in general" |
| "roster held the S4 invariant in k/K seeds vs `<arm>`'s j/K" | "roster produces correct code" (beyond P) |
| "roster's total token/$ cost on P was N× `<arm>`'s, K seeds" | "roster is cheaper" in general / on other stacks |
| "within roster, S3 cost was X% of S2 cost (arch leverage on P)" | any **cross-arm** LOC/churn comparison (incomparable across stacks) |
| "mutation score was S where a stack adapter existed" | a mutation/coverage claim where no adapter ran |
| anything | **"roster is better"** — unlicensed by any feasible n |

## Hard rules

- **Cost is the only valid cross-arm efficiency metric.** LOC/diff/complexity are within-arm or
  advisory; never compared across arms.
- **No single maintainability score.** Report regressions + the S3/S4 cost trend; do not report
  MI or cyclomatic complexity as a verdict.
- **Agent runs are stochastic.** No single-seed claim; report ranges across seeds.
- **Disjointness (look-once-then-burn).** If a conformance test is read to debug an arm's
  failure, that test is spent — rotate it out and disclose the burn. The suite must stay a
  measurement, not a target.
- Every claim is **dated and problem-scoped**. The problem changes → the claim does not transfer.
- **`cost_per_passing_stage` conflates correctness and efficiency** (review M2): an arm passing
  1/4 stages shows 4× the per-stage cost of one passing 4/4 at equal spend. Quote raw cost +
  passing-stage count together; never quote cost-per-passing-stage alone.
- **n=2 (the planned scale) is still anecdote-grade.** Report per-seed values and the range; a
  small-integer delta (e.g. 0 vs 2 regressions) across 2 seeds is not a comparison.
