// Tests for scripts/lib/review/review-trace-rules.js (spec: specs/r5-trace-enforcement.md
// FR-169..174/176/180, US-3/US-4). Pure-rule coverage: obligation prongs, required-event
// coverage per mode, claim correspondence, cycle-scoped malformed classification, EC-1..EC-8.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  deriveObligation,
  classifyLines,
  computeRequiredCoverage,
  computeCrossRuntimeCorroboration,
  computeOmitEverythingWarning,
  buildTraceBlock,
} = require("./lib/review/review-trace-rules");
const { selectCause } = require("./lib/review/review-convergence-rules");

function line(overrides) {
  return JSON.stringify(
    Object.assign(
      {
        schema_version: "1.0",
        ts: "2026-07-13T10:00:00Z",
        task: "demo-task",
        round: 1,
        cycle: 1,
        event: "normalizer",
        actor: "review-normalize.js",
        outcome: "ran",
      },
      overrides
    )
  );
}

// ── deriveObligation (FR-169) ────────────────────────────────────────────

test("legacy: hasRoundKey false -> skip regardless of file/entry (B-8)", () => {
  const r = deriveObligation({ traceFileExists: true, roundsAuditEntry: { trace_schema_version: "1.0" }, hasRoundKey: false });
  assert.strictEqual(r.obligated, false);
  assert.strictEqual(r.skip, true);
  assert.match(r.skipReason, /legacy/i);
});

test("pre-mechanism: no file, no trace_schema_version, round present -> skip with the exact warning wording (US-4 AS-2)", () => {
  const r = deriveObligation({ traceFileExists: false, roundsAuditEntry: { round: 2 }, hasRoundKey: true });
  assert.strictEqual(r.obligated, false);
  assert.strictEqual(r.skip, true);
  assert.match(r.skipReason, /predates the trace mechanism/);
});

test("versioned entry, no file -> obligated (US-4 AS-3)", () => {
  const r = deriveObligation({ traceFileExists: false, roundsAuditEntry: { trace_schema_version: "1.0" }, hasRoundKey: true });
  assert.strictEqual(r.obligated, true);
});

test("file exists, entry lacks trace_schema_version -> still obligated via file prong (US-4 AS-4)", () => {
  const r = deriveObligation({ traceFileExists: true, roundsAuditEntry: { round: 2 }, hasRoundKey: true });
  assert.strictEqual(r.obligated, true);
});

test("file exists, no rounds_audit entry at all (EC-7 fallback) -> obligated via file prong alone", () => {
  const r = deriveObligation({ traceFileExists: true, roundsAuditEntry: null, hasRoundKey: true });
  assert.strictEqual(r.obligated, true);
});

test("neither prong holds -> skip (not obligated)", () => {
  const r = deriveObligation({ traceFileExists: false, roundsAuditEntry: null, hasRoundKey: true });
  assert.strictEqual(r.obligated, false);
  assert.strictEqual(r.skip, true);
});

// ── classifyLines (FR-173, C-4, EC-1/2/5) ────────────────────────────────

test("all schema-valid current-cycle lines are kept, not degraded", () => {
  const { current, degraded, warnings } = classifyLines([line(), line({ event: "scope-gate", actor: "check-scope-diff.sh" })], "demo-task", 1);
  assert.strictEqual(current.length, 2);
  assert.strictEqual(degraded, false);
  assert.deepStrictEqual(warnings, []);
});

test("EC-2: prior-cycle malformed (schema-invalid but cycle readable and != current) -> warning only, not degraded", () => {
  const badPriorCycle = JSON.stringify({ schema_version: "1.0", ts: "x", task: "demo-task", round: 1, cycle: 1, event: "bogus-event", actor: "x", outcome: "ran" });
  const { current, degraded, warnings } = classifyLines([badPriorCycle], "demo-task", 3);
  assert.strictEqual(degraded, false);
  assert.strictEqual(current.length, 0);
  assert.strictEqual(warnings.length, 1);
});

test("current-cycle schema-invalid line -> degraded (fail closed)", () => {
  const bad = JSON.stringify({ schema_version: "1.0", ts: "x", task: "demo-task", round: 1, cycle: 3, event: "bogus-event", actor: "x", outcome: "ran" });
  const { degraded } = classifyLines([bad], "demo-task", 3);
  assert.strictEqual(degraded, true);
});

test("unparseable JSON line -> always degraded, regardless of cycle (FR-173: 'or which is unparseable at all')", () => {
  const { degraded } = classifyLines(["{ not json", line()], "demo-task", 1);
  assert.strictEqual(degraded, true);
});

test("EC-1: prior-cycle-only lines -> zero current lines but not degraded (round obligated via file prong upstream)", () => {
  const { current, degraded } = classifyLines([line({ cycle: 1 })], "demo-task", 3);
  assert.strictEqual(current.length, 0);
  assert.strictEqual(degraded, false);
});

test("EC-3: duplicate trace lines for the same specialist in one round both kept (append-only re-runs are valid)", () => {
  const specialistLine = line({ event: "specialist", actor: "architect" });
  const { current } = classifyLines([specialistLine, specialistLine], "demo-task", 1);
  assert.strictEqual(current.length, 2);
});

test("EC-5: task mismatch -> not counted, warning only, never silently treated as evidence", () => {
  const { current, warnings } = classifyLines([line({ task: "other-task" })], "demo-task", 1);
  assert.strictEqual(current.length, 0);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /task/);
});

test("empty input -> empty current, not degraded (EC-4 empty file handled by caller via zero raw lines)", () => {
  const { current, degraded, warnings } = classifyLines([], "demo-task", 1);
  assert.deepStrictEqual(current, []);
  assert.strictEqual(degraded, false);
  assert.deepStrictEqual(warnings, []);
});

// ── computeRequiredCoverage (FR-170/171, EC-6/EC-8) ──────────────────────

test("FR-170: zero lines for the round -> single missing-trace/process-incomplete violation", () => {
  const violations = computeRequiredCoverage({ currentLines: [], currentRound: 2, mode: "full", specialistsRun: [{ name: "reviewer" }], normalizedBy: "2.0.0" });
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].type, "missing-trace");
  assert.strictEqual(violations[0].cause, "process-incomplete");
});

test("FR-171: partial trace — specialist claimed but not traced -> unattested-invocation", () => {
  const currentLines = [
    JSON.parse(line({ event: "normalizer", round: 2 })),
  ];
  const violations = computeRequiredCoverage({
    currentLines,
    currentRound: 2,
    mode: "express",
    specialistsRun: [{ name: "reviewer" }],
    normalizedBy: "2.0.0",
  });
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].type, "unattested-invocation");
  assert.strictEqual(violations[0].cause, "unattested-invocation");
  assert.match(violations[0].detail, /reviewer/);
});

test("FR-171: normalized_by stamped but no normalizer line -> unattested-invocation", () => {
  const currentLines = [JSON.parse(line({ event: "specialist", actor: "reviewer", round: 2 }))];
  const violations = computeRequiredCoverage({
    currentLines,
    currentRound: 2,
    mode: "express",
    specialistsRun: [{ name: "reviewer" }],
    normalizedBy: "2.0.0",
  });
  assert.ok(violations.some((v) => v.type === "unattested-invocation" && /normalizer/.test(v.detail)));
});

test("EC-6: Express/Fast round (mode != full) -> no scope-gate line required", () => {
  const currentLines = [
    JSON.parse(line({ event: "normalizer", round: 2 })),
    JSON.parse(line({ event: "specialist", actor: "reviewer", round: 2 })),
  ];
  const violations = computeRequiredCoverage({
    currentLines,
    currentRound: 2,
    mode: "express",
    specialistsRun: [{ name: "reviewer" }],
    normalizedBy: "2.0.0",
  });
  assert.deepStrictEqual(violations, []);
});

test("Full mode missing scope-gate line -> unattested-invocation", () => {
  const currentLines = [
    JSON.parse(line({ event: "normalizer", round: 2 })),
    JSON.parse(line({ event: "specialist", actor: "reviewer", round: 2 })),
  ];
  const violations = computeRequiredCoverage({
    currentLines,
    currentRound: 2,
    mode: "full",
    specialistsRun: [{ name: "reviewer" }],
    normalizedBy: "2.0.0",
  });
  assert.ok(violations.some((v) => /scope-gate/.test(v.detail)));
});

test("fully corroborated round -> zero violations", () => {
  const currentLines = [
    JSON.parse(line({ event: "normalizer", round: 2 })),
    JSON.parse(line({ event: "scope-gate", actor: "check-scope-diff.sh", round: 2 })),
    JSON.parse(line({ event: "specialist", actor: "reviewer", round: 2 })),
    JSON.parse(line({ event: "specialist", actor: "architect", round: 2 })),
  ];
  const violations = computeRequiredCoverage({
    currentLines,
    currentRound: 2,
    mode: "full",
    specialistsRun: [{ name: "reviewer" }, { name: "architect" }],
    normalizedBy: "2.0.0",
  });
  assert.deepStrictEqual(violations, []);
});

test("EC-8: round 1 of a fresh cycle evaluated against round 1's own claims only, ignoring other rounds' lines", () => {
  const currentLines = [
    JSON.parse(line({ event: "normalizer", round: 1, cycle: 2 })),
    JSON.parse(line({ event: "specialist", actor: "reviewer", round: 1, cycle: 2 })),
    JSON.parse(line({ event: "specialist", actor: "stale-specialist", round: 5, cycle: 2 })),
  ];
  const violations = computeRequiredCoverage({
    currentLines,
    currentRound: 1,
    mode: "express",
    specialistsRun: [{ name: "reviewer" }],
    normalizedBy: "2.0.0",
  });
  assert.deepStrictEqual(violations, []);
});

// ── computeCrossRuntimeCorroboration (FR-172, D2) ────────────────────────

test("D2: matches journalEntry.digest against cross_runtime[rt].config_digest (different keys, same value)", () => {
  const crossRuntime = { codex: { status: "healthy", round: 2, config_digest: "d1" } };
  const journalEntries = [{ runtime: "codex", digest: "d1", cycle: 1, outcome: "healthy" }];
  const violations = computeCrossRuntimeCorroboration({ crossRuntime, journalEntries, currentRound: 2, currentCycle: 1 });
  assert.deepStrictEqual(violations, []);
});

test("D2 regression guard: a journal entry with only config_digest (no digest) never matches — proves the map is digest, not config_digest==config_digest", () => {
  const crossRuntime = { codex: { status: "healthy", round: 2, config_digest: "d1" } };
  const journalEntries = [{ runtime: "codex", config_digest: "d1", cycle: 1 }]; // wrong key on purpose
  const violations = computeCrossRuntimeCorroboration({ crossRuntime, journalEntries, currentRound: 2, currentCycle: 1 });
  assert.strictEqual(violations.length, 1);
  assert.strictEqual(violations[0].cause, "unattested-invocation");
});

test("no matching journal entry -> unattested-invocation", () => {
  const crossRuntime = { codex: { status: "healthy", round: 2, config_digest: "d1" } };
  const violations = computeCrossRuntimeCorroboration({ crossRuntime, journalEntries: [], currentRound: 2, currentCycle: 1 });
  assert.strictEqual(violations.length, 1);
});

test("skipped-degraded status is not checked", () => {
  const crossRuntime = { codex: { status: "skipped-degraded", round: 2, config_digest: "d1" } };
  const violations = computeCrossRuntimeCorroboration({ crossRuntime, journalEntries: [], currentRound: 2, currentCycle: 1 });
  assert.deepStrictEqual(violations, []);
});

test("skipped-human status IS checked (corroborated, not exempted — FR-168 preserves journaling)", () => {
  const crossRuntime = { codex: { status: "skipped-human", round: 2, config_digest: "d1" } };
  const journalEntries = [{ runtime: "codex", digest: "d1", cycle: 1 }];
  const violations = computeCrossRuntimeCorroboration({ crossRuntime, journalEntries, currentRound: 2, currentCycle: 1 });
  assert.deepStrictEqual(violations, []);
});

test("entry for a different round is not checked", () => {
  const crossRuntime = { codex: { status: "healthy", round: 1, config_digest: "d1" } };
  const violations = computeCrossRuntimeCorroboration({ crossRuntime, journalEntries: [], currentRound: 2, currentCycle: 1 });
  assert.deepStrictEqual(violations, []);
});

test("no cross_runtime object -> no violations", () => {
  const violations = computeCrossRuntimeCorroboration({ crossRuntime: null, journalEntries: [], currentRound: 2, currentCycle: 1 });
  assert.deepStrictEqual(violations, []);
});

// ── computeOmitEverythingWarning (FR-180, C-2) ───────────────────────────

test("legacy (no round key) -> no warning", () => {
  assert.strictEqual(computeOmitEverythingWarning({ hasRoundKey: false, obligated: false, normalizedBy: null }), null);
});

test("obligated -> no warning even without normalized_by", () => {
  assert.strictEqual(computeOmitEverythingWarning({ hasRoundKey: true, obligated: true, normalizedBy: null }), null);
});

test("normalized_by present -> no warning even when not obligated", () => {
  assert.strictEqual(computeOmitEverythingWarning({ hasRoundKey: true, obligated: false, normalizedBy: "2.0.0" }), null);
});

test("neither obligated nor normalized_by, round present -> loud warning naming the omit-everything posture", () => {
  const w = computeOmitEverythingWarning({ hasRoundKey: true, obligated: false, normalizedBy: null });
  assert.match(w, /omit-everything/);
});

// ── buildTraceBlock (FR-176) ──────────────────────────────────────────────

test("trace block shape matches FR-176 exactly", () => {
  const block = buildTraceBlock({ obligated: true, currentLines: [JSON.parse(line())], skip: false });
  assert.deepStrictEqual(Object.keys(block).sort(), ["lines_seen", "obligated", "schema_version", "skipped"].sort());
  assert.strictEqual(block.obligated, true);
  assert.strictEqual(block.lines_seen, 1);
  assert.strictEqual(block.schema_version, "1.0");
  assert.strictEqual(block.skipped, false);
});

test("trace block on skip: schema_version null, lines_seen 0", () => {
  const block = buildTraceBlock({ obligated: false, currentLines: [], skip: true });
  assert.strictEqual(block.schema_version, null);
  assert.strictEqual(block.lines_seen, 0);
  assert.strictEqual(block.skipped, true);
});

// ── selectCause precedence (FR-174, step 3) ──────────────────────────────

test("FR-174: unencodable-finding outranks unattested-invocation", () => {
  const cause = selectCause([{ cause: "unattested-invocation" }, { cause: "unencodable-finding" }]);
  assert.strictEqual(cause, "unencodable-finding");
});

test("FR-174: unattested-invocation outranks novel-finding-streak", () => {
  const cause = selectCause([{ cause: "novel-finding-streak" }, { cause: "unattested-invocation" }]);
  assert.strictEqual(cause, "unattested-invocation");
});

test("FR-174: unattested-invocation outranks round-cap", () => {
  const cause = selectCause([{ cause: "round-cap" }, { cause: "unattested-invocation" }]);
  assert.strictEqual(cause, "unattested-invocation");
});

test("FR-174: novel-finding-streak still outranks round-cap (precedence unchanged below unattested-invocation)", () => {
  const cause = selectCause([{ cause: "round-cap" }, { cause: "novel-finding-streak" }]);
  assert.strictEqual(cause, "novel-finding-streak");
});

test("process-incomplete is never selected as top-level cause", () => {
  const cause = selectCause([{ cause: "process-incomplete" }]);
  assert.strictEqual(cause, null);
});
