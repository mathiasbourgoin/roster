// Adversarial mutation tests for scripts/lib/normalize-rules.js (spec:
// specs/review-v2-corrections.md CHECK-1, INV-1, INV-2, Amendments E-3/E-4).
//
// These two mutations are the health-report reproductions this slice fixes:
//   (a) two DISTINCT security findings sharing one path:line:category
//       fingerprint must both survive — never silently exact-merged into one.
//   (b) a same-round-resolved, no-check finding that reappears next round is
//       a REGRESSION (reopened), never a metadata-only reobservation.
//
// Per the implementer contract, this file was committed and run RED against
// the pre-fix scripts/lib/normalize-rules.js BEFORE the fix landed — see
// briefs/review-v2-corrections-impl.md for the recorded red-run evidence.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { normalize } = require("./review-normalize");

function finding(overrides) {
  return Object.assign(
    {
      severity: "HIGH",
      confidence: 4,
      path: "lib/auth.ml",
      line: 88,
      category: "security",
      summary: "Missing auth check",
      evidence: "lib/auth.ml:88 — evidence",
      fix: "add the check",
      fingerprint: "lib/auth.ml:88:security",
      specialist: "reviewer",
      status: "OPEN",
    },
    overrides
  );
}

test("mutation (a): two distinct security findings on one line both survive as probable duplicates (INV-1)", () => {
  const a = finding({ summary: "SQL injection via unescaped user input", specialist: "reviewer" });
  const b = finding({ summary: "Missing authorization check on the same line", specialist: "architect" });
  const result = normalize({ newFindings: [a, b], ledger: [] });

  // Neither finding may be silently exact-merged away — a v1 fingerprint
  // collision alone is never enough when the semantic content (summary)
  // differs (INV-1).
  assert.strictEqual(result.findings.length, 2, "both distinct findings must survive, not merge into one");
  const summaries = result.findings.map((f) => f.summary).sort();
  assert.deepStrictEqual(summaries, [
    "Missing authorization check on the same line",
    "SQL injection via unescaped user input",
  ]);

  // They must be surfaced for owner adjudication as a probable duplicate
  // (same path+category, line delta 0) — never auto-merged.
  assert.strictEqual(result.probable_duplicates.length, 1);
  assert.strictEqual(result.probable_duplicates[0].line_delta, 0);
});

test("mutation (b): same-round-resolved, no-check finding reappearing next round is REOPENED, not reobserved (INV-2)", () => {
  const ledgerEntry = finding({
    status: "RESOLVED",
    first_seen_round: 1,
    resolved_round: 1, // same-round-resolved -> ratchet exempt, never had a check
    check: null,
  });
  const reappeared = finding({ summary: "Missing auth check (regressed)" });

  const result = normalize({ newFindings: [reappeared], ledger: [ledgerEntry], round: 2 });

  // Never silently reduced to a metadata-only reobservation — that would
  // suppress a genuine regression (the health-report bug).
  assert.strictEqual(result.reobservations.length, 0, "a same-round-resolved no-check finding must never be a reobservation");

  // It must be proposed as "reopen" with the full re-observed body preserved
  // — the normalizer proposes, roster-review (the skill) acts on the
  // disposition by flipping status back to OPEN.
  assert.ok(result.dispositions, "normalize() must emit a dispositions object (E-2/E-4)");
  assert.strictEqual(result.dispositions.reopened.length, 1);
  const reopened = result.dispositions.reopened[0];
  assert.strictEqual(reopened.summary, "Missing auth check (regressed)", "full re-observed body must be preserved");
  assert.strictEqual(reopened.reopened_from_round, 1);
  assert.strictEqual(reopened.reopened_at_round, 2);
});
