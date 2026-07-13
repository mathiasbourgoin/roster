// Tests for scripts/review-normalize.js (spec: specs/review-skill-slimming.md US-2,
// FR-099..108, Amendment D-1). Exercises the pure `normalize()` orchestration directly
// (no subprocess needed — the script is read-only and side-effect-free) plus a CLI
// smoke test via execFileSync for the stdin/file/exit-code contract.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { normalize } = require("./review-normalize");

const SCRIPT = path.resolve(__dirname, "review-normalize.js");

function finding(overrides) {
  return Object.assign(
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
      status: "OPEN",
    },
    overrides
  );
}

test("empty input -> full shape, empty arrays, normalizer_version set (EC-8/FR-107)", () => {
  const result = normalize({ newFindings: [], ledger: [], round: null });
  assert.deepStrictEqual(result.findings, []);
  assert.deepStrictEqual(result.cross_runtime_findings, []);
  assert.deepStrictEqual(result.probable_duplicates, []);
  assert.deepStrictEqual(result.rejected, []);
  assert.deepStrictEqual(result.reobservations, []);
  assert.strictEqual(typeof result.normalizer_version, "string");
  assert.ok(result.stats);
});

test("schema-invalid finding lands in rejected with a reason, never silently dropped (FR-100)", () => {
  const bad = finding();
  delete bad.evidence;
  const result = normalize({ newFindings: [bad], ledger: [] });
  assert.strictEqual(result.findings.length, 0);
  assert.strictEqual(result.rejected.length, 1);
  assert.ok(result.rejected[0].reason.includes("evidence"));
});

test("carried-forward ledger entry passes through byte-identical, never re-validated (FR-101)", () => {
  const legacyLedgerEntry = { fingerprint: "old.ml:1:correctness", not_schema_conformant: true };
  const result = normalize({ newFindings: [], ledger: [legacyLedgerEntry] });
  assert.deepStrictEqual(result.findings, [legacyLedgerEntry]);
  assert.strictEqual(result.stats.carried_forward, 1);
});

test("fingerprint is always recomputed canonically (null line -> 0), overriding input (FR-102)", () => {
  const f = finding({ line: null, fingerprint: "garbage" });
  const result = normalize({ newFindings: [f], ledger: [] });
  assert.strictEqual(result.findings[0].fingerprint, "lib/foo.ml:0:correctness");
});

test("fingerprint_v2 computed only when boundary/invariant/failure_mode present (FR-103)", () => {
  const withV2 = finding({ boundary: "custody", invariant: "no-double-spend", path: "b.ml", line: 1 });
  const withoutV2 = finding({ path: "a.ml", line: 2 });
  const result = normalize({ newFindings: [withV2, withoutV2], ledger: [] });
  const a = result.findings.find((f) => f.path === "b.ml");
  const b = result.findings.find((f) => f.path === "a.ml");
  assert.strictEqual(a.fingerprint_v2, "custody|no-double-spend|");
  assert.strictEqual(b.fingerprint_v2, undefined);
});

test("exact duplicate (same fingerprint, real lines) merges: highest severity survives + convergence (FR-104)", () => {
  const a = finding({ severity: "MEDIUM", specialist: "reviewer", evidence: "short" });
  const b = finding({ severity: "HIGH", specialist: "architect", evidence: "longer evidence text" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].severity, "HIGH");
  assert.deepStrictEqual(result.findings[0].convergence, ["reviewer", "architect"]);
});

test("equal severity tie-break: longer evidence wins (FR-104)", () => {
  const a = finding({ severity: "HIGH", specialist: "reviewer", evidence: "short" });
  const b = finding({ severity: "HIGH", specialist: "architect", evidence: "much longer evidence string here" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings[0].evidence, b.evidence);
});

test("probable window: lines 10/13 -> probable duplicate unmerged (delta 3)", () => {
  const a = finding({ path: "x.ml", line: 10, fingerprint: "x.ml:10:correctness", specialist: "reviewer" });
  const b = finding({ path: "x.ml", line: 13, fingerprint: "x.ml:13:correctness", specialist: "architect" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings.length, 2);
  assert.strictEqual(result.probable_duplicates.length, 1);
  assert.strictEqual(result.probable_duplicates[0].line_delta, 3);
});

test("outside window: lines 10/14 -> not listed at all (delta 4)", () => {
  const a = finding({ path: "x.ml", line: 10, fingerprint: "x.ml:10:correctness", specialist: "reviewer" });
  const b = finding({ path: "x.ml", line: 14, fingerprint: "x.ml:14:correctness", specialist: "architect" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings.length, 2);
  assert.strictEqual(result.probable_duplicates.length, 0);
});

test("EC-7: lines 41/42 -> probable-duplicate (window <= 3), never auto-merged", () => {
  const a = finding({ path: "y.ml", line: 41, fingerprint: "y.ml:41:correctness", specialist: "reviewer" });
  const b = finding({ path: "y.ml", line: 42, fingerprint: "y.ml:42:correctness", specialist: "architect" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings.length, 2);
  assert.strictEqual(result.probable_duplicates.length, 1);
});

test("EC-6: two null-line findings same path+category, different summary -> probable, not merged", () => {
  const a = finding({ line: null, summary: "issue A", fingerprint: "z.ml:0:correctness", specialist: "reviewer" });
  const b = finding({ line: null, summary: "issue B", fingerprint: "z.ml:0:correctness", specialist: "architect" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings.length, 2, "different summaries must not silently merge");
  assert.strictEqual(result.probable_duplicates.length, 1);
  assert.strictEqual(result.probable_duplicates[0].line_delta, 0);
});

test("EC-6: two null-line findings, byte-identical summary -> exact merge", () => {
  const a = finding({ line: null, summary: "same issue", fingerprint: "z.ml:0:correctness", specialist: "reviewer" });
  const b = finding({ line: null, summary: "same issue", fingerprint: "z.ml:0:correctness", specialist: "architect" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings.length, 1);
  assert.deepStrictEqual(result.findings[0].convergence, ["reviewer", "architect"]);
});

test("D-1: new finding matching a ledger fingerprint is a reobservation — never merged, never a fresh finding, never dropped", () => {
  const ledgerEntry = { fingerprint: "lib/foo.ml:42:correctness", status: "OPEN", first_seen_round: 1 };
  const f = finding();
  const result = normalize({ newFindings: [f], ledger: [ledgerEntry], round: 3 });
  assert.strictEqual(result.findings.length, 1);
  assert.deepStrictEqual(result.findings[0], ledgerEntry, "ledger entry must pass through untouched");
  assert.strictEqual(result.reobservations.length, 1);
  assert.deepStrictEqual(result.reobservations[0], {
    fingerprint: "lib/foo.ml:42:correctness",
    fid: result.reobservations[0].fid,
    specialist: "reviewer",
    round: 3,
  });
  assert.match(result.reobservations[0].fid, /^lib\/foo\.ml:42:correctness#[0-9a-f]{8}$/);
});

test("D-1: reobservation round is null when --round was not passed", () => {
  const ledgerEntry = { fingerprint: "lib/foo.ml:42:correctness" };
  const result = normalize({ newFindings: [finding()], ledger: [ledgerEntry] });
  assert.strictEqual(result.reobservations[0].round, null);
});

test("FR-106: cross-runtime findings never enter primary merge/dedup — routed to cross_runtime_findings", () => {
  const primary = finding();
  const xr = finding({ path: "other.ml", line: 5, fingerprint: "other.ml:5:correctness", specialist: "codex-xruntime" });
  const result = normalize({ newFindings: [primary, xr], ledger: [] });
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.cross_runtime_findings.length, 1);
  assert.strictEqual(result.cross_runtime_findings[0].specialist, "codex-xruntime");
});

test("FR-106: normalizer never auto-downgrades severity or auto-resolves — single input passes through as-is", () => {
  const f = finding({ status: "OPEN" });
  const result = normalize({ newFindings: [f], ledger: [] });
  assert.strictEqual(result.findings[0].status, "OPEN");
  assert.strictEqual(result.findings[0].severity, "HIGH");
});

// ── INV-5/E-7: cross-runtime canonicalization at intake ─────────────────
test("INV-5/E-7: an arbitrary model-provided cross-runtime fingerprint is replaced with the canonical v1 form", () => {
  const xr = finding({ path: "x.ml", line: 9, fingerprint: "totally-untrusted-value", specialist: "codex-xruntime" });
  const result = normalize({ newFindings: [xr], ledger: [] });
  assert.strictEqual(result.cross_runtime_findings.length, 1);
  assert.strictEqual(result.cross_runtime_findings[0].fingerprint, "x.ml:9:correctness");
  assert.match(result.cross_runtime_findings[0].fid, /^x\.ml:9:correctness#[0-9a-f]{8}$/);
});

test("INV-5: two cross-runtime findings with identical semantics dedup within the augment-only array, never merge into primary", () => {
  const a = finding({ path: "x.ml", line: 9, fingerprint: "bogus-1", specialist: "codex-xruntime" });
  const b = finding({ path: "x.ml", line: 9, fingerprint: "bogus-2", specialist: "codex-xruntime" });
  const result = normalize({ newFindings: [a, b], ledger: [] });
  assert.strictEqual(result.findings.length, 0, "cross-runtime findings never enter primary findings");
  assert.strictEqual(result.cross_runtime_findings.length, 1, "identical cross-runtime findings dedup within their own array");
});

// ── INV-2/E-2: gate-report-driven disposition ────────────────────────────
test("INV-2/E-2: a RESOLVED, check-linked entry re-reported WITH a gate report showing red_verified: true stays reobserved", () => {
  const ledgerEntry = finding({ status: "RESOLVED", first_seen_round: 1, resolved_round: 2, check: "checks/foo.test.js" });
  const gateReport = { checks: [{ check: "checks/foo.test.js", fid: ledgerEntry.fid, red_verified: true }] };
  // ledgerEntry has no fid in this fixture (legacy-style) — key on fingerprint fallback instead.
  gateReport.checks[0].fingerprint = ledgerEntry.fingerprint;
  delete gateReport.checks[0].fid;
  const result = normalize({ newFindings: [finding()], ledger: [ledgerEntry], round: 3, gateReport });
  assert.strictEqual(result.reobservations.length, 1);
  assert.strictEqual(result.dispositions.reopened.length, 0);
});

test("INV-2/E-2: a RESOLVED, check-linked entry re-reported WITH a gate report that does NOT cover its check is pending-check", () => {
  const ledgerEntry = finding({ status: "RESOLVED", first_seen_round: 1, resolved_round: 2, check: "checks/foo.test.js" });
  const gateReport = { checks: [{ check: "checks/other.test.js", fingerprint: "other.ml:1:correctness", red_verified: true }] };
  const result = normalize({ newFindings: [finding()], ledger: [ledgerEntry], round: 3, gateReport });
  assert.strictEqual(result.reobservations.length, 0);
  assert.strictEqual(result.dispositions.pending_check.length, 1);
  assert.strictEqual(result.dispositions.pending_check[0].pending_check, "checks/foo.test.js");
});

test("INV-2 (Resolution): a RESOLVED, check-linked entry re-reported with NO gate report at all fails closed to reopen", () => {
  const ledgerEntry = finding({ status: "RESOLVED", first_seen_round: 1, resolved_round: 2, check: "checks/foo.test.js" });
  const result = normalize({ newFindings: [finding()], ledger: [ledgerEntry], round: 3 });
  assert.strictEqual(result.reobservations.length, 0);
  assert.strictEqual(result.dispositions.reopened.length, 1);
  assert.strictEqual(result.dispositions.reopened[0].reopened_from_round, 2);
  assert.strictEqual(result.dispositions.reopened[0].reopened_at_round, 3);
});

test("INV-2/E-2: a RESOLVED, check-linked entry whose gate report shows red_verified: false reopens", () => {
  const ledgerEntry = finding({ status: "RESOLVED", first_seen_round: 1, resolved_round: 2, check: "checks/foo.test.js" });
  const gateReport = { checks: [{ check: "checks/foo.test.js", fingerprint: ledgerEntry.fingerprint, red_verified: false }] };
  const result = normalize({ newFindings: [finding()], ledger: [ledgerEntry], round: 3, gateReport });
  assert.strictEqual(result.dispositions.reopened.length, 1);
});

test("normalizer_version is stamped on every output (FR-108)", () => {
  const result = normalize({ newFindings: [], ledger: [] });
  assert.strictEqual(result.normalizer_version, "2.0.0");
});

test("read-only: normalize() never touches the filesystem (no side effects to assert against; contract by construction — no fs.write* call in the module)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!/fs\.write|fs\.append|fs\.unlink|fs\.rm(?!Sync\(0)/.test(src.replace(/\/\/.*$/gm, "")));
});

// ── CLI smoke tests (stdin + file args + exit codes) ────────────────────
function runCli(args, input) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { input: input || "", encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || "").toString(), stderr: (e.stderr || "").toString() };
  }
}

test("CLI: empty stdin -> exit 0, empty-shape JSON", () => {
  const { code, stdout } = runCli([], "");
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(stdout);
  assert.deepStrictEqual(parsed.findings, []);
});

test("CLI: reads a JSON array file argument", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-cli-"));
  const filePath = path.join(dir, "findings.json");
  fs.writeFileSync(filePath, JSON.stringify([finding()]));
  const { code, stdout } = runCli([filePath]);
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.findings.length, 1);
});

test("CLI: --ledger reads the prior cumulative ledger file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-cli-"));
  const ledgerPath = path.join(dir, "ledger.json");
  fs.writeFileSync(ledgerPath, JSON.stringify([{ fingerprint: "carried.ml:1:style" }]));
  const { code, stdout } = runCli(["--ledger", ledgerPath], "[]");
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.findings.length, 1);
  assert.strictEqual(parsed.findings[0].fingerprint, "carried.ml:1:style");
});

test("CLI: unknown flag -> exit 2", () => {
  const { code } = runCli(["--bogus"], "[]");
  assert.strictEqual(code, 2);
});

test("CLI: missing --ledger file -> exit 2 (degraded input, fail closed)", () => {
  const { code } = runCli(["--ledger", "/nonexistent/ledger.json"], "[]");
  assert.strictEqual(code, 2);
});

// ── FIX-1 (review): --round cross-checked against the lifecycle witness ──

test("FIX-1: --round matching the prior verdict's derived round -> no warning", () => {
  const result = normalize({ newFindings: [], ledger: [], round: 3, priorReview: { status: "NO-GO", round: 2, cycle: 1 } });
  assert.deepStrictEqual(result.warnings, []);
});

test("FIX-1: --round mismatching the prior verdict's derived round -> warning, never a hard failure", () => {
  const result = normalize({ newFindings: [], ledger: [], round: 5, priorReview: { status: "NO-GO", round: 2, cycle: 1 } });
  assert.strictEqual(result.warnings.length, 1);
  assert.match(result.warnings[0], /round consistency/);
  assert.deepStrictEqual(result.findings, [], "a round mismatch warns, it never blocks normalization");
});

test("FIX-1: no --prior given -> no cross-check attempted, no warning", () => {
  const result = normalize({ newFindings: [], ledger: [], round: 99 });
  assert.deepStrictEqual(result.warnings, []);
});

test("FIX-1 CLI: --prior + --round wired end-to-end through the CLI", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "normalize-cli-"));
  const priorPath = path.join(dir, "prior-review.json");
  fs.writeFileSync(priorPath, JSON.stringify({ status: "NO-GO", round: 2, cycle: 1 }));
  const { code, stdout } = runCli(["--prior", priorPath, "--round", "9"], "[]");
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.warnings.length, 1);
});
