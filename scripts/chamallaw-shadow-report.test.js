"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { report } = require("./chamallaw-shadow-report.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-chamallaw-shadow-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

function write(task, text) {
  const dir = path.join(root, task);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "chamallaw-shadow.md"), text);
}

test("aggregates health without treating shadow data as routing", () => {
  write("available", `- Route retained: roster.intake
- Routing changed: no
- MCP status: available
- Assessment: assessed
- Posterior: Beta(3, 1)
- Verified outcome count: 2
- Human review minutes: 7
- Comparison label: positive
- Mutation MCP tools called: no
`);
  write("abstained", `- Route retained: roster.intake
- Routing changed: no
- MCP status: available
- Assessment: abstained
- Posterior: n/a
- Verified outcome count: 0
- Human review minutes: 3
- Comparison label: unknown
- Mutation MCP tools called: no
`);
  write("outage", `- Route retained: roster.intake
- Routing changed: no
- MCP status: unavailable
- Assessment: unavailable
- Posterior: n/a
- Verified outcome count: n/a
- Human review minutes: n/a
- Comparison label: unknown
- Mutation MCP tools called: no
`);
  assert.deepEqual(report(root).counts, {
    observations: 3, available: 2, unavailable: 1, errors: 0,
    assessed: 1, abstained: 1, routing_changed: 0,
    mutation_tool_violations: 0, verified_outcomes: 2, verified_outcomes_known: 2,
    comparison_labels_positive: 1, comparison_labels_negative: 0,
    comparison_labels_unknown: 2, calibration_observations: 1,
    brier_score: 0.0625, human_review_minutes: 10, human_review_minutes_known: 2,
  });
});

test("flags unsafe or malformed disposition fields", () => {
  const before = report(root).counts;
  write("unsafe", `- Route retained: roster.intake
- Routing changed: yes
- MCP status: error
- Assessment: error
- Posterior: Beta(0, 1)
- Verified outcome count: n/a
- Human review minutes: -1
- Comparison label: negative
- Mutation MCP tools called: yes
`);
  const counts = report(root).counts;
  assert.equal(counts.routing_changed, 1);
  assert.equal(counts.mutation_tool_violations, 1);
  assert.equal(counts.errors, 1);
  assert.equal(counts.calibration_observations, before.calibration_observations);
  assert.equal(counts.human_review_minutes_known, before.human_review_minutes_known);
});
