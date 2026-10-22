#!/usr/bin/env node
"use strict";

// Checks the source-level Express Lite contract and small routing fixtures. The
// router is an agent instruction, so this prevents its required fail-closed
// clauses from silently disappearing; it does not pretend to classify a live
// task without its declared evidence.
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const rootFlag = args.indexOf("--root");
const root = path.resolve(rootFlag < 0 ? "." : args[rootFlag + 1] || "");

function read(relative) {
  try { return fs.readFileSync(path.join(root, relative), "utf8"); }
  catch { return ""; }
}

function checkContract() {
  const requirements = [
    ["skills/pipeline/roster-run.md", "| **Express Lite** |", "router mode"],
    ["skills/pipeline/roster-run.md", "Every changed hunk is demonstrably non-behavioral", "per-hunk behavior check"],
    ["skills/pipeline/roster-run.md", "No changed path is under `skills/`", "excluded paths"],
    ["skills/pipeline/roster-run.md", "No dependency version, executable configuration, public symbol, security, trust-boundary, or ambiguous check-selection", "semantic exclusions"],
    ["skills/pipeline/roster-run.md", "The relevant check is known and passes. Otherwise route to Fast.", "fail-closed check"],
    ["skills/pipeline/roster-run.md", "assurance: local", "local assurance"],
    ["skills/pipeline/roster-run.md", '"express-lite":["implement","review","ship"]', "ledger route"],
    ["skills/shared/preamble-pipeline.md", '"mode": "express-lite|express|fast|full"', "state mode"],
    ["skills/pipeline/roster-doctor.md", "express-lite: implement→review→ship", "doctor sequence"],
    ["skills/pipeline/roster-implement.md", "implement directly without spawning an agent or asking a preliminary question", "direct implementation"],
    ["skills/pipeline/roster-implement.md", "declared relevant check replaces the baseline build/test gate", "relevant-check-only gate"],
    ["skills/pipeline/roster-review.md", "skip §3, specialists, and cross-runtime review", "local review"],
    ["skills/pipeline/roster-review.md", "All modes except Express Lite", "no delegated reviewer"],
    ["skills/pipeline/roster-review.md", "git diff --cached", "staged final diff"],
    ["skills/pipeline/roster-review.md", "git diff", "unstaged final diff"],
    ["skills/pipeline/roster-review.md", "git ls-files --others --exclude-standard", "untracked final diff"],
    ["skills/pipeline/roster-review.md", 'no_go_reason.type: "express-lite-ineligible"', "final reclassification NO-GO"],
    ["skills/pipeline/roster-ship.md", 'review.json.mode == "express-lite"', "ship mode guard"],
    ["skills/pipeline/roster-ship.md", 'assurance: "local"', "ship assurance guard"],
    ["schema/review-json-schema.md", '"assurance": "local|independent|null', "review assurance schema"],
    ["skills/pipeline/roster-run.md", '`review` NO-GO with `no_go_reason.type == "express-lite-ineligible"`', "durable escalation route"],
  ];
  const missing = requirements.filter(([file, needle]) => !read(file).includes(needle));
  if (missing.length) {
    for (const [file, , label] of missing) process.stderr.write(`missing Express Lite ${label}: ${file}\n`);
    return false;
  }
  process.stdout.write("express-lite contract: ok\n");
  return true;
}

function checkFixture(file) {
  let fixture;
  try { fixture = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(2); }
  const excluded = new Set(["behavior", "dependency-version", "public-api", "security", "trust-boundary", "ambiguous-check", "missing-check"]);
  const rejected = (fixture.signals || []).find((signal) => excluded.has(signal));
  if (rejected) { process.stdout.write(`fast: ${rejected}\n`); return false; }
  if (fixture.eligible !== true) { process.stdout.write("fast: not demonstrably eligible\n"); return false; }
  process.stdout.write(args.includes("--assert-local-review") ? "assurance: local\n" : "express-lite\n");
  return true;
}

if (args.includes("--check")) process.exit(checkContract() ? 0 : 1);
const fixtureFlag = args.indexOf("--fixture");
if (fixtureFlag < 0 || !args[fixtureFlag + 1]) process.exit(2);
process.exit(checkFixture(args[fixtureFlag + 1]) ? 0 : 1);
