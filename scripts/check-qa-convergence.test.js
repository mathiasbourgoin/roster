// Tests for scripts/check-qa-convergence.js (spec: specs/qa-loop-bounding.md,
// FR-260..286). Mirrors the scripts/check-review-convergence.test.js
// harness pattern (fixture-driven, one test per exit code + qualifying
// rule, CHECK-3/CHECK-4/FR-283).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "check-qa-convergence.js");
const FIXTURES = path.resolve(__dirname, "fixtures");
const REPO_ROOT = path.resolve(__dirname, "..");

function gate(statePath, extraArgs = [], cwd = REPO_ROOT) {
  try {
    const stdout = execFileSync("node", [SCRIPT, statePath, ...extraArgs], { cwd, stdio: "pipe" }).toString();
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || "").toString(), stderr: (e.stderr || "").toString() };
  }
}

function writeState(dir, obj, name = "qa-state.json") {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qa-convergence-"));
}

function auditEntry(round, overrides = {}) {
  return Object.assign({ round, date: "2026-07-14T00:00:00Z", verdict: "NO-GO", causes: [], qualifying: false }, overrides);
}

// ── exit-code coverage (FR-283) ──────────────────────────────────────────

test("absent qa-state.json -> exit 2", () => {
  const r = gate(path.join(tmpDir(), "nope.json"));
  assert.strictEqual(r.code, 2);
});

test("malformed JSON -> exit 2", () => {
  const dir = tmpDir();
  const p = path.join(dir, "qa-state.json");
  fs.writeFileSync(p, "{ not json");
  const r = gate(p);
  assert.strictEqual(r.code, 2);
});

test("unknown flag -> exit 2", () => {
  const dir = tmpDir();
  const p = writeState(dir, { status: "GO", round: 1, cycle: 1, rounds_audit: [] });
  const r = gate(p, ["--bogus"]);
  assert.strictEqual(r.code, 2);
});

test("schema-invalid (missing required top-level field) -> exit 2", () => {
  const dir = tmpDir();
  const p = writeState(dir, { round: 1, cycle: 1, rounds_audit: [] }); // missing status
  const r = gate(p);
  assert.strictEqual(r.code, 2);
});

test("below-cap fixture -> exit 0", () => {
  const r = gate(path.join(FIXTURES, "qa-state-below-cap.json"), ["--max-rounds", "5"]);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, null);
  assert.deepStrictEqual(report.config, { max_rounds: 5 });
});

test("cap-hit fixture (qa_no_go_round == max_rounds, EC-5 inclusive) -> exit 1, cause qa-round-cap", () => {
  const r = gate(path.join(FIXTURES, "qa-state-cap-hit.json"), ["--max-rounds", "5"]);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, "qa-round-cap");
});

test("--max-rounds override raises the cap (below the new cap) -> exit 0", () => {
  const r = gate(path.join(FIXTURES, "qa-state-cap-hit.json"), ["--max-rounds", "10"]);
  assert.strictEqual(r.code, 0);
});

test("missing-audit fixture (no rounds_audit entry for current round) -> exit 3", () => {
  const r = gate(path.join(FIXTURES, "qa-state-missing-audit.json"), ["--max-rounds", "5"]);
  assert.strictEqual(r.code, 3);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, null, "process-incomplete must never be the top-level cause");
});

test("legacy-no-counter fixture (qa_no_go_round absent) -> exit 0 with warning, not exit 2", () => {
  const r = gate(path.join(FIXTURES, "qa-state-legacy-no-counter.json"), ["--max-rounds", "5"]);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.qa_no_go_round, 0);
  assert.ok(report.warnings.some((w) => w.includes("qa_no_go_round")));
});

// ── qualifying-cause classification (FR-268/269/270, EC-4) ───────────────

test("cross-runtime-discrepancy fixture: qa_no_go_round unchanged, round still bumped", () => {
  const r = gate(path.join(FIXTURES, "qa-state-cross-runtime.json"), ["--max-rounds", "5"]);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.qa_no_go_round, 2);
  assert.strictEqual(report.round, 3);
});

test("each qualifying cause increments qa_no_go_round (isQualifying unit contract via rules module)", () => {
  const { isQualifying } = require("./lib/qa/qa-convergence-rules");
  assert.strictEqual(isQualifying(auditEntry(2, { causes: ["gate-failure"], qualifying: true })), true);
  assert.strictEqual(isQualifying(auditEntry(2, { causes: ["spec-check-failure"], qualifying: true })), true);
  assert.strictEqual(isQualifying(auditEntry(2, { causes: ["code-intel-violation"], qualifying: true })), true);
  assert.strictEqual(isQualifying(auditEntry(2, { causes: ["tui-failure"], qualifying: true })), true);
});

test("cross-runtime-discrepancy and code-intel-malformed do NOT qualify (unit contract)", () => {
  const { isQualifying } = require("./lib/qa/qa-convergence-rules");
  assert.strictEqual(isQualifying(auditEntry(2, { causes: ["cross-runtime-discrepancy"] })), false);
  assert.strictEqual(isQualifying(auditEntry(2, { causes: ["code-intel-malformed"] })), false);
});

test("mixed-cause round (qualifying + non-qualifying) qualifies once, records all causes (EC-4)", () => {
  const { isQualifying } = require("./lib/qa/qa-convergence-rules");
  const entry = auditEntry(2, { causes: ["gate-failure", "cross-runtime-discrepancy"] });
  assert.strictEqual(isQualifying(entry), true);
  assert.strictEqual(entry.causes.length, 2);
});

// ── read-only guarantee (CHECK-4/AC-11) ──────────────────────────────────

test("gate run against a fixture leaves the repo tree unchanged (read-only, FR-279)", () => {
  const { execSync } = require("node:child_process");
  const before = execSync("git status --porcelain", { cwd: REPO_ROOT }).toString();
  gate(path.join(FIXTURES, "qa-state-below-cap.json"), ["--max-rounds", "5"], REPO_ROOT);
  gate(path.join(FIXTURES, "qa-state-cap-hit.json"), ["--max-rounds", "5"], REPO_ROOT);
  gate(path.join(FIXTURES, "qa-state-missing-audit.json"), ["--max-rounds", "5"], REPO_ROOT);
  const after = execSync("git status --porcelain", { cwd: REPO_ROOT }).toString();
  assert.strictEqual(after, before, "the gate must not modify or create any repo file (FR-279)");
});

// ── exports contract ──────────────────────────────────────────────────────

test("module exports parseArgs, decideExit, buildReport", () => {
  const mod = require("./check-qa-convergence.js");
  assert.strictEqual(typeof mod.parseArgs, "function");
  assert.strictEqual(typeof mod.decideExit, "function");
  assert.strictEqual(typeof mod.buildReport, "function");
});
