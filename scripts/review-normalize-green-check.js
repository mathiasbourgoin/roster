// Standalone minimal-freeze check: 0 = pass, 1 = assertion, 2 = setup/load error.
"use strict";

try {
  const assert = require("node:assert/strict");
  const { normalize } = require("./review-normalize");
  const finding = {
    severity: "HIGH",
    confidence: 4,
    path: "lib/foo.ml",
    line: 42,
    category: "correctness",
    summary: "Off-by-one",
    evidence: "lib/foo.ml:42 — current regression",
    fix: "Restore the invariant",
    fingerprint: "lib/foo.ml:42:correctness",
    specialist: "reviewer",
    status: "OPEN",
  };
  const ledgerEntry = { ...finding, status: "RESOLVED", first_seen_round: 1, resolved_round: 2, check: "checks/foo.test.js" };
  for (const greenFailed of [true, false, undefined]) {
    const reportEntry = { check: ledgerEntry.check, fingerprint: ledgerEntry.fingerprint, red_verified: true };
    if (greenFailed !== undefined) reportEntry.greenFailed = greenFailed;
    const result = normalize({ newFindings: [finding], ledger: [ledgerEntry], round: 3, gateReport: { checks: [reportEntry] } });
    assert.equal(result.rejected.length, 0);
    assert.equal(result.dispositions.pending_check.length, 0);
    assert.equal(result.dispositions.reopened.length, greenFailed === true ? 1 : 0);
    assert.equal(result.reobservations.length, greenFailed === true ? 0 : 1);
    if (greenFailed === true) {
      const reopened = result.dispositions.reopened[0];
      assert.equal(reopened.status, "OPEN");
      assert.equal(reopened.resolved_round, null);
      assert.equal(reopened.reopened_from_round, 2);
      assert.equal(reopened.reopened_at_round, 3);
      assert.equal(reopened.evidence, finding.evidence);
    }
  }
  const weakened = normalize({
    newFindings: [finding],
    ledger: [ledgerEntry],
    gateReport: { checks: [{ check: ledgerEntry.check, fingerprint: ledgerEntry.fingerprint, red_verified: true, weakened: true, greenFailed: false }] },
  });
  assert.equal(weakened.reobservations.length, 0);
  assert.equal(weakened.dispositions.reopened.length, 1);
} catch (error) {
  console.error(error);
  process.exitCode = error && error.code === "ERR_ASSERTION" ? 1 : 2;
}
