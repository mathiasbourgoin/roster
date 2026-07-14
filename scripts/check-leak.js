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
  { name: "credential-in-query", re: /[?&](?:token|key|sig|secret|password|passwd|pwd|cred(?:ential)?s?|api[_-]?key|access[_-]?token|auth)=[^&\s"'<>]{12,}/i },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9_\-.=]{16,}\b/ },
  // secret-name (optionally prefixed: DB_PASSWORD, STRIPE_SECRET_KEY) = real-looking value.
  // Value charset includes "." so JWTs/dotted tokens are not truncated. Placeholders excluded below.
  {
    name: "secret-assignment",
    re: /(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|api[_-]?secret|secret(?:[_-]?(?:key|id))?|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|pwd|credentials?|creds|private[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9/+_.\-]{16,})["']?/i,
    valueGroup: 1,
  },
];

// WARN patterns: PII / infra. Printed, never hard-fail.
const WARN = [
  { name: "email", re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/, ignore: /@(example|test|invalid|localhost)\./i },
  { name: "private-ipv4", re: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
];

// Shannon entropy in bits/char — measures alphabet-normalized randomness of a string.
function shannonEntropy(s) {
  const freq = {};
  for (const c of s) freq[c] = (freq[c] || 0) + 1;
  let bits = 0;
  for (const count of Object.values(freq)) {
    const p = count / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// BLOB_ENTROPY_MIN — corpus-derived threshold (spec leak-scanner-entropy.md OQ3/LSE-2).
// Measured corpus (reproduced from HEAD + git history, commit 1d1eea0):
//   slash-joined keyword list (real FP #1)                    75 chars   3.913 bits/char
//   "Zm9vYmFy".repeat(10) (old HIGH_BLOB fixture)              80 chars   2.750 bits/char
//   package-lock.json sha512 base64 values (3 sampled)         86 chars   5.381–5.503 bits/char
//   review-bundle.manifest.json 64-hex values (2 sampled)      64 chars   3.786–3.832 bits/char
//   random 60-char base64 (min over 200 samples)               60 chars   4.683 bits/char
//   random 64-hex (min over 200 samples)                       64 chars   3.656 bits/char
// 4.3 clears the highest must-clear sample (prose list, 3.913) with a 0.39 margin. On the
// must-fire side: the deterministic committed fixture asserts its own entropy above 4.3, and
// separately 0 of 10^6 random 60-char base64 samples measured below 4.5 (a one-off sample-min
// like 4.683 is not itself reproducible evidence).
// IMPORTANT: this threshold must NEVER be applied to hex-only runs. A real sha256/sha512 hex
// digest measures ~3.66–3.83 bits/char — BELOW the prose list it must clear — because the hex
// alphabet caps entropy at 4 bits/char. Any threshold that clears prose also sits above bare-hex
// entropy, so hex-only runs are classified by shape/context (classifyBlobRun below), never by
// this constant (INV-3).
// Accepted-miss class (documented per spec N-1): base64 encoding highly repetitive plaintext
// (e.g. repeated words) can measure as low as ~3.25 bits/char and will stop firing HIGH under
// this floor. Realistic encoded credentials measure >=4.6 and stay HIGH; no other detection class
// covers a bare unnamed low-entropy blob — this gap is accepted at the spec's INV-4 letter.
const BLOB_ENTROPY_MIN = 4.3;

// Matches: ≥60-char unbroken base64-alphabet run (existing shape, now entropy/shape-gated).
const BLOB_RE = /\b[A-Za-z0-9+/]{60,}={0,2}\b/g;
// Matches: exactly-40-hex run, invisible to BLOB_RE's 60-char floor but still a checksum-shaped
// class (INV-3/CHECK-1c). No `=` in the lookarounds (D-2): `seed=<40-hex>` must still match — an
// assignment-shaped hole `secret-assignment`'s keyword list does not cover.
const HEX40_RE = /(?<![A-Za-z0-9+/])[A-Fa-f0-9]{40}(?![A-Za-z0-9+/])/g;
// checksum-like context: a key name in KEY POSITION, matched only against the text PRECEDING
// the value (A-1: anchored, not a bare word match; A-2: keys precede values in every legitimate
// format — JSON, YAML, ini, `sha256:` prefixes — while trailing comments like "// sha256: ref"
// never do. Red fixtures pin both trailing-comment forms, with and without the colon).
const CHECKSUM_CONTEXT = /(integrity|sha1|sha256|sha512|checksum|digest)["']?\s*[:=]/i;
// explicit integrity value prefix immediately before the matched run (checked for any alphabet,
// first in classification order). sha384- added per spec A-1 (npm SRI legitimately emits it at
// 64 base64 chars — the same false-positive class this task fixes). Left boundary required
// (A-3, codex cross-runtime finding): an algorithm suffix embedded in an identifier
// ("xsha512-<blob>") must NOT downgrade; legitimate SRI values are always preceded by a
// non-alphanumeric (quote, space, colon).
// Trailing `[+/]?` (A-4, leak-integrity-prefix-boundary): BLOB_RE's leading `\b` cannot match
// before a `+`/`/` (both non-word chars), so a payload starting with one of those two base64
// chars is matched from the FIRST ALPHANUMERIC char onward — the leading `+`/`/` stays in
// `before`, e.g. `"sha512-+SqB…`. Tolerating exactly one trailing `+`/`/` here re-recognizes the
// prefix without widening BLOB_RE itself or touching HIGH detection: a bare high-entropy blob
// with no `sha…-`/`sha…:` prefix immediately before it still falls through to the entropy path
// (INV-5 — the tolerance is gated on the prefix being present, not unconditional).
const INTEGRITY_PREFIX = /(?<![a-z0-9])sha(?:256:|512-|384-)[+/]?$/i;

// Classify one candidate blob run. `before` is the text preceding the match on the same line —
// used for BOTH the adjacent integrity-prefix check and the key-position context check (A-2:
// context after the value, e.g. a trailing comment, is never legitimizing).
// Returns { level, name } or null (no HIGH_BLOB finding at all — the only permitted HIGH→gone
// transition, gated strictly by entropy on mixed-alphabet runs, INV-4).
function classifyBlobRun(before, run) {
  if (INTEGRITY_PREFIX.test(before)) return { level: "WARN", name: "checksum-like-blob" };
  if (/^[A-Fa-f0-9]+$/.test(run)) {
    if ((run.length === 40 || run.length === 64) && CHECKSUM_CONTEXT.test(before)) {
      return { level: "WARN", name: "checksum-like-blob" };
    }
    // bare hex, or a 40/64-hex run with no checksum-like context, or a 63/65-hex near-miss —
    // entropy is never computed for hex (INV-3: hex entropy sits below the prose-clearing floor).
    return { level: "HIGH", name: "high-entropy-blob" };
  }
  const bare = run.endsWith("=") ? run.slice(0, run.indexOf("=")) : run;
  if (shannonEntropy(bare) < BLOB_ENTROPY_MIN) return null; // low-entropy prose-like run — LSE-2
  return { level: "HIGH", name: "high-entropy-blob" };
}

// Scan a line for blob-shaped runs (BLOB_RE ∪ HEX40_RE), classified via classifyBlobRun.
// N-3: iterate via `line.matchAll()` only — never a manual `re.exec` loop on a module-level /g
// regex, whose `lastIndex` would leak across lines/files and silently fail open.
function scanBlobs(line) {
  const hits = [];
  for (const re of [BLOB_RE, HEX40_RE]) {
    for (const m of line.matchAll(re)) {
      const before = line.slice(0, m.index);
      const result = classifyBlobRun(before, m[0]);
      if (result) hits.push(result);
    }
  }
  return hits;
}

// strict = true disables the leak-ok marker exemption (used by the delta-gate in check-leak-diff.sh
// to reject a newly-added line that carries both a HIGH match and a leak-ok marker).
function scanLine(line, strict = false) {
  if (!strict && MARKER.test(line)) return [];
  const hits = [];
  for (const p of HIGH) {
    const m = p.re.exec(line);
    if (!m) continue;
    const value = p.valueGroup ? m[p.valueGroup] : null;
    if (value && isPlaceholder(value)) continue; // a documented placeholder, not a secret
    hits.push({ level: "HIGH", name: p.name });
  }
  hits.push(...scanBlobs(line));
  for (const p of WARN) {
    const m = p.re.exec(line);
    if (!m) continue;
    if (p.ignore && p.ignore.test(m[0])) continue;
    hits.push({ level: "WARN", name: p.name });
  }
  return hits;
}

// Scan one file → { high: [...], warn: [...] }.
function scanFile(file, strict = false) {
  const high = [];
  const warn = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const hit of scanLine(line, strict)) {
      const rec = { file, line: i + 1, name: hit.name };
      (hit.level === "HIGH" ? high : warn).push(rec);
    }
  });
  return { high, warn };
}

function main(argv) {
  const args = argv.slice(2);
  const strict = args.includes("--strict");
  const files = args.filter((a) => a !== "--strict");
  if (files.length === 0) {
    console.error("usage: node scripts/check-leak.js [--strict] <file> [<file> ...]");
    return 3;
  }
  const high = [];
  const warn = [];
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`✗ check-leak: file not found: ${f}`);
      return 3;
    }
    const r = scanFile(f, strict);
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

module.exports = { scanLine, scanFile, main, shannonEntropy, BLOB_ENTROPY_MIN };

if (require.main === module) process.exit(main(process.argv));
