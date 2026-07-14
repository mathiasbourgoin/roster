// End-to-end gate fixtures for the r5-trace-enforcement mechanism (spec:
// specs/r5-trace-enforcement.md US-3/US-4, CHECK-4/5/6). Split into its own
// file (same FIX-3 precedent as check-review-convergence-rules.test.js) so
// check-review-convergence.test.js's pre-existing tests stay untouched
// (FR-179) and no single file balloons further. Exercises exits 0/3/1/2 per
// AC-4..AC-7, the `trace` block on every exit (FR-176), selectCause
// precedence with unattested-invocation (FR-174), cross-runtime
// corroboration hit/miss with a byte-identical-journal assertion
// (FR-163/FR-164), and rollout fixtures (AC-9).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "check-review-convergence.js");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-convergence-trace-"));
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: "pipe" }).toString();
  run("git init -q .");
  run("git config user.email t@t && git config user.name t && git config commit.gpgsign false");
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  run("git add -A && git commit -qm base");
  return { dir, run };
}

function writeReview(repo, obj, name = "demo-task-review.json") {
  const p = path.join(repo.dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function writeTraceLines(repo, task, lines) {
  const p = path.join(repo.dir, `${task}-review-trace.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return p;
}

function writeJournalLines(repo, task, entries) {
  const p = path.join(repo.dir, `${task}-xruntime.jsonl`);
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

function gate(repo, reviewPath, extraArgs = ["--static"]) {
  try {
    const stdout = execFileSync("node", [SCRIPT, reviewPath, ...extraArgs], { cwd: repo.dir, stdio: "pipe" }).toString();
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || "").toString(), stderr: (e.stderr || "").toString() };
  }
}

function traceLine(overrides) {
  return Object.assign(
    { schema_version: "1.0", ts: "2026-07-14T00:00:00Z", task: "demo-task", round: 2, cycle: 1, event: "normalizer", actor: "review-normalize.js", outcome: "ran" },
    overrides
  );
}

const AUDIT_ENTRY = {
  round: 2,
  reviewed_sha: null,
  fix_sha: null,
  fix_sha_reason: "dirty-tree",
  specialists_run: [{ name: "reviewer", selection_reason: "always runs" }],
  strike: false,
  trace_schema_version: "1.0",
};

// ── AC-5: trace-obligated, zero current-round lines -> exit 3 missing-trace ──

test("AC-5: trace-obligated round with zero current-round lines -> exit 3, missing-trace, cause null (process-incomplete never top-level)", () => {
  const repo = makeRepo();
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 3, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === "missing-trace" && v.cause === "process-incomplete"));
  assert.strictEqual(report.cause, null);
  assert.strictEqual(report.trace.obligated, true);
});

// ── AC-6: partial trace -> exit 1, unattested-invocation ─────────────────

test("AC-6: unclaimed specialist -> exit 1, top-level cause unattested-invocation", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [traceLine({ event: "normalizer" }), traceLine({ event: "scope-gate", actor: "check-scope-diff.sh" })]);
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, "unattested-invocation");
  assert.ok(report.violations.some((v) => v.type === "unattested-invocation" && /reviewer/.test(v.detail)));
});

test("AC-6: normalized_by stamped but no normalizer trace line -> exit 1 unattested-invocation", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [traceLine({ event: "specialist", actor: "reviewer" }), traceLine({ event: "scope-gate", actor: "check-scope-diff.sh" })]);
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
});

test("AC-6: Full mode missing scope-gate line -> exit 1 unattested-invocation", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [traceLine({ event: "specialist", actor: "reviewer" }), traceLine({ event: "normalizer" })]);
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => /scope-gate/.test(v.detail)));
});

// ── AC-4: fully corroborated round -> exit 0, trace block present ────────

test("AC-4: fully corroborated round -> exit 0 with trace block present", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [
    traceLine({ event: "specialist", actor: "reviewer" }),
    traceLine({ event: "normalizer" }),
    traceLine({ event: "scope-gate", actor: "check-scope-diff.sh" }),
  ]);
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepStrictEqual(report.trace, { obligated: true, lines_seen: 3, schema_version: "1.0", skipped: false });
});

test("trace block present on every exit code, including exit 0/1/2/3 (FR-176 anti-stale-script signal)", () => {
  const repo = makeRepo();
  // exit 0 (skip, legacy) — no round key at all.
  const legacy = writeReview(repo, { task: "demo-task", findings: [] }, "legacy-review.json");
  const legacyReport = JSON.parse(gate(repo, legacy).stdout);
  assert.ok(legacyReport.trace, "trace block missing on legacy exit");
  assert.strictEqual(legacyReport.trace.skipped, true);
});

// ── AC-7: malformed trace line, current-cycle -> exit 2; prior-cycle -> warning only ──

test("AC-7: current-cycle schema-invalid trace line -> exit 2 (fail closed)", () => {
  const repo = makeRepo();
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const tracePath = path.join(repo.dir, "demo-task-review-trace.jsonl");
  fs.writeFileSync(tracePath, JSON.stringify({ schema_version: "1.0", ts: "x", task: "demo-task", round: 2, cycle: 1, event: "bogus", actor: "x", outcome: "ran" }) + "\n");
  const r = gate(repo, p);
  assert.strictEqual(r.code, 2, r.stdout + r.stderr);
});

test("AC-7: prior-cycle malformed line -> warning only, current-cycle verdict unaffected (exit 0)", () => {
  const repo = makeRepo();
  const tracePath = path.join(repo.dir, "demo-task-review-trace.jsonl");
  fs.writeFileSync(
    tracePath,
    [
      JSON.stringify({ schema_version: "1.0", ts: "x", task: "demo-task", round: 1, cycle: 1, event: "bogus", actor: "x", outcome: "ran" }),
      JSON.stringify(traceLine({ event: "specialist", actor: "reviewer", cycle: 3 })),
      JSON.stringify(traceLine({ event: "normalizer", cycle: 3 })),
      JSON.stringify(traceLine({ event: "scope-gate", actor: "check-scope-diff.sh", cycle: 3 })),
    ].join("\n") + "\n"
  );
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 3, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.warnings.some((w) => /prior-cycle malformed/.test(w)));
});

// ── CHECK-5 (AC-8): cross-runtime corroboration hit/miss, journal untouched ──

test("AC-8: cross_runtime claim with a matching journal entry -> no violation", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [
    traceLine({ event: "specialist", actor: "reviewer" }),
    traceLine({ event: "normalizer" }),
    traceLine({ event: "scope-gate", actor: "check-scope-diff.sh" }),
  ]);
  writeJournalLines(repo, "demo-task", [{ ts: "x", task: "demo-task", cycle_round: 2, cycle: 1, runtime: "codex", digest: "d1", outcome: "healthy" }]);
  const p = writeReview(repo, {
    task: "demo-task",
    round: 2,
    cycle: 1,
    mode: "full",
    findings: [],
    rounds_audit: [AUDIT_ENTRY],
    normalized_by: "2.0.0",
    cross_runtime: { codex: { status: "healthy", reason: null, config_digest: "d1", round: 2 } },
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
});

test("AC-8: cross_runtime claim with NO matching journal entry -> exit 1 unattested-invocation; journal bytes untouched", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [
    traceLine({ event: "specialist", actor: "reviewer" }),
    traceLine({ event: "normalizer" }),
    traceLine({ event: "scope-gate", actor: "check-scope-diff.sh" }),
  ]);
  const journalPath = writeJournalLines(repo, "demo-task", [{ ts: "x", task: "demo-task", cycle_round: 1, cycle: 1, runtime: "codex", digest: "stale-digest", outcome: "healthy" }]);
  const beforeJournal = fs.readFileSync(journalPath);
  const p = writeReview(repo, {
    task: "demo-task",
    round: 2,
    cycle: 1,
    mode: "full",
    findings: [],
    rounds_audit: [AUDIT_ENTRY],
    normalized_by: "2.0.0",
    cross_runtime: { codex: { status: "healthy", reason: null, config_digest: "d1", round: 2 } },
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, "unattested-invocation");
  const afterJournal = fs.readFileSync(journalPath);
  assert.ok(beforeJournal.equals(afterJournal), "gate run must never modify the xruntime journal (FR-163/FR-164)");
});

test("D2 regression guard e2e: journal entries keyed config_digest (not digest) never corroborate — proves the gate matches digest, not config_digest==config_digest", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [
    traceLine({ event: "specialist", actor: "reviewer" }),
    traceLine({ event: "normalizer" }),
    traceLine({ event: "scope-gate", actor: "check-scope-diff.sh" }),
  ]);
  writeJournalLines(repo, "demo-task", [{ ts: "x", task: "demo-task", cycle: 1, runtime: "codex", config_digest: "d1", outcome: "healthy" }]);
  const p = writeReview(repo, {
    task: "demo-task",
    round: 2,
    cycle: 1,
    mode: "full",
    findings: [],
    rounds_audit: [AUDIT_ENTRY],
    normalized_by: "2.0.0",
    cross_runtime: { codex: { status: "healthy", reason: null, config_digest: "d1", round: 2 } },
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
});

// ── CHECK-6 (AC-9): rollout fixtures ──────────────────────────────────────

test("AC-9: legacy review.json (no round key) -> warn-skip, exit unaffected by trace mechanism", () => {
  const repo = makeRepo();
  const p = writeReview(repo, { task: "demo-task", status: "GO", findings: [] });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.trace.skipped, true);
  assert.ok(report.warnings.some((w) => /legacy/i.test(w)));
});

test("AC-9: pre-mechanism round (no file, no trace_schema_version) -> warn-skip", () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    task: "demo-task",
    round: 2,
    cycle: 1,
    mode: "full",
    findings: [],
    rounds_audit: [{ round: 2, reviewed_sha: null, fix_sha: null, fix_sha_reason: "dirty-tree", specialists_run: [{ name: "reviewer", selection_reason: "always" }], strike: false }],
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.trace.obligated, false);
  assert.ok(report.warnings.some((w) => /predates the trace mechanism/.test(w)));
});

test("AC-9: versioned rounds_audit entry, no trace file -> obligated, exit 3 missing-trace", () => {
  const repo = makeRepo();
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 3, r.stdout + r.stderr);
});

test("AC-9: trace file exists, rounds_audit entry lacks trace_schema_version -> still obligated (file prong)", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", []); // empty file: exists, zero lines (EC-4)
  const entryNoVersion = Object.assign({}, AUDIT_ENTRY);
  delete entryNoVersion.trace_schema_version;
  const p = writeReview(repo, { task: "demo-task", round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [entryNoVersion], normalized_by: "2.0.0" });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 3, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.trace.obligated, true);
});

// ── D4: task-slug validation, and the FR-179 backward-compat carve-out ──

test("D4: trace_schema_version present but task absent -> exit 2 degraded (evasion vector closed)", () => {
  const repo = makeRepo();
  const p = writeReview(repo, { round: 2, cycle: 1, mode: "full", findings: [], rounds_audit: [AUDIT_ENTRY], normalized_by: "2.0.0" }, "no-task-review.json");
  const r = gate(repo, p);
  assert.strictEqual(r.code, 2, r.stdout + r.stderr);
});

test("D4/FR-179: round present, no task, no trace_schema_version (pre-existing fixture shape) -> falls through to legacy warn-skip, never exit 2", () => {
  const repo = makeRepo();
  const p = writeReview(
    repo,
    {
      round: 2,
      no_go_round: 1,
      findings: [{ severity: "HIGH", status: "OPEN", check_encodable: false, fingerprint: "a.ml:1:correctness" }],
      rounds_audit: [{ round: 2, reviewed_sha: null, fix_sha: null, fix_sha_reason: "dirty-tree", specialists_run: [{ name: "reviewer", selection_reason: "always" }], strike: false }],
    },
    "no-task-legacy-shape-review.json"
  );
  const r = gate(repo, p, ["--static"]);
  // Still exits 1 for the pre-existing unencodable-finding violation (unrelated to trace) —
  // never exit 2 from the trace mechanism, proving the D4/FR-179 carve-out holds.
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, "unencodable-finding");
  assert.strictEqual(report.trace.obligated, false);
});

// ── A-2 (D4 evasion): blank task + existing trace file on disk must FAIL
// CLOSED (exit 2), not be disguised as a legacy skip. Review finding #1. ──

test("A-2: obligated-by-file round with blanked task -> exit 2 (evasion closed, not legacy skip)", () => {
  const repo = makeRepo();
  // A real deterministic-writer trace file exists on disk for the true task.
  writeTraceLines(repo, "demo-task", [traceLine({ event: "normalizer" })]);
  // Reviewer blanks `task` and omits trace_schema_version, trying to make the
  // gate unable to locate the file and fall through to a benign B-8 skip.
  const evade = {
    task: "",
    mode: "full",
    round: 2,
    no_go_round: 0,
    normalized_by: "review-normalize.js@2.0.0",
    findings: [],
    rounds_audit: [{ round: 2, specialists_run: [{ name: "architect", selection_reason: "risk" }], strike: false }],
  };
  const p = writeReview(repo, evade);
  const res = gate(repo, p);
  assert.strictEqual(res.code, 2, `evasion must fail closed (exit 2), got ${res.code}: ${res.stdout}${res.stderr || ""}`);
  assert.match((res.stdout || "") + (res.stderr || ""), /task must be a non-empty slug/);
});

test("A-2 control: same file with honest task set proceeds to real evaluation (not the task-validation exit 2)", () => {
  const repo = makeRepo();
  writeTraceLines(repo, "demo-task", [traceLine({ event: "normalizer" })]);
  const honest = {
    task: "demo-task",
    mode: "full",
    round: 2,
    no_go_round: 0,
    normalized_by: "review-normalize.js@2.0.0",
    findings: [],
    rounds_audit: [{ round: 2, specialists_run: [{ name: "architect", selection_reason: "risk" }], strike: false }],
  };
  const p = writeReview(repo, honest);
  const res = gate(repo, p);
  // Obligated + evaluated: the claimed `architect` specialist has no trace line
  // and Full mode has no scope-gate line -> unattested-invocation (exit 1).
  // The point: it does NOT short-circuit on task-validation, and is NOT a skip.
  assert.notStrictEqual(res.code, 0, "honest obligated round must not silently pass");
  assert.doesNotMatch((res.stdout || "") + (res.stderr || ""), /task must be a non-empty slug/);
});
