#!/usr/bin/env node
// check-leak.test.js — CommonJS, run via `node --test scripts/check-leak.test.js`.
// The generic leak gate is fail-closed safety; this verifies it actually catches what it claims
// and does not false-positive on clean skill prose or documented placeholders.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scanLine, main } = require("./check-leak.js");

const high = (line) => scanLine(line).filter((h) => h.level === "HIGH").map((h) => h.name);
const warn = (line) => scanLine(line).filter((h) => h.level === "WARN").map((h) => h.name);

test("flags high-confidence secrets and credentials", () => {
  assert.ok(high("-----BEGIN RSA PRIVATE KEY-----").includes("private-key-block"));
  assert.ok(high("key = AKIAIOSFODNN7EXAMPLE").includes("aws-access-key-id"));
  assert.ok(high("token ghp_0123456789abcdefghijklmnopqrstuvwxyz").includes("github-token"));
  assert.ok(high("clone https://user:s3cr3tpassw0rd@github.com/x").includes("credential-in-url"));
  assert.ok(high('api_key: "a1b2c3d4e5f6g7h8i9j0"').includes("secret-assignment"));
});

test("does NOT flag documented placeholders or clean prose", () => {
  assert.deepStrictEqual(high("api_key: <your-api-key>"), []);
  assert.deepStrictEqual(high("password = changeme"), []);
  assert.deepStrictEqual(high("secret: example-value-here"), []);
  assert.deepStrictEqual(high("Run the hunt skill, then prove the finding with an oracle."), []);
  assert.deepStrictEqual(high("- **Two gates, fail closed.** Generic gate AND the target validator."), []);
});

test("respects the leak-ok exemption marker", () => {
  assert.deepStrictEqual(high("key = AKIAIOSFODNN7EXAMPLE  # leak-ok fixture"), []);
});

test("emails/PII are WARN, not HIGH; example domains ignored", () => {
  assert.deepStrictEqual(high("contact real.person@company.com"), []); // not a hard fail
  assert.ok(warn("contact real.person@company.com").includes("email"));
  assert.deepStrictEqual(warn("see user@example.com for the demo"), []); // example domain ignored
  assert.ok(warn("target host 10.0.4.17 internal").includes("private-ipv4"));
});

test("main() exit codes: clean=0, high-secret=1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-leak-"));
  try {
    const clean = path.join(dir, "clean.md");
    const dirty = path.join(dir, "dirty.md");
    fs.writeFileSync(clean, "# Skill\n\nGeneric methodology. No secrets here.\n");
    fs.writeFileSync(dirty, "config:\n  aws_key = AKIAIOSFODNN7EXAMPLE\n");
    assert.strictEqual(main(["node", "check-leak.js", clean]), 0);
    assert.strictEqual(main(["node", "check-leak.js", dirty]), 1);
    assert.strictEqual(main(["node", "check-leak.js"]), 3); // usage error
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
