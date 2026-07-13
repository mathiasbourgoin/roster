// scripts/lib/normalize-rules.js — CommonJS, pure functions.
//
// Fingerprinting, exact-dedup, probable-duplicate, and re-observation rules for
// scripts/review-normalize.js (spec: specs/review-skill-slimming.md US-2,
// FR-099..108, Amendment D-1). No I/O here — scripts/review-normalize.js owns
// reading files/stdin and writing stdout.
"use strict";

const SEVERITY_RANK = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };

// FR-102: fingerprint v1 = path:line:category, null line -> 0. This is the
// PRIMARY identity — always recomputed here, never trusted from specialist
// input, so a specialist's own (possibly non-conforming) `fingerprint` field
// can never desync the merge/dedup pipeline from the canonical form.
function canonicalFingerprint(finding) {
  const line = finding.line === null || finding.line === undefined ? 0 : finding.line;
  return `${finding.path}:${line}:${finding.category}`;
}

// FR-103: fingerprint_v2 computed only when the finding already carries
// boundary/invariant/failure_mode — never required of any input.
function hasV2Fields(finding) {
  return finding.boundary !== undefined || finding.invariant !== undefined || finding.failure_mode !== undefined;
}

function computeFingerprintV2(finding) {
  return [finding.boundary || "", finding.invariant || "", finding.failure_mode || ""].join("|");
}

// FR-106 scope guard: cross-runtime findings never enter the primary
// merge/dedup/reobservation pipeline — they are routed straight to
// cross_runtime_findings (augment-only elsewhere in roster-review).
function isCrossRuntime(finding) {
  return typeof finding.specialist === "string" && /-xruntime$/.test(finding.specialist);
}

function canonicalLine(finding) {
  return finding.line === null || finding.line === undefined ? 0 : finding.line;
}

// EC-6: two findings sharing a fingerprint merge unconditionally when BOTH
// have a real (non-null) line — the line disambiguates enough that a shared
// fingerprint is strong duplicate evidence. When either side's line is null
// (canonicalized to 0), a shared fingerprint alone is NOT enough — only a
// byte-identical summary proves it is the same defect; otherwise the pair is
// downgraded to a probable-duplicate (handled by the caller via the
// path+category+delta pass, since delta is 0 here).
function isExactDuplicatePair(a, b) {
  if (a.line !== null && a.line !== undefined && b.line !== null && b.line !== undefined) return true;
  return a.summary === b.summary;
}

// FR-104: merges one fingerprint-sharing group into a single survivor when
// every pairwise comparison is an exact duplicate (see isExactDuplicatePair);
// otherwise partitions the group into the merge-eligible subset (by
// byte-identical summary) plus the leftovers, which the caller re-exposes for
// probable-duplicate detection.
function partitionExactGroup(group) {
  if (group.length === 1) return { merged: group, leftover: [] };
  const allRealLines = group.every((f) => f.line !== null && f.line !== undefined);
  if (allRealLines) return { merged: group, leftover: [] };

  // Nullish-line group: merge only the members sharing byte-identical summary
  // with the first element; anything else stays a leftover finding.
  const anchor = group[0];
  const merged = group.filter((f) => isExactDuplicatePair(anchor, f));
  const leftover = group.filter((f) => !isExactDuplicatePair(anchor, f));
  return { merged: merged.length > 1 ? merged : [anchor], leftover: merged.length > 1 ? leftover : group.slice(1) };
}

function pickSurvivor(group) {
  let best = group[0];
  for (let i = 1; i < group.length; i++) {
    const candidate = group[i];
    const rankDiff = (SEVERITY_RANK[candidate.severity] || 0) - (SEVERITY_RANK[best.severity] || 0);
    if (rankDiff > 0) best = candidate;
    else if (rankDiff === 0 && (candidate.evidence || "").length > (best.evidence || "").length) best = candidate;
  }
  return best;
}

// Merges a fingerprint-group into one survivor carrying `convergence: [...]`
// (the contributing specialists, in input order, deduplicated).
function mergeGroup(group) {
  const survivor = Object.assign({}, pickSurvivor(group));
  const specialists = [];
  for (const f of group) if (!specialists.includes(f.specialist)) specialists.push(f.specialist);
  if (specialists.length > 1) survivor.convergence = specialists;
  return survivor;
}

// FR-104/EC-6: groups findings by fingerprint, merges exact duplicates within
// each group, and returns the settled findings list (survivors + any
// unmerged leftovers) alongside every leftover so the caller can still run
// probable-duplicate detection over them (a leftover shares path+category+
// line 0 with its survivor, i.e. delta 0 — always in the probable window).
function mergeExactDuplicates(findings) {
  const byFingerprint = new Map();
  for (const f of findings) {
    const key = f.fingerprint;
    if (!byFingerprint.has(key)) byFingerprint.set(key, []);
    byFingerprint.get(key).push(f);
  }

  const settled = [];
  for (const group of byFingerprint.values()) {
    const { merged, leftover } = partitionExactGroup(group);
    settled.push(mergeGroup(merged));
    settled.push(...leftover);
  }
  return settled;
}

// FR-105: non-exact findings sharing path+category with |line delta| <= 3 are
// listed for owner adjudication, never auto-merged. Operates over the
// SETTLED list (post exact-merge) so an already-merged group contributes
// only its single survivor to this pass.
function computeProbableDuplicates(settledFindings) {
  const probable = [];
  for (let i = 0; i < settledFindings.length; i++) {
    for (let j = i + 1; j < settledFindings.length; j++) {
      const a = settledFindings[i];
      const b = settledFindings[j];
      if (a.path !== b.path || a.category !== b.category) continue;
      const delta = Math.abs(canonicalLine(a) - canonicalLine(b));
      if (delta > 3) continue;
      probable.push({
        path: a.path,
        category: a.category,
        line_delta: delta,
        a: { fingerprint: a.fingerprint, specialist: a.specialist, line: a.line },
        b: { fingerprint: b.fingerprint, specialist: b.specialist, line: b.line },
      });
    }
  }
  return probable;
}

// D-1: separates ledger-matching new findings (re-observations — never
// merged into the carried entry, never emitted as a fresh finding, never
// dropped) from genuinely-new findings that proceed to the merge pipeline.
function splitReobservations(findings, ledger, round) {
  const ledgerFingerprints = new Set(ledger.map((f) => f.fingerprint));
  const reobservations = [];
  const genuinelyNew = [];
  for (const f of findings) {
    if (ledgerFingerprints.has(f.fingerprint)) {
      reobservations.push({ fingerprint: f.fingerprint, specialist: f.specialist, round: round === undefined ? null : round });
    } else {
      genuinelyNew.push(f);
    }
  }
  return { reobservations, genuinelyNew };
}

module.exports = {
  SEVERITY_RANK,
  canonicalFingerprint,
  hasV2Fields,
  computeFingerprintV2,
  isCrossRuntime,
  canonicalLine,
  isExactDuplicatePair,
  mergeExactDuplicates,
  computeProbableDuplicates,
  splitReobservations,
};
