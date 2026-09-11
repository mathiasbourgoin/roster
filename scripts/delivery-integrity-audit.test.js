"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { audit, stableStringify } = require("./delivery-integrity-audit");

const SCRIPT = path.join(__dirname, "delivery-integrity-audit.js");

function input(overrides = {}) {
  return Object.assign({
    schema_version: 1,
    branch_protection: { known: true, enabled: true },
    direct_commit_count: 0,
    required_checks: ["test"],
    pull_requests: [{ number: 12, merged: true, checks: [{ name: "test", conclusion: "success" }], reviews: [{ state: "approved" }] }],
  }, overrides);
}

test("healthy controls pass", () => {
  const result = audit(input());
  assert.deepEqual(result.findings.map((finding) => [finding.id, finding.status]), [
    ["BRANCH_PROTECTION_ENABLED", "pass"],
    ["DIRECT_COMMITS_ABSENT", "pass"],
    ["PR_REQUIRED_CHECKS_GREEN:pr-12", "pass"],
    ["PR_REVIEW_EVIDENCE:pr-12", "pass"],
  ]);
});

test("failed required check and control gaps preserve exact evidence", () => {
  const result = audit(input({
    branch_protection: { known: true, enabled: false }, direct_commit_count: 2,
    pull_requests: [{ number: 7, merged: true, checks: [{ name: "test", conclusion: "failure" }], reviews: [] }],
  }));
  assert.deepEqual(result.findings.filter((finding) => finding.status === "fail").map((finding) => finding.id), [
    "BRANCH_PROTECTION_ENABLED", "DIRECT_COMMITS_ABSENT", "PR_REQUIRED_CHECKS_GREEN:pr-7", "PR_REVIEW_EVIDENCE:pr-7",
  ]);
  assert.deepEqual(result.findings.find((finding) => finding.id === "PR_REQUIRED_CHECKS_GREEN:pr-7").evidence, ["pull_requests[number=7].checks[name=test]"]);
});

test("missing evidence is not reported as a pass", () => {
  const result = audit(input({ branch_protection: { known: false }, pull_requests: [{ number: 7, merged: true, reviews: [] }] }));
  assert.equal(result.findings.find((finding) => finding.id === "BRANCH_PROTECTION_ENABLED").status, "not-verifiable");
  assert.equal(result.findings.find((finding) => finding.id === "PR_REQUIRED_CHECKS_GREEN:pr-7").status, "not-verifiable");
});

test("serialization is stable across object-key and input-array ordering", () => {
  const first = input();
  first.required_checks = ["lint", "test"];
  first.pull_requests.push({ number: 7, merged: true, checks: [{ name: "lint", conclusion: "success" }, { name: "test", conclusion: "success" }], reviews: [{ state: "approved" }] });
  first.pull_requests[0].checks.push({ name: "lint", conclusion: "success" });
  const second = { pull_requests: [...first.pull_requests].reverse().map((pr) => ({ ...pr, checks: [...pr.checks].reverse(), reviews: [...pr.reviews].reverse() })), required_checks: [...first.required_checks].reverse(), direct_commit_count: 0, branch_protection: { enabled: true, known: true }, schema_version: 1 };
  assert.equal(stableStringify(audit(first)), stableStringify(audit(second)));
});

test("CLI rejects unknown input shape", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-audit-"));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, JSON.stringify(input({ extra: true })));
  const result = spawnSync("node", [SCRIPT, file], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown top-level key/);
});

test("CLI rejects malformed nested delivery evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-audit-"));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, JSON.stringify(input({ pull_requests: [{ number: 12, merged: true, checks: [{ name: "test" }] }] })));
  const result = spawnSync("node", [SCRIPT, file], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /checks has invalid shape/);
});

test("CLI rejects unknown nested delivery evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-audit-"));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, JSON.stringify(input({ branch_protection: { known: true, enabled: true, bypass: false } })));
  const result = spawnSync("node", [SCRIPT, file], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /branch_protection has invalid shape/);
});
