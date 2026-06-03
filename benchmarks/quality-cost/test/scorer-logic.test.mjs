// Pure unit tests for the deterministic aggregator. No model, no server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../lib/score-run.mjs";

test("detects a cross-stage regression", () => {
  const r = aggregate({
    stages: [
      { id: "S2", results: [{ name: "t.deposit", pass: true }, { name: "t.create", pass: true }] },
      {
        id: "S3",
        results: [
          { name: "t.deposit", pass: false }, // regressed
          { name: "t.create", pass: true },
          { name: "t.withdraw", pass: true },
        ],
      },
    ],
  });
  assert.equal(r.regressions.length, 1);
  assert.deepEqual(r.regressions[0], { test: "t.deposit", passedAt: "S2", failedAt: "S3" });
});

test("no regression when nothing earlier breaks", () => {
  const r = aggregate({
    stages: [
      { id: "S2", results: [{ name: "a", pass: true }] },
      { id: "S3", results: [{ name: "a", pass: true }, { name: "b", pass: true }] },
    ],
  });
  assert.equal(r.regressions.length, 0);
});

test("a same-stage failure is NOT a regression", () => {
  const r = aggregate({
    stages: [{ id: "S1", results: [{ name: "a", pass: false }] }],
  });
  assert.equal(r.regressions.length, 0);
});

test("cost totals and cost-per-passing-stage", () => {
  const r = aggregate({
    stages: [
      { id: "S1", results: [{ name: "a", pass: true }], cost: { total_tokens: 100, usd: 1, turns: 2, wall_clock_s: 10 } },
      {
        id: "S2",
        results: [{ name: "a", pass: true }, { name: "b", pass: true }],
        cost: { total_tokens: 200, usd: 2, turns: 3, wall_clock_s: 20 },
      },
    ],
  });
  assert.equal(r.totals.tokens, 300);
  assert.equal(r.totals.usd, 3);
  assert.equal(r.totals.passing_stages, 2);
  assert.equal(r.totals.cost_per_passing_stage.tokens, 150);
});

test("an invariant violation disqualifies a stage from 'passing'", () => {
  const r = aggregate({
    stages: [
      {
        id: "S4",
        results: [{ name: "a", pass: true }],
        invariant: { ok: false, violations: ["negative balance"] },
        cost: { total_tokens: 10 },
      },
    ],
  });
  assert.equal(r.totals.passing_stages, 0);
});

test("a failing conformance test disqualifies a stage from 'passing'", () => {
  const r = aggregate({
    stages: [{ id: "S2", results: [{ name: "a", pass: true }, { name: "b", pass: false }] }],
  });
  assert.equal(r.totals.passing_stages, 0);
});

test("warns when a later stage drops a test seen in a prior stage (cumulative-superset)", () => {
  const r = aggregate({
    stages: [
      { id: "S2", results: [{ name: "a", pass: true }, { name: "b", pass: true }] },
      { id: "S3", results: [{ name: "a", pass: true }] }, // dropped 'b'
    ],
  });
  assert.ok(
    r.warnings.some((w) => w.includes("'b'") && w.includes("S3")),
    "expected a cumulative-superset warning, got: " + JSON.stringify(r.warnings)
  );
});
