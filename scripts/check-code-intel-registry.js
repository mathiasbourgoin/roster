#!/usr/bin/env node
// check-code-intel-registry.js — CommonJS, buildless, dependency-free.
//
// Offline validator for the code-intel pack registry (registry/code-intel.jsonl).
// registry/code-intel.schema.json is the documentation-of-record for the entry shape;
// this checker hand-rolls every constraint of that schema — no validator dependency (C-9).
//
// Checks (FR-009..013):
//   1. each non-blank line parses as a JSON object (blank lines are skipped, so an
//      empty registry — zero bytes or a lone trailing newline — is valid)
//   2. required fields: name (kebab-case), tool, repo, languages, provides, install, tier
//   3. repo is exactly one of: http(s) URL | repo-relative path (no leading /, no "..")
//   4. relative repo paths exist in the repo (relative to --root, default: repo root)
//   5. notes is required non-empty when tier=verified
//   6. name and tool are unique across the registry
//   7. no unknown fields (schema has additionalProperties: false)
//
// Network: NEVER in default mode (FR-012). The optional --online flag runs
// `git ls-remote <url> HEAD` (20s timeout) per URL repo and reports unreachable
// repos — never run in CI (FR-013). The checker never reads .harness/extensions.json;
// installed packs are out of its scope (FR-015).
//
// Usage:  node scripts/check-code-intel-registry.js [registry.jsonl] [--root <dir>] [--online]
// Exit:   0 = registry valid   1 = one or more violations   3 = usage error

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const LANGUAGES = ["go", "rust", "typescript", "javascript", "python", "ocaml"];
const PROVIDES = ["gate", "audit-section", "init", "research-orientation"];
const TIERS = ["verified", "community"];
const KNOWN_FIELDS = ["name", "tool", "repo", "languages", "provides", "install", "tier", "notes"];
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ONLINE_TIMEOUT_MS = 20000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Validate `repo`: http(s) URL, or repo-relative path that exists under root.
function validateRepo(repo, root, errors) {
  if (!isNonEmptyString(repo)) {
    errors.push("`repo` must be a non-empty string (URL or repo-relative path)");
    return;
  }
  if (/^https?:\/\//.test(repo)) {
    let host = "";
    try { host = new URL(repo).host; } catch { /* malformed */ }
    if (!host) errors.push(`\`repo\` URL is malformed: ${JSON.stringify(repo)}`);
    return;
  }
  if (repo.startsWith("/")) {
    errors.push("`repo` relative path must not start with '/'");
  } else if (repo.includes("..")) {
    errors.push("`repo` relative path must not contain '..'");
  } else if (!fs.existsSync(path.join(root, repo))) {
    errors.push(`\`repo\` relative path does not exist in the repo: ${JSON.stringify(repo)}`);
  }
}

function validateEnumArray(value, field, allowed, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`\`${field}\` must be a non-empty array`);
    return;
  }
  for (const item of value) {
    if (!allowed.includes(item)) {
      errors.push(`\`${field}\` contains ${JSON.stringify(item)} — allowed: ${allowed.join(", ")}`);
    }
  }
}

// Validate one parsed entry object → array of error strings (empty = valid).
function validateEntry(entry, root) {
  const errors = [];
  for (const key of Object.keys(entry)) {
    if (!KNOWN_FIELDS.includes(key)) errors.push(`unknown field \`${key}\``);
  }
  if (!isNonEmptyString(entry.name) || !KEBAB_CASE.test(entry.name)) {
    errors.push(`\`name\` must be a kebab-case string (got ${JSON.stringify(entry.name)})`);
  }
  if (!isNonEmptyString(entry.tool)) errors.push("`tool` must be a non-empty string");
  validateRepo(entry.repo, root, errors);
  validateEnumArray(entry.languages, "languages", LANGUAGES, errors);
  validateEnumArray(entry.provides, "provides", PROVIDES, errors);
  if (!isNonEmptyString(entry.install)) errors.push("`install` must be a non-empty string");
  if (!TIERS.includes(entry.tier)) {
    errors.push(`\`tier\` must be one of: ${TIERS.join(", ")} (got ${JSON.stringify(entry.tier)})`);
  }
  if (entry.notes !== undefined && typeof entry.notes !== "string") {
    errors.push("`notes` must be a string");
  }
  if (entry.tier === "verified" && !isNonEmptyString(entry.notes)) {
    errors.push("`notes` is required and must be non-empty for verified-tier entries");
  }
  return errors;
}

// Validate one raw line; records violations and (when parseable) the entry into ctx.
function checkLine(raw, line, root, ctx) {
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch (err) {
    ctx.violations.push({ line, msg: `unparseable JSON: ${err.message}` });
    return;
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    ctx.violations.push({ line, msg: "line must be a JSON object" });
    return;
  }
  for (const msg of validateEntry(entry, root)) ctx.violations.push({ line, msg });
  for (const field of ["name", "tool"]) {
    const value = entry[field];
    if (!isNonEmptyString(value)) continue;
    const seen = ctx.seen[field];
    if (seen.has(value)) {
      ctx.violations.push({ line, msg: `duplicate \`${field}\` ${JSON.stringify(value)} (first seen on line ${seen.get(value)})` });
    } else {
      seen.set(value, line);
    }
  }
  ctx.entries.push({ entry, line });
}

// Validate a registry file → { violations: [{line, msg}], entries: [{entry, line}] }.
// line 0 = file-level violation. An empty file (or blank lines only) is a valid registry.
function checkRegistry(registryPath, root) {
  const ctx = { violations: [], entries: [], seen: { name: new Map(), tool: new Map() } };
  if (!fs.existsSync(registryPath)) {
    ctx.violations.push({ line: 0, msg: `registry file not found: ${registryPath}` });
    return ctx;
  }
  const lines = fs.readFileSync(registryPath, "utf8").split("\n");
  lines.forEach((raw, idx) => {
    if (raw.trim() === "") return;
    checkLine(raw, idx + 1, root, ctx);
  });
  return ctx;
}

// --online only: `git ls-remote <url> HEAD` per URL repo. Never called in default mode.
function checkOnline(entries) {
  const violations = [];
  for (const { entry, line } of entries) {
    if (typeof entry.repo !== "string" || !/^https?:\/\//.test(entry.repo)) continue;
    try {
      execFileSync("git", ["ls-remote", entry.repo, "HEAD"], {
        timeout: ONLINE_TIMEOUT_MS,
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      violations.push({ line, msg: `--online: repo unreachable via \`git ls-remote\`: ${entry.repo}` });
    }
  }
  return violations;
}

// Parse CLI args → { online, root, registryPath } or null on usage error.
function parseArgs(args) {
  const opts = { online: false, root: path.resolve(__dirname, ".."), registryPath: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--online") {
      opts.online = true;
    } else if (args[i] === "--root") {
      const value = args[++i];
      if (value === undefined) return null;
      opts.root = path.resolve(value);
    } else if (args[i].startsWith("--")) {
      return null;
    } else if (opts.registryPath === null) {
      opts.registryPath = args[i];
    } else {
      return null;
    }
  }
  if (opts.registryPath === null) {
    opts.registryPath = path.join(opts.root, "registry", "code-intel.jsonl");
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv.slice(2));
  if (opts === null) {
    console.error("usage: node scripts/check-code-intel-registry.js [registry.jsonl] [--root <dir>] [--online]");
    return 3;
  }
  const { violations, entries } = checkRegistry(opts.registryPath, opts.root);
  const all = opts.online ? violations.concat(checkOnline(entries)) : violations;
  if (all.length) {
    for (const v of all) {
      const where = v.line === 0 ? "" : `line ${v.line}: `;
      console.error(`✗ check-code-intel-registry: ${where}${v.msg}`);
    }
    console.error(`✗ check-code-intel-registry: ${all.length} violation(s) in ${opts.registryPath}`);
    return 1;
  }
  console.log(`✓ check-code-intel-registry: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} valid in ${opts.registryPath}`);
  return 0;
}

module.exports = { checkRegistry, validateEntry, main };

if (require.main === module) process.exit(main(process.argv));
