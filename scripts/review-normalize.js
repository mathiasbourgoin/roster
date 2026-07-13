#!/usr/bin/env node
// scripts/review-normalize.js — CommonJS, read-only w.r.t. the repository.
//
// H-05 review-result normalizer (spec: specs/review-skill-slimming.md US-2,
// FR-099..108, Amendment D-1 reobservations[]). Validates new-round specialist
// findings against schema/review-finding.schema.json, carries prior-round
// ledger entries forward byte-identical (FR-101), mechanically merges exact
// duplicates (FR-104) and surfaces probable duplicates for owner adjudication
// (FR-105), separates cross-runtime findings from the primary pipeline
// (FR-106), and reports schema-invalid input in `rejected[]` (FR-100) —
// never silently dropped.
//
// Usage:
//   node scripts/review-normalize.js [<finding-file.json> ...] [--ledger <path>] [--round <n>]
//
// Each positional file is a JSON array of specialist finding objects; with no
// positional files, findings are read from stdin (a JSON array; empty stdin
// is treated as an empty array, EC-8). `--ledger <path>` is the prior
// cumulative ledger (a JSON array of previously-persisted findings); absent
// means no ledger (first round). `--round <n>` is passed by roster-review to
// stamp reobservations — omitted means `round: null`.
//
// Output: single JSON object on stdout —
//   { findings, cross_runtime_findings, probable_duplicates, rejected,
//     reobservations, stats, normalizer_version }
// Exit: 0 on success (including empty input); 2 on usage/degraded input.
"use strict";

const fs = require("fs");
const path = require("path");
const { loadFindingSchema } = require("./lib/finding-schema");
const {
  canonicalFingerprint,
  hasV2Fields,
  computeFingerprintV2,
  isCrossRuntime,
  mergeExactDuplicates,
  computeProbableDuplicates,
  splitReobservations,
} = require("./lib/normalize-rules");

const NORMALIZER_VERSION = "1.0.0";

function fail(code, message) {
  process.stderr.write(`review-normalize: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { files: [], ledgerPath: null, round: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ledger") {
      out.ledgerPath = argv[++i];
      if (out.ledgerPath === undefined) fail(2, "--ledger requires a path argument");
    } else if (a === "--round") {
      const raw = argv[++i];
      const n = parseInt(raw, 10);
      if (Number.isNaN(n)) fail(2, "--round requires an integer argument");
      out.round = n;
    } else if (a.startsWith("--")) {
      fail(2, `unknown flag: ${a}`);
    } else {
      out.files.push(a);
    }
  }
  return out;
}

function readJsonArrayFile(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) fail(2, `${label} not found: ${filePath}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (e) {
    fail(2, `${label} is not valid JSON: ${e.message}`);
    return;
  }
  if (!Array.isArray(parsed)) fail(2, `${label} must be a JSON array: ${filePath}`);
  return parsed;
}

function readStdinArray() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch (e) {
    return []; // no stdin attached (e.g. interactive TTY with nothing piped)
  }
  const trimmed = raw.trim();
  if (trimmed === "") return []; // EC-8: empty input -> empty array
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    fail(2, `stdin is not valid JSON: ${e.message}`);
    return;
  }
  if (!Array.isArray(parsed)) fail(2, "stdin must be a JSON array");
  return parsed;
}

function readNewFindings(files) {
  if (files.length === 0) return readStdinArray();
  let all = [];
  for (const f of files) all = all.concat(readJsonArrayFile(f, "finding file"));
  return all;
}

// Validates each candidate against the canonical schema, splitting into
// `valid` (kept) and `rejected` (schema-invalid, with a reason — FR-100).
function validateFindings(candidates) {
  const validator = loadFindingSchema();
  const valid = [];
  const rejected = [];
  for (const f of candidates) {
    const { valid: ok, errors } = validator.validate(f);
    if (ok) valid.push(f);
    else rejected.push({ finding: f, reason: errors.join("; ") });
  }
  return { valid, rejected };
}

// Canonicalizes fingerprint (FR-102, always recomputed — never trusted from
// input) and computes fingerprint_v2 where applicable (FR-103), returning
// NEW objects — inputs are never mutated.
function canonicalizeFindings(findings) {
  return findings.map((f) => {
    const canon = Object.assign({}, f, { fingerprint: canonicalFingerprint(f) });
    if (hasV2Fields(canon)) canon.fingerprint_v2 = computeFingerprintV2(canon);
    return canon;
  });
}

function buildStats({ input, rejected, crossRuntime, reobservations, merged, ledger, probableDuplicates }) {
  return {
    input,
    rejected,
    cross_runtime: crossRuntime,
    reobservations,
    merged,
    carried_forward: ledger,
    probable_duplicates: probableDuplicates,
  };
}

// Pure orchestration (no I/O) — exported so tests can exercise the full
// pipeline without going through argv/stdin/exit.
function normalize({ newFindings, ledger, round }) {
  const ledgerArr = Array.isArray(ledger) ? ledger : [];
  const { valid, rejected } = validateFindings(newFindings);

  const crossRuntimeFindings = [];
  const primaryCandidates = [];
  for (const f of valid) (isCrossRuntime(f) ? crossRuntimeFindings : primaryCandidates).push(f);

  const canonicalized = canonicalizeFindings(primaryCandidates);
  const { reobservations, genuinelyNew } = splitReobservations(canonicalized, ledgerArr, round);

  const settled = mergeExactDuplicates(genuinelyNew);
  const probableDuplicates = computeProbableDuplicates(settled);

  const findings = ledgerArr.concat(settled);

  return {
    findings,
    cross_runtime_findings: crossRuntimeFindings,
    probable_duplicates: probableDuplicates,
    rejected,
    reobservations,
    stats: buildStats({
      input: newFindings.length,
      rejected: rejected.length,
      crossRuntime: crossRuntimeFindings.length,
      reobservations: reobservations.length,
      merged: settled.length,
      ledger: ledgerArr.length,
      probableDuplicates: probableDuplicates.length,
    }),
    normalizer_version: NORMALIZER_VERSION,
  };
}

function main(argv) {
  const args = parseArgs(argv);
  const newFindings = readNewFindings(args.files);
  const ledger = args.ledgerPath ? readJsonArrayFile(args.ledgerPath, "--ledger file") : [];
  const result = normalize({ newFindings, ledger, round: args.round });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}

module.exports = { normalize, parseArgs, NORMALIZER_VERSION };

if (require.main === module) {
  main(process.argv.slice(2));
}
