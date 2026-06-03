# Adapter interfaces (Phase B — contracts, not yet implemented)

Two pluggable layers keep the benchmark stack-free and harness-free. Neither is built yet:
building a runner we cannot run (no pinned model / budget) is theater (methodology §0). These
are the contracts a Phase-B implementation must satisfy.

## 1. Arm adapter — "how do you drive the model to solve a stage?"

One adapter per harness under test. Decided arms (3): `bare` (raw stage prompt + run contract),
`plan-mode` (plan-first; activated via the `/plan` command), `roster` (follows roster's pipeline
skills). `plan-mode` is the control that separates roster's lift from generic planning (review H1).
Same problem, same **pinned model**, different driver.

Caveat: true plan mode is a Claude Code *session* feature (`/plan`); a sub-agent runner can only
approximate it (plan-first prompt). Either drive arms as real CC sessions or document the
approximation in the run report.

```
async function runStage({
  arm,            // "bare" | "roster@1.1.0" | ...
  problemDir,     // path to problems/<id>/
  stage,          // "S1".."S4"
  promptText,     // contents of stages/<stage>.md (+ run_contract from problem.json)
  repoDir,        // working copy; S1 starts empty, later stages carry prior state
  seed,           // integer; fresh agent context per stage
  model,          // pinned model id + version + temperature
}) -> {
  // side effect: repoDir now contains the produced/modified project
  costLog,        // object validating against lib/cost-log.schema.json
}
```

Rules:
- Fresh agent context each stage (no carryover) so arms differ only by harness, not memory.
- The adapter is shown `promptText` + the run contract ONLY. It is never shown the conformance
  suites or the invariant check (disjoint oracle).
- `costLog` is read from the provider/runner, never from agent self-report. The runner MUST assert
  identical `model`+`model_version`+`temperature` across all arms before aggregating (review M4).
- **Carry source, not data.** Later stages carry the produced source tree; each stage's scoring
  starts the project afresh. Account ids in conformance/invariant are nonce-namespaced per run, so
  a project that persists data to disk does not produce false cross-stage regressions (review C1).

## 2. Stack/mutation adapter — "internal-quality metrics for the stack the agent chose"

Detected post-hoc from `repoDir`. Optional and advisory.

```
function detectStack(repoDir) -> "node" | "python" | "go" | ... | "unknown"
async function internalMetrics(repoDir, stack) -> {
  mutation_score?, line_coverage?, branch_coverage?,   // if a tool exists for the stack
  unavailable?: "no adapter for <stack>",
}
```

Reference target: `node` (Stryker + c8). Any stack without an adapter records `unavailable` —
honest partial observation, never a fabricated number. MI/complexity are NOT reported as a
verdict.

## Live run shape (Phase B)

For each `arm × seed`: run S1→S4 via the arm adapter (carry repo, fresh context); after each
stage start the produced project (run contract) and run that stage's conformance suite + (S4)
the invariant; record `cost-log` per stage. Feed the per-stage results + costs to
`lib/score-run.mjs::aggregate`. Repeat across seeds; report ranges per the claims ledger.
