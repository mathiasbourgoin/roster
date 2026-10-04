"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { evaluate } = require("./chamallaw-shadow-gate.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-chamallaw-gate-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function write(task, body) {
  const dir = path.join(root, task);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "chamallaw-shadow.md"), body);
}

const config = {
  schema_version: 1,
  created_at: "2026-10-01T00:00:00Z",
  comparison_period: {
    starts_at: "2026-10-02T00:00:00Z",
    ends_at: "2026-10-04T00:00:00Z",
  },
  minimum_observations: 2,
  minimum_calibration_observations: 2,
  maximum_brier_score: 0.02,
  maximum_mean_human_review_minutes: 5,
  require_zero_routing_changes: true,
  require_zero_mutation_tool_violations: true,
};

function observation(at, posterior, label, minutes) {
  return `- Observed at: ${at}
- Routing changed: no
- MCP status: available
- Assessment: assessed
- Posterior: ${posterior}
- Verified outcome count: 1
- Human review minutes: ${minutes}
- Comparison label: ${label}
- Mutation MCP tools called: no
`;
}

test("requires a completed predeclared period before human review", () => {
  write("positive", observation("2026-10-02T12:00:00Z", "Beta(9, 1)", "positive", 4));
  write("negative", observation("2026-10-03T12:00:00Z", "Beta(1, 9)", "negative", 5));
  const result = evaluate(root, config, new Date("2026-10-05T00:00:00Z"));
  assert.equal(result.eligible_for_human_review, true);
  assert.equal(result.promotion, "not-automated");
  assert.equal(result.counts.calibration_observations, 2);
  assert.equal(result.mean_human_review_minutes, 4.5);
});

test("fails closed on an unended or malformed evaluation", () => {
  const unended = evaluate(root, config, new Date("2026-10-03T00:00:00Z"));
  assert.equal(unended.eligible_for_human_review, false);
  assert.ok(unended.reasons.includes("comparison period has not ended"));
  const malformed = evaluate(root, { ...config, created_at: "not-a-date" });
  assert.equal(malformed.eligible_for_human_review, false);
  assert.ok(malformed.errors.length > 0);
});
