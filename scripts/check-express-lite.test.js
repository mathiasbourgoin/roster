"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const checker = path.join(root, "scripts/check-express-lite.js");
const files = [
  "skills/pipeline/roster-run.md", "skills/shared/preamble-pipeline.md",
  "skills/pipeline/roster-doctor.md", "skills/pipeline/roster-implement.md",
  "skills/pipeline/roster-review.md", "skills/pipeline/roster-ship.md",
  "schema/review-json-schema.md",
];

function fixture(mutator) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "express-lite-check-"));
  for (const file of files) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  mutator(dir);
  return dir;
}

function check(dir) {
  return execFileSync("node", [checker, "--check", "--root", dir], { encoding: "utf8", stdio: "pipe" });
}

test("Express Lite contract accepts the source contract", () => {
  const dir = fixture(() => {});
  try { assert.match(check(dir), /contract: ok/); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Express Lite contract rejects removed semantic exclusions", () => {
  const dir = fixture((tmp) => {
    const file = path.join(tmp, "skills/pipeline/roster-run.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Every changed hunk is demonstrably non-behavioral", "Changed hunks are reviewed"));
  });
  try { assert.throws(() => check(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Express Lite contract rejects a removed final reclassification NO-GO", () => {
  const dir = fixture((tmp) => {
    const file = path.join(tmp, "skills/pipeline/roster-review.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('no_go_reason.type: "express-lite-ineligible"', "reclassification required"));
  });
  try { assert.throws(() => check(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
