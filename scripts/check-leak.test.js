#!/usr/bin/env node
// check-leak.test.js — CommonJS, run via `node --test scripts/check-leak.test.js`.
// Adversarial: every case below is a bypass an internal security review FOUND in the first cut.
// They are now expected to FAIL CLOSED (HIGH) — that is the point of the suite.
//
// NOTE: provider-token fixtures are ASSEMBLED at runtime from fragments (e.g. "sk_" + "live_" + …)
// so no contiguous secret literal sits in this committed file — otherwise GitHub push-protection
// (correctly!) blocks the push. The scanner sees the assembled string and must still catch it.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scanLine, main, shannonEntropy, BLOB_ENTROPY_MIN } = require("./check-leak.js");

const high = (line) => scanLine(line).filter((h) => h.level === "HIGH").map((h) => h.name);
const warn = (line) => scanLine(line).filter((h) => h.level === "WARN").map((h) => h.name);

// Deterministic generators for blob-shaped fixtures (runtime-assembled — never a contiguous
// secret-shaped literal, per GitHub push protection). None of these depend on Math.random(): a
// fixed xorshift32/formula sequence makes the entropy side of each fixture reproducible.
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// Deterministic genuinely-high-entropy base64-alphabet run (xorshift32, fixed seed).
function makeHighEntropyBlob(len, seed) {
  let x = seed >>> 0;
  let s = "";
  for (let i = 0; i < len; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    s += B64_ALPHABET[x % B64_ALPHABET.length];
  }
  return s;
}
// Deterministic hex run of exact length (shape-only fixture — hex classification never depends
// on entropy, so this need not itself be high-entropy).
function makeHex(len, offset = 0) {
  const HEX = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += HEX[(i * 13 + offset) % 16];
  return s;
}

const HIGH_ENTROPY_BLOB_60 = makeHighEntropyBlob(60, 12345); // CHECK-1(b)/INV-2/S-5
const HEX64 = makeHex(64, 1);
const HEX40 = makeHex(40, 2);
const HEX63 = makeHex(63, 3);
const HEX65 = makeHex(65, 4);
// Slash-joined keyword list — the real FP #1 class (S-4): prose-like, low entropy despite length.
const SLASH_KEYWORD_LIST = [
  "intake", "research", "spec", "plan", "implement", "review", "qa", "ship", "triage", "workflow",
].join("/");

// Assembled fake tokens (no contiguous literal in source).
const T = {
  aws: "AKIA" + "ABCDEFGHIJ123456",
  ghp: "ghp_" + "a".repeat(36),
  stripe: "sk_" + "live_" + "ABCDEFGHIJ0123456789",
  openai: "sk-" + "proj-" + "ABCDEFGHIJKLMNOPQRST",
  jwt: "eyJ" + "A".repeat(10) + "." + "eyJ" + "B".repeat(10) + "." + "C".repeat(10),
  ya29: "ya29." + "A".repeat(24),
  azure: "AccountKey=" + "A".repeat(64) + "==",
  pw: "H".repeat(20),
};

test("known provider shapes", () => {
  assert.ok(high("-----BEGIN RSA PRIVATE KEY-----").includes("private-key-block"));
  assert.ok(high(T.aws).includes("aws-access-key-id"));
  assert.ok(high(T.ghp).includes("github-token"));
  assert.ok(high("https://user:s3cr3tpassw0rd@github.com/x").includes("credential-in-url"));
});

test("BYPASS CORPUS — previously missed, must now fail closed", () => {
  assert.ok(high("DB_PASSWORD=" + T.pw).includes("secret-assignment"), "DB_PASSWORD");
  assert.ok(high("STRIPE_SECRET_KEY=abcdefghijklmnop1234").includes("secret-assignment"), "prefixed secret key");
  assert.ok(high("token: " + T.jwt).includes("jwt"), "JWT");
  assert.ok(high('key = "' + T.ya29 + '"').length > 0, "google oauth");
  assert.ok(high("stripe " + T.stripe).includes("stripe-key"), "stripe");
  assert.ok(high("openai " + T.openai).includes("openai-key"), "openai");
  assert.ok(high("conn " + T.azure).includes("azure-account-key"), "azure");
  assert.ok(high("https://h/?token=abcdef123456ghijkl").includes("credential-in-query"), "query cred");
  // placeholder-prefixed REAL value (M1) — must NOT be excused
  assert.ok(high("api_key = testKEYa1b2c3d4e5f6g7h8i9j0").includes("secret-assignment"), "test-prefixed");
  assert.ok(high("api_key = xxxa1b2c3d4e5f6g7h8i9j0klmn").includes("secret-assignment"), "xxx-prefixed");
  // round-2 verifier finds: synonym/abbreviated keyword classes + Bearer + custom query param
  assert.ok(high("pwd=" + T.pw).includes("secret-assignment"), "pwd");
  assert.ok(high("credentials=" + T.pw).includes("secret-assignment"), "credentials");
  assert.ok(high("creds: " + T.pw).includes("secret-assignment"), "creds");
  assert.ok(high("secret_id=" + T.pw).includes("secret-assignment"), "secret_id");
  assert.ok(high("Authorization: Bearer " + "A".repeat(24)).includes("bearer-token"), "bearer");
  assert.ok(high("https://h/?cred=abcdef123456ghijkl").includes("credential-in-query"), "cred query");
});

test("leak-ok is a strict token, not a substring (C1 hardening)", () => {
  assert.deepStrictEqual(high(T.aws + "  # leak-ok fixture"), [], "real marker exempts");
  assert.ok(high(T.aws + " see leak-okay-docs").includes("aws-access-key-id"), "leak-okay must NOT exempt");
});

test("still does NOT flag genuine placeholders or clean prose", () => {
  assert.deepStrictEqual(high("api_key: <your-api-key>"), []);
  assert.deepStrictEqual(high("password = changeme"), []);
  assert.deepStrictEqual(high("secret: example-value-here"), []);
  assert.deepStrictEqual(high("- **Two gates, fail closed.** Generic gate AND the target validator."), []);
  assert.deepStrictEqual(high("Run the hunt skill, then prove the finding with an oracle."), []);
});

test("PII is WARN; high-entropy-blob is HIGH (exits 1); example domains ignored", () => {
  assert.deepStrictEqual(high("contact real.person@company.com"), []);
  assert.ok(warn("contact real.person@company.com").includes("email"));
  assert.deepStrictEqual(warn("see user@example.com for the demo"), []);
  assert.ok(warn("target host 10.0.4.17 internal").includes("private-ipv4"));
  // INV-2: the old low-entropy fixture ("Zm9vYmFy".repeat(10)) legitimately stops firing under
  // LSE-2 (see CHECK-3 below) and is replaced here by a genuinely high-entropy blob.
  assert.ok(shannonEntropy(HIGH_ENTROPY_BLOB_60) > BLOB_ENTROPY_MIN, "fixture must clear the threshold");
  assert.ok(high("blob " + HIGH_ENTROPY_BLOB_60).includes("high-entropy-blob"));
});

test("CHECK-1(c)/INV-3/S-3 — bare random hex, no checksum context, stays HIGH", () => {
  assert.ok(high("token " + HEX64).includes("high-entropy-blob"), "bare 64-hex");
  assert.ok(high("token " + HEX40).includes("high-entropy-blob"), "bare 40-hex");
});

test("CHECK-1(d)/INV-5 — near-miss shapes stay HIGH", () => {
  assert.ok(
    high('"sha256": "' + HEX63 + '"').includes("high-entropy-blob"),
    "63-hex with sha256 context is a near-miss, not exactly 40/64 — HIGH",
  );
  assert.ok(
    high('"sha256": "' + HEX65 + '"').includes("high-entropy-blob"),
    "65-hex with sha256 context is a near-miss — HIGH",
  );
  assert.ok(
    high('"integrity": "' + HIGH_ENTROPY_BLOB_60 + '"').includes("high-entropy-blob"),
    "high-entropy base64 near an 'integrity' key but with no adjacent sha512-/sha384- prefix — HIGH",
  );
});

test("[D-1] context-anchoring red fixture — word present, NOT key position — stays HIGH", () => {
  assert.ok(
    high(HEX64 + " // compare sha256 digest").includes("high-entropy-blob"),
    "sha256/digest mentioned in trailing prose, not as `key:`/`key=` — context gate must NOT fire",
  );
});

test("[A-2] trailing-comment colon form — context AFTER the value — stays HIGH", () => {
  assert.ok(
    high(HEX64 + " // sha256: reference hash").includes("high-entropy-blob"),
    "key-position context after the value (trailing comment) is never legitimizing — " +
      "only text preceding the match may downgrade",
  );
});

test("[D-2] assignment-hole red fixture — 40-hex after an unlisted key name — stays HIGH", () => {
  assert.ok(
    high("seed=" + HEX40).includes("high-entropy-blob"),
    "'seed' is not in secret-assignment's keyword list; the blob path must still catch the hex",
  );
});

test("[D-3] sha384- integrity prefix (npm SRI) downgrades to WARN, no HIGH", () => {
  const line = "sha384-" + HIGH_ENTROPY_BLOB_60;
  assert.ok(warn(line).includes("checksum-like-blob"), "WARN present");
  assert.deepStrictEqual(high(line), [], "HIGH absent");
});

test("CHECK-1(e)/LSE-1/INV-4 — recognized checksum shapes downgrade to WARN, never silently exempt", () => {
  const sriLine = '"integrity": "sha512-' + HIGH_ENTROPY_BLOB_60 + '=="';
  assert.ok(warn(sriLine).includes("checksum-like-blob"), "sha512- SRI value");
  assert.deepStrictEqual(high(sriLine), []);

  const hexKeyLine = '"sha256": "' + HEX64 + '"';
  assert.ok(warn(hexKeyLine).includes("checksum-like-blob"), "64-hex with sha256 key context");
  assert.deepStrictEqual(high(hexKeyLine), []);

  const barePrefixLine = "checksum: sha256:" + HEX64;
  assert.ok(warn(barePrefixLine).includes("checksum-like-blob"), "bare sha256: prefix");
  assert.deepStrictEqual(high(barePrefixLine), []);
});

test("CHECK-3/LSE-2/S-4 — entropy threshold: below fires nothing, above fires HIGH", () => {
  // Below the threshold — both cite BLOB_ENTROPY_MIN so moving the constant breaks these.
  assert.ok(shannonEntropy(SLASH_KEYWORD_LIST) < BLOB_ENTROPY_MIN, "keyword list below threshold");
  assert.deepStrictEqual(high("path: " + SLASH_KEYWORD_LIST), [], "slash-joined keyword list (real FP #1) — no HIGH");

  const oldFixture = "Zm9vYmFy".repeat(10);
  assert.ok(shannonEntropy(oldFixture) < BLOB_ENTROPY_MIN, "old repeat-8 fixture below threshold");
  assert.deepStrictEqual(high("blob " + oldFixture), [], "old low-entropy fixture — no HIGH (INV-2)");

  // Above the threshold — the CHECK-1(b) fixture's paired assertion.
  assert.ok(shannonEntropy(HIGH_ENTROPY_BLOB_60) > BLOB_ENTROPY_MIN, "high-entropy blob above threshold");
  assert.ok(high("blob " + HIGH_ENTROPY_BLOB_60).includes("high-entropy-blob"), "high-entropy blob — HIGH");
});

test("main() exit codes: clean=0, high-secret=1, usage=3", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-leak-"));
  try {
    const clean = path.join(dir, "clean.md");
    const dirty = path.join(dir, "dirty.md");
    fs.writeFileSync(clean, "# Skill\n\nGeneric methodology. No secrets here.\n");
    fs.writeFileSync(dirty, "config:\n  DB_PASSWORD=" + T.pw + "\n");
    assert.strictEqual(main(["node", "check-leak.js", clean]), 0);
    assert.strictEqual(main(["node", "check-leak.js", dirty]), 1);
    assert.strictEqual(main(["node", "check-leak.js"]), 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
