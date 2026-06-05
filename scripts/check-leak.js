#!/usr/bin/env node
// check-leak.js — CommonJS, buildless (runs directly, no dist compile).
//
// Generic secret / PII / credential scanner. This is the *generic* half of /roster-upgrade's
// two-gate contract: it catches universal leak patterns (private keys, provider tokens,
// credentials, PII) that should never appear in a generic, shareable skill. It is deliberately
// NOT target-aware — target-specific leaks (a particular codebase's names, scope, findings) are
// the job of each pack's OWN validator. Generic gate + per-target gate together; this is the
// generic one. It catches LITERAL secret/credential shapes, NOT semantic over-fit to a target.
//
// ⚠ ENFORCEMENT IS THE CALLER'S JOB. This script only reports + exits non-zero. It does not, by
// itself, block anything. To be a real fail-closed gate it must be wired to the land/merge path
// over the files from `git diff --name-only` (a CI step / pre-land hook), NOT an agent-supplied
// argv list. See skills/meta/roster-upgrade.md and rules/escalation.md "Enforcement".
//
// Usage:  node scripts/check-leak.js <file> [<file> ...]
// Exit:   0 = clean (or only warnings)   1 = HIGH-confidence secret/credential found
//         3 = usage error
//
//   HIGH  → fail closed (exit 1). Real secret/credential shapes.
//   WARN  → printed, never fails on its own (exit 0). PII / high-entropy blobs a human eyeballs;
//           they feed /roster-upgrade's "low-assurance" flag.
//
// The `leak-ok` marker (strict word token) exempts a line. ⚠ It exempts the WHOLE line and is
// editable by the same agent that proposes edits, so it is NOT a security control against a
// motivated upgrader — only a convenience for committed fixtures. Real protection must be a
// delta-gate (reject a newly-ADDED line that carries both a HIGH match and a leak-ok marker);
// that lives in the enforcement wiring above, not here. See check-leak.test.js.

"use strict";

const fs = require("fs");

const MARKER = /(?:^|\s)#?\s*leak-ok\b/; // strict token, not a bare substring (so `leak-okay` ≠ match)

// A value is a placeholder only if the WHOLE value is placeholder-shaped (anchored ^…$), so a real
// secret that merely *starts* with "test"/"example" is NOT whitelisted.
const PLACEHOLDER = [
  /^<.*>$/,
  /^x{3,}$/i, /^\*{3,}$/, /^\.{3,}$/,
  /^(?:changeme|change[_-]?me|placeholder|redacted|none|null|nil|todo|fixme|fake|dummy|sample|example|test|secret|password|passwd|token|value|string)$/i,
  /^(?:your|my|the|some|a)[_-][a-z0-9_-]+$/i,         // your-api-key, my_token …
  /^(?:example|sample|dummy|fake|test)[_-][a-z0-9_-]+$/i, // example-value-here …
];
const isPlaceholder = (v) => PLACEHOLDER.some((re) => re.test(v));

// HIGH-confidence patterns: a match (outside placeholders) fails the gate.
const HIGH = [
  { name: "private-key-block", re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { name: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z_]{22,}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: "google-oauth-token", re: /\bya29\.[0-9A-Za-z_\-]{20,}\b/ },
  { name: "stripe-key", re: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/ },
  { name: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/ },
  { name: "azure-account-key", re: /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/ },
  { name: "credential-in-url", re: /\b[a-z][a-z0-9+.\-]*:\/\/[^\/\s:@]+:[^\/\s:@]+@/i },
  { name: "credential-in-query", re: /[?&](?:token|key|sig|secret|password|passwd|api[_-]?key|access[_-]?token|auth)=[^&\s"'<>]{12,}/i },
  // secret-name (optionally prefixed: DB_PASSWORD, STRIPE_SECRET_KEY) = real-looking value.
  // Value charset includes "." so JWTs/dotted tokens are not truncated. Placeholders excluded below.
  {
    name: "secret-assignment",
    re: /(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|api[_-]?secret|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|private[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9/+_.\-]{16,})["']?/i,
    valueGroup: 1,
  },
];

// WARN patterns: PII / infra / blobs. Printed, never hard-fail.
const WARN = [
  { name: "email", re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/, ignore: /@(example|test|invalid|localhost)\./i },
  { name: "private-ipv4", re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
  // long unbroken base64/PEM-body run (catches key bodies & blobs without HIGH false positives)
  { name: "high-entropy-blob", re: /\b[A-Za-z0-9+/]{60,}={0,2}\b/ },
];

function scanLine(line) {
  if (MARKER.test(line)) return [];
  const hits = [];
  for (const p of HIGH) {
    const m = p.re.exec(line);
    if (!m) continue;
    const value = p.valueGroup ? m[p.valueGroup] : null;
    if (value && isPlaceholder(value)) continue; // a documented placeholder, not a secret
    hits.push({ level: "HIGH", name: p.name });
  }
  for (const p of WARN) {
    const m = p.re.exec(line);
    if (!m) continue;
    if (p.ignore && p.ignore.test(m[0])) continue;
    hits.push({ level: "WARN", name: p.name });
  }
  return hits;
}

// Scan one file → { high: [...], warn: [...] }.
function scanFile(file) {
  const high = [];
  const warn = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const hit of scanLine(line)) {
      const rec = { file, line: i + 1, name: hit.name };
      (hit.level === "HIGH" ? high : warn).push(rec);
    }
  });
  return { high, warn };
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/check-leak.js <file> [<file> ...]");
    return 3;
  }
  const high = [];
  const warn = [];
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`✗ check-leak: file not found: ${f}`);
      return 3;
    }
    const r = scanFile(f);
    high.push(...r.high);
    warn.push(...r.warn);
  }
  for (const w of warn) console.error(`  ⚠ check-leak WARN ${w.file}:${w.line} — possible ${w.name} (eyeball it)`);
  if (high.length > 0) {
    for (const h of high) console.error(`✗ check-leak HIGH ${h.file}:${h.line} — ${h.name} (secret/credential — fail closed)`);
    console.error(`✗ check-leak: ${high.length} high-confidence leak(s). A generic skill must not carry secrets.`);
    return 1;
  }
  console.log(`✓ check-leak: no high-confidence secrets in ${files.length} file(s)${warn.length ? ` (${warn.length} warning(s) — see above)` : ""}.`);
  return 0;
}

module.exports = { scanLine, scanFile, main };

if (require.main === module) process.exit(main(process.argv));
