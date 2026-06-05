#!/usr/bin/env node
// check-leak.js — CommonJS, buildless (runs directly, no dist compile).
//
// Generic secret / PII / credential scanner. This is the *generic* half of /roster-upgrade's
// two-gate contract: it catches universal leak patterns (private keys, provider tokens,
// credentials, PII) that should never appear in a generic, shareable skill. It is deliberately
// NOT target-aware — target-specific leaks (a particular codebase's names, scope, findings) are
// the job of each pack's OWN validator (e.g. bounty-skills' scripts/validate.sh). Generic gate +
// per-target gate together; this file is only the generic one.
//
// Usage:  node scripts/check-leak.js <file> [<file> ...]
// Exit:   0 = clean (or only warnings)   1 = HIGH-confidence secret/credential found
//         3 = usage error
//
// Findings are split by confidence:
//   HIGH  → fail closed (exit 1). Real secret/credential shapes.
//   WARN  → printed, never fails on its own (exit 0). PII smells a human should eyeball; they feed
//           /roster-upgrade's "low-assurance" flag, not a hard block, to keep false positives low.
//
// A line containing the marker `leak-ok` is exempt (intentional example/fixture).

"use strict";

const fs = require("fs");

const MARKER = "leak-ok";

// Values that are obviously placeholders, not real secrets — never flag these.
const PLACEHOLDER = /^(<.*>|x{3,}|y{3,}|z{3,}|your[_-]|example|sample|dummy|placeholder|redacted|changeme|change[_-]?me|todo|fixme|\.{3,}|\*{3,}|none|null|test|fake|xxx+)/i;

// HIGH-confidence patterns: a match (outside placeholders) fails the gate.
const HIGH = [
  { name: "private-key-block", re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z_]{22,}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { name: "credential-in-url", re: /\b[a-z][a-z0-9+.\-]*:\/\/[^\/\s:@]+:[^\/\s:@]+@/i },
  // secret-name = real-looking value (>=16 chars of secret-ish charset), placeholders excluded below
  {
    name: "secret-assignment",
    re: /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9/+_\-]{16,})["']?/i,
    valueGroup: 1,
  },
];

// WARN patterns: PII / infra smells. Printed, never hard-fail.
const WARN = [
  { name: "email", re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/, ignore: /@(example|test|invalid|localhost)\./i },
  { name: "private-ipv4", re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
];

function scanLine(line) {
  if (line.includes(MARKER)) return [];
  const hits = [];
  for (const p of HIGH) {
    const m = p.re.exec(line);
    if (!m) continue;
    const value = p.valueGroup ? m[p.valueGroup] : null;
    if (value && PLACEHOLDER.test(value)) continue; // a documented placeholder, not a secret
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

// Scan one file → { high: [...], warn: [...] }. Exported for the test harness.
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
  for (const w of warn) console.error(`  ⚠ check-leak WARN ${w.file}:${w.line} — possible ${w.name} (PII; eyeball it)`);
  if (high.length > 0) {
    for (const h of high) console.error(`✗ check-leak HIGH ${h.file}:${h.line} — ${h.name} (secret/credential — fail closed)`);
    console.error(`✗ check-leak: ${high.length} high-confidence leak(s). A generic skill must not carry secrets. Mark intentional examples with "leak-ok".`);
    return 1;
  }
  console.log(`✓ check-leak: no high-confidence secrets in ${files.length} file(s)${warn.length ? ` (${warn.length} PII warning(s) — see above)` : ""}.`);
  return 0;
}

module.exports = { scanLine, scanFile, main };

if (require.main === module) process.exit(main(process.argv));
