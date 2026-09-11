#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const TOP_LEVEL = new Set(["schema_version", "branch_protection", "direct_commit_count", "required_checks", "pull_requests"]);
const BRANCH_PROTECTION_KEYS = new Set(["known", "enabled"]);
const PULL_REQUEST_KEYS = new Set(["number", "merged", "checks", "reviews"]);
const CHECK_KEYS = new Set(["name", "conclusion"]);
const REVIEW_KEYS = new Set(["state"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableStringify(value) { return `${JSON.stringify(stable(value), null, 2)}\n`; }

function invalid(message) { const error = new Error(message); error.input = true; return error; }

function hasOnlyKeys(value, allowed) { return Object.keys(value).every((key) => allowed.has(key)); }

function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("input must be an object");
  for (const key of Object.keys(input)) if (!TOP_LEVEL.has(key)) throw invalid(`unknown top-level key: ${key}`);
  if (input.schema_version !== 1) throw invalid("schema_version must equal 1");
  if (!input.branch_protection || typeof input.branch_protection !== "object" || Array.isArray(input.branch_protection) || !hasOnlyKeys(input.branch_protection, BRANCH_PROTECTION_KEYS) || typeof input.branch_protection.known !== "boolean") throw invalid("branch_protection has invalid shape");
  if (input.branch_protection.known && typeof input.branch_protection.enabled !== "boolean") throw invalid("branch_protection.enabled must be boolean when known");
  if (!Number.isInteger(input.direct_commit_count) || input.direct_commit_count < 0) throw invalid("direct_commit_count must be a non-negative integer");
  if (!Array.isArray(input.required_checks) || input.required_checks.some((name) => typeof name !== "string" || !name)) throw invalid("required_checks must be an array of non-empty strings");
  if (new Set(input.required_checks).size !== input.required_checks.length) throw invalid("required_checks must not contain duplicates");
  if (!Array.isArray(input.pull_requests)) throw invalid("pull_requests must be an array");
  const numbers = new Set();
  input.pull_requests.forEach((pr, index) => {
    if (!pr || typeof pr !== "object" || Array.isArray(pr) || !hasOnlyKeys(pr, PULL_REQUEST_KEYS) || !Number.isInteger(pr.number) || pr.number < 1 || typeof pr.merged !== "boolean") throw invalid(`pull_requests[${index}] has invalid shape`);
    if (numbers.has(pr.number)) throw invalid(`pull_requests[${index}].number must be unique`);
    numbers.add(pr.number);
    if (Object.hasOwn(pr, "checks")) {
      if (!Array.isArray(pr.checks) || pr.checks.some((check) => !check || typeof check !== "object" || Array.isArray(check) || !hasOnlyKeys(check, CHECK_KEYS) || typeof check.name !== "string" || !check.name || typeof check.conclusion !== "string" || !check.conclusion)) throw invalid(`pull_requests[${index}].checks has invalid shape`);
      if (new Set(pr.checks.map((check) => check.name)).size !== pr.checks.length) throw invalid(`pull_requests[${index}].checks must not contain duplicate names`);
    }
    if (Object.hasOwn(pr, "reviews") && (!Array.isArray(pr.reviews) || pr.reviews.some((review) => !review || typeof review !== "object" || Array.isArray(review) || !hasOnlyKeys(review, REVIEW_KEYS) || typeof review.state !== "string" || !review.state))) throw invalid(`pull_requests[${index}].reviews has invalid shape`);
  });
  return input;
}

function finding(id, status, severity, evidence, remediation) { return { id, status, severity, evidence, remediation }; }

function audit(raw) {
  const input = validate(raw);
  const findings = [];
  const protection = input.branch_protection;
  findings.push(finding("BRANCH_PROTECTION_ENABLED", !protection.known ? "not-verifiable" : protection.enabled ? "pass" : "fail", "high", ["branch_protection"], "Capture and enable required branch protection."));
  findings.push(finding("DIRECT_COMMITS_ABSENT", input.direct_commit_count === 0 ? "pass" : "fail", "medium", ["direct_commit_count"], "Require delivery changes through pull requests."));
  for (const pr of input.pull_requests.filter((candidate) => candidate.merged).sort((left, right) => left.number - right.number)) {
    if (!pr.merged) continue;
    const checks = Array.isArray(pr.checks) ? pr.checks : null;
    const required = input.required_checks;
    const missing = checks === null || required.some((name) => !checks.some((check) => check && check.name === name));
    const failed = !missing && checks.findIndex((check) => required.includes(check.name) && check.conclusion !== "success");
    const prPath = `pull_requests[number=${pr.number}]`;
    const checkEvidence = checks ? checks.filter((check) => required.includes(check.name)).map((check) => `${prPath}.checks[name=${check.name}]`).sort() : [`${prPath}.checks`];
    findings.push(finding(`PR_REQUIRED_CHECKS_GREEN:pr-${pr.number}`, missing ? "not-verifiable" : failed >= 0 ? "fail" : "pass", "high", checkEvidence, "Require successful named checks before merge."));
    const reviews = Array.isArray(pr.reviews) ? pr.reviews : null;
    findings.push(finding(`PR_REVIEW_EVIDENCE:pr-${pr.number}`, reviews === null ? "not-verifiable" : reviews.some((review) => review.state === "approved") ? "pass" : "fail", "low", [`${prPath}.reviews`], "Capture an explicit review decision or document the operating policy."));
  }
  return stable({ schema_version: 1, findings: findings.sort((left, right) => left.id.localeCompare(right.id)) });
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) { process.stderr.write("usage: node scripts/delivery-integrity-audit.js <input.json>\n"); return 2; }
  try { process.stdout.write(stableStringify(audit(JSON.parse(fs.readFileSync(argv[0], "utf8"))))); return 0; }
  catch (error) { process.stderr.write(`${error.message}\n`); return error.input || error instanceof SyntaxError ? 2 : 70; }
}

if (require.main === module) process.exitCode = main();
module.exports = { audit, stableStringify };
