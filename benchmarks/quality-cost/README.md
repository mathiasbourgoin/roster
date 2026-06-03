# Roster Quality/Cost Benchmark

Deterministic, reproducible measurement of whether a harness (roster, a bare agent,
speckit, …) makes an LLM produce **better, more maintainable projects for less cost**.

This is **not** a benchmark of "is roster deterministic." It is a benchmark *with*
deterministic metrics that measures a harness's effect on output quality and cost.

See `../../docs/plans/roster-quality-cost-benchmark-2026-05-31.md` for the full design and
its research anchors.

## How it works

A fixed **problem** is defined by an **external contract**, not a stack. Each arm decides
its own language/architecture — that choice is part of what we measure. The problem has 4
**compounding** stages (scaffold → feature A → similar feature B → error-prone
invariant-stressing change). Roster's value is invisible in one isolated task; it shows up
as **lower S3/S4 cost and fewer cross-stage regressions**.

Each `(arm × seed)` runs with **fresh agent context per stage** (repo state carries). Agent
runs are stochastic and costly, so real evaluation uses **multiple seeds and reports ranges**.

## What is measured (and how honest each metric is)

**Stack-agnostic deterministic core — STRONG (the real measurement):**
- **Contract conformance** — a held-out black-box suite hits the project over HTTP/JSON; the
  agent never sees it (disjoint oracle; look-once-then-burn).
- **Cross-stage regression** — a test that passed in an earlier stage now fails. The
  maintainability signal.
- **Invariant preservation (S4)** — a differential check of a named invariant.
- **Cost** — tokens/$/turns/wall-clock from the arm's cost log. The clean **cross-arm** metric.

**Within-arm only — MODERATE:** change-leverage (diff size S2→S3). Never compared across arms
(a Go vs TS diff isn't comparable).

**Stack-specific, pluggable, advisory:** mutation score / coverage via a per-stack adapter
*if one exists*, else recorded "unavailable." MI / cyclomatic complexity are **folklore — never
a verdict** (Shepperd; Landman; Kapser-Godfrey).

**There is no single valid deterministic "maintainability score."** Maintainability is read
from regressions + the S3/S4 cost trend, not from a static number. See `claims-ledger.md`.

## Layout

```
problems/<id>/        problem.json + stages/*.md + conformance/*.mjs + invariant/*.mjs
lib/                  conformance-runner, score-run (pure aggregator), http, cost-log schema
lib/adapters/         arm-adapter + stack/mutation adapter interfaces (Phase B)
test/                 scorer self-tests + reference fixtures (correct + buggy)
```

## Run

```
npm run bench:quality-cost:test    # scorer correctness + end-to-end harness self-test (no model)
```

## Status

- **Phase A (here, runnable now, zero model spend):** the eval harness + deterministic scorers
  + one concrete problem (`ledger-service`) + self-tests proving the scorers discriminate a
  correct impl from a broken one.
- **Phase B (not built; needs a pinned model + budget):** the live arm-runner that drives
  `bare` vs `roster` across the stages and emits repos + cost logs. Contract in
  `lib/adapters/README.md`.
