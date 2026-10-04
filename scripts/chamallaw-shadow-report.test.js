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
  write("available", `- Routing changed: no
- MCP status: available
- Assessment: assessed
- Verified outcome count: 2
- Mutation MCP tools called: no
`);
  write("abstained", `- Routing changed: no
- MCP status: available
- Assessment: abstained
- Verified outcome count: 0
- Mutation MCP tools called: no
`);
  write("outage", `- Routing changed: no
- MCP status: unavailable
- Assessment: unavailable
- Verified outcome count: n/a
- Mutation MCP tools called: no
`);
  assert.deepEqual(report(root).counts, {
    observations: 3, available: 2, unavailable: 1, errors: 0,
    assessed: 1, abstained: 1, routing_changed: 0,
    mutation_tool_violations: 0, verified_outcomes: 2, verified_outcomes_known: 2,
  });
});

test("flags unsafe or malformed disposition fields", () => {
  write("unsafe", `- Routing changed: yes
- MCP status: error
- Assessment: error
- Verified outcome count: n/a
- Mutation MCP tools called: yes
`);
  const counts = report(root).counts;
  assert.equal(counts.routing_changed, 1);
  assert.equal(counts.mutation_tool_violations, 1);
  assert.equal(counts.errors, 1);
});
