// scripts/lib/review-lifecycle.js — CommonJS, pure functions.
//
// The two-event round/cycle lifecycle for roster-review (specs/review-v2-
// corrections.md INV-3, Amendments E-5/E-6). This module is the executable
// witness for the prose contract in skills/pipeline/roster-review.md §5.5:
//
//   1) a persisted GO verdict retains its cycle-final state (round,
//      rounds_audit, cross_runtime) — it is never reset in place, so it stays
//      auditable.
//   2) the NEXT review cycle then initializes fresh: round 1, full fan-out,
//      a fresh rounds_audit, a new cross-runtime probe, and cycle + 1.
//
// No I/O here — roster-review reads the prior briefs/<task>-review.json
// itself and passes the parsed object in.
"use strict";

function isFreshCycle(prior) {
  return !prior || prior.status === "GO";
}

// Derives this draft's round/cycle/carry-forward state from the prior
// persisted verdict (or its absence). Pure — never mutates `prior`.
//
//   - absent prior, or prior.status === "GO"  -> fresh cycle: round 1,
//     cycle = prior.cycle + 1 (or 1 if no prior/no prior cycle), empty
//     rounds_audit, empty cross_runtime.
//   - prior.status === "NO-GO", numeric prior.round -> round = prior.round + 1,
//     cycle carried forward unchanged, rounds_audit/cross_runtime carried
//     forward.
//   - prior.status === "NO-GO", round absent (legacy) -> stay legacy for this
//     cycle (round: null, legacyRound: true) — carries rounds_audit/
//     cross_runtime forward as-is.
function deriveRoundState(prior) {
  if (isFreshCycle(prior)) {
    const priorCycle = prior && typeof prior.cycle === "number" ? prior.cycle : 0;
    return {
      round: 1,
      cycle: priorCycle + 1,
      roundsAudit: [],
      crossRuntime: {},
      legacyRound: false,
      freshCycle: true,
    };
  }

  const roundsAudit = Array.isArray(prior.rounds_audit) ? prior.rounds_audit : [];
  const crossRuntime = prior.cross_runtime && typeof prior.cross_runtime === "object" ? prior.cross_runtime : {};
  const cycle = typeof prior.cycle === "number" ? prior.cycle : null;

  if (typeof prior.round !== "number") {
    return { round: null, cycle, roundsAudit, crossRuntime, legacyRound: true, freshCycle: false };
  }

  return { round: prior.round + 1, cycle, roundsAudit, crossRuntime, legacyRound: false, freshCycle: false };
}

module.exports = { isFreshCycle, deriveRoundState };
