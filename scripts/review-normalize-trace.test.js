// Tests for scripts/review-normalize.js's FR-166 self-append (spec:
// specs/r5-trace-enforcement.md US-2, CHECK-3). Verifies: the normalizer
// self-appends its own `normalizer` trace line append-before-stdout when
// --task/--round/--cycle are all given; an append failure (EACCES) surfaces
// as a warning with unchanged exit code and unchanged normalization result
// (AC-3); normalize() itself stays pure (selfAppendTrace is a separate,
// unit-testable function that only touches `result.warnings`).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { selfAppendTrace } = require("./review-normalize");
const { tracePath } = require("./lib/review/review-trace");

const SCRIPT = path.resolve(__dirname, "review-normalize.js");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "review-normalize-trace-"));
}

// ── unit: selfAppendTrace (pure-ish, isolated from normalize()) ──────────

test("selfAppendTrace: appends nothing when --task/--round/--cycle are not all given", () => {
  const dir = tmpRepo();
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const result = { warnings: [] };
    selfAppendTrace({ task: "demo", round: 1, cycle: null }, result);
    assert.strictEqual(fs.existsSync(tracePath(dir, "demo")), false);
    assert.deepStrictEqual(result.warnings, []);
  } finally {
    process.chdir(cwd);
  }
});

test("selfAppendTrace: appends a schema-valid normalizer line when all three are given", () => {
  const dir = tmpRepo();
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const result = { warnings: [] };
    selfAppendTrace({ task: "demo", round: 2, cycle: 1 }, result);
    const raw = fs.readFileSync(tracePath(dir, "demo"), "utf8").trim();
    const line = JSON.parse(raw);
    assert.strictEqual(line.event, "normalizer");
    assert.strictEqual(line.actor, "review-normalize.js");
    assert.strictEqual(line.outcome, "ran");
    assert.strictEqual(line.round, 2);
    assert.strictEqual(line.cycle, 1);
    assert.strictEqual(line.task, "demo");
    assert.strictEqual(line.schema_version, "1.0");
    assert.deepStrictEqual(result.warnings, []);
  } finally {
    process.chdir(cwd);
  }
});

test("selfAppendTrace: append failure (briefs/ unwritable) surfaces as a warning, never throws", () => {
  const dir = tmpRepo();
  const cwd = process.cwd();
  const briefsDir = path.join(dir, "briefs");
  fs.mkdirSync(briefsDir);
  fs.chmodSync(briefsDir, 0o444); // read-only: appendFileSync/mkdirSync inside it fails
  try {
    process.chdir(dir);
    const result = { warnings: [] };
    assert.doesNotThrow(() => selfAppendTrace({ task: "demo", round: 1, cycle: 1 }, result));
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /review-trace append failed/);
  } finally {
    fs.chmodSync(briefsDir, 0o755);
    process.chdir(cwd);
  }
});

// ── CLI: append-before-stdout, exit code + normalization result unchanged ──

test("CLI: --task/--round/--cycle produce a trace file, stdout/exit unchanged relative to omitting them", () => {
  const dir = tmpRepo();
  const findingFile = path.join(dir, "findings.json");
  fs.writeFileSync(
    findingFile,
    JSON.stringify([
      {
        severity: "HIGH",
        confidence: 4,
        path: "lib/foo.ml",
        line: 42,
        category: "correctness",
        summary: "Off-by-one",
        evidence: "lib/foo.ml:42 — evidence",
        fix: "fix it",
        fingerprint: "lib/foo.ml:42:correctness",
        specialist: "reviewer",
      },
    ])
  );

  const withoutTrace = execFileSync("node", [SCRIPT, findingFile], { cwd: dir }).toString();
  const withTrace = execFileSync(
    "node",
    [SCRIPT, findingFile, "--task", "demo-task", "--round", "1", "--cycle", "1"],
    { cwd: dir }
  ).toString();

  const parsedWithout = JSON.parse(withoutTrace);
  const parsedWith = JSON.parse(withTrace);
  // Normalization result identical apart from warnings (which stay empty in
  // both cases here — no append failure) — the trace append never perturbs
  // the normalizer's own output.
  assert.deepStrictEqual(parsedWithout.findings, parsedWith.findings);
  assert.deepStrictEqual(parsedWithout.stats, parsedWith.stats);
  assert.strictEqual(fs.existsSync(path.join(dir, "briefs", "demo-task-review-trace.jsonl")), true);
});

test("CLI: EACCES on the trace append -> warning in stdout JSON, exit 0 unchanged, normalization result unchanged", () => {
  const dir = tmpRepo();
  const findingFile = path.join(dir, "findings.json");
  fs.writeFileSync(findingFile, JSON.stringify([]));
  const briefsDir = path.join(dir, "briefs");
  fs.mkdirSync(briefsDir);
  fs.chmodSync(briefsDir, 0o444);

  try {
    let stdout;
    let status = 0;
    try {
      stdout = execFileSync("node", [SCRIPT, findingFile, "--task", "demo-task", "--round", "1", "--cycle", "1"], {
        cwd: dir,
      }).toString();
    } catch (e) {
      stdout = (e.stdout || "").toString();
      status = e.status;
    }
    assert.strictEqual(status, 0, "append failure must never change the exit code");
    const result = JSON.parse(stdout);
    assert.ok(
      result.warnings.some((w) => /review-trace append failed/.test(w)),
      JSON.stringify(result.warnings)
    );
    assert.deepStrictEqual(result.findings, []);
  } finally {
    fs.chmodSync(briefsDir, 0o755);
  }
});
