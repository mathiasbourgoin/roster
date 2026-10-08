"use strict";
// The pack's old stub tests asserted PASS from a fabricated calls/symbols DB.
// These checks cover the fail-closed contract. A compressed real producer DB
// is exercised by extensions/arch-index/test_adapter.py below.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pack = path.resolve(__dirname, "../extensions/arch-index/skills");
const gate = path.join(pack, "arch-index-gate/gate.sh");
const audit = path.join(pack, "arch-index-audit/audit.sh");
test("real CMT fixture: adapter and provenance checks", () => {
  const result = spawnSync("python3", ["-m", "unittest", "extensions/arch-index/test_adapter.py", "-v"],
    { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /test_real_cmt_and_fail_closed_gate .* ok/);
  assert.doesNotMatch(result.stderr, /skipped/);
});

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arch-index-pack-"));
  fs.mkdirSync(path.join(root, ".arch-index"));
  return root;
}
function run(root, script, args = []) {
  return spawnSync("bash", [script, ...args], { cwd: root, encoding: "utf8" });
}
test("gate: arbitrary SQL reachability cannot PASS on a partial index", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".arch-index/index.db"), "");
  const block = path.join(root, "checks.jsonl");
  fs.writeFileSync(block, '{"type":"reachability","check":{"query":"SELECT 1","expect":"none"}}\n');
  const result = run(root, gate, [block]);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /schema-mismatch/);
  assert.doesNotMatch(result.stdout, /PASS/);
});
test("gate: malformed block remains exit 2", () => {
  const root = project();
  const block = path.join(root, "checks.jsonl");
  fs.writeFileSync(block, "{\n");
  assert.equal(run(root, gate, [block]).status, 2);
});
test("gate: empty declarations are vacuous", () => {
  const root = project();
  const block = path.join(root, "checks.jsonl");
  fs.writeFileSync(block, "\n");
  const result = run(root, gate, [block]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0 invariants/);
});
test("audit: unsupported database emits no fragment", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".arch-index/index.db"), "");
  const result = run(root, audit);
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
});
