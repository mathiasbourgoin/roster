// Deterministic aggregation of one arm's run across stages.
// Pure function — fully unit-testable with no model and no server.
//
// Input shape:
//   { stages: [ { id, results:[{name,pass}], invariant?:{ok,violations}, cost?:{...} } ] }
// where cost = { total_tokens, usd, turns, wall_clock_s }.
//
// Outputs the stack-agnostic core metrics from the plan:
//  - per-stage conformance pass rate
//  - cross-stage regression (a test that passed in an earlier stage now fails)
//  - invariant result (S4)
//  - cost totals + cost-per-passing-stage
//
// A "passing stage" = full conformance AND (no invariant OR invariant.ok).
// Maintainability is NOT a single score here; it is read from regressions +
// the S3/S4 cost trend (see claims-ledger.md). MI/complexity are not computed.

export function aggregate({ stages }) {
  const report = { stages: [], regressions: [], warnings: [], totals: {} };
  const passedAt = {}; // test name -> first stage id where it passed
  const seenNames = new Set(); // union of all test names seen in prior stages

  for (const st of stages) {
    const results = st.results || [];
    const passCount = results.filter((r) => r.pass).length;
    const total = results.length;

    // Cumulative-superset guard (review M2): each stage must contain every test
    // name seen in any prior stage. A dropped name would silently mask breakage
    // (a vanished test is never flagged as a regression).
    const names = new Set(results.map((r) => r.name));
    for (const n of seenNames) {
      if (!names.has(n)) {
        report.warnings.push(
          `stage ${st.id} is missing test '${n}' seen in a prior stage — cumulative-superset violated; regression detection is unreliable`
        );
      }
    }
    for (const n of names) seenNames.add(n);

    // Regression: a test that passed in a PRIOR stage now fails.
    for (const r of results) {
      if (!r.pass && passedAt[r.name] && passedAt[r.name] !== st.id) {
        report.regressions.push({ test: r.name, passedAt: passedAt[r.name], failedAt: st.id });
      }
    }
    // Record first-pass AFTER regression check (so same-stage passes don't self-trigger).
    for (const r of results) {
      if (r.pass && !passedAt[r.name]) passedAt[r.name] = st.id;
    }

    report.stages.push({
      id: st.id,
      conformance: { pass: passCount, total, rate: total ? passCount / total : 0 },
      invariant: st.invariant ?? null,
      cost: st.cost ?? null,
    });
  }

  const costStages = stages.filter((s) => s.cost);
  const sum = (k) => costStages.reduce((a, s) => a + (s.cost[k] || 0), 0);
  const passingStages = report.stages.filter(
    (s) => s.conformance.rate === 1 && (!s.invariant || s.invariant.ok)
  ).length;

  report.totals = {
    tokens: sum("total_tokens"),
    usd: sum("usd"),
    turns: sum("turns"),
    wall_clock_s: sum("wall_clock_s"),
    stages: stages.length,
    passing_stages: passingStages,
    regressions: report.regressions.length,
    cost_per_passing_stage: passingStages
      ? { tokens: sum("total_tokens") / passingStages, usd: sum("usd") / passingStages }
      : null,
  };
  return report;
}

// Tiny CLI: `node score-run.mjs run.json` -> prints aggregate JSON.
// (Phase B emits run.json from a live arm; here it is just a viewer.)
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node score-run.mjs <run.json>");
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  console.log(JSON.stringify(aggregate(data), null, 2));
}
