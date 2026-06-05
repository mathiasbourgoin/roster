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
const { scanLine, main } = require("./check-leak.js");

const high = (line) => scanLine(line).filter((h) => h.level === "HIGH").map((h) => h.name);
const warn = (line) => scanLine(line).filter((h) => h.level === "WARN").map((h) => h.name);

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

test("PII/blobs are WARN, not HIGH; example domains ignored", () => {
  assert.deepStrictEqual(high("contact real.person@company.com"), []);
  assert.ok(warn("contact real.person@company.com").includes("email"));
  assert.deepStrictEqual(warn("see user@example.com for the demo"), []);
  assert.ok(warn("target host 10.0.4.17 internal").includes("private-ipv4"));
  assert.ok(warn("blob " + "Zm9vYmFy".repeat(10)).includes("high-entropy-blob"));
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
