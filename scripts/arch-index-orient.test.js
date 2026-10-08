"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const orient = path.resolve(__dirname, "../extensions/arch-index/skills/arch-index-orient/orient.sh");
function run(mode, withEmptyDb = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arch-index-orient-"));
  if (withEmptyDb) {
    fs.mkdirSync(path.join(root, ".arch-index"));
    fs.writeFileSync(path.join(root, ".arch-index/index.db"), "");
  }
  return spawnSync("bash", [orient, mode], { cwd: root, encoding: "utf8" });
}
test("orientation: missing index degrades without JSON/header", () => {
  const result = run("fan-in");
  assert.equal(result.status, 3);
  assert.match(result.stderr, /index-missing/);
  assert.equal(result.stdout, "");
});
test("orientation: an empty SQLite file cannot be mistaken for an empty graph", () => {
  const result = run("fan-in", true);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /schema-mismatch/);
  assert.equal(result.stdout, "");
});
test("orientation: invalid mode degrades", () => {
  const result = run("invalid-mode", true);
  assert.equal(result.status, 3);
});
