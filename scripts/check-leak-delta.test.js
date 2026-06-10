#!/usr/bin/env node
// check-leak-delta.test.js — tests the --strict flag and delta-gate behaviour of check-leak.js.
//
// Four fixtures (built at runtime — no committed secret literals):
//   (a) clean content in strict mode   → exit 0
//   (b) HIGH secret + leak-ok in strict mode → exit 1  (newly-added line bypass blocked)
//   (c) HIGH secret + leak-ok in normal mode → exit 0  (unchanged context line still exempted)
//   (d) HIGH secret + leak-ok where content starts with "+" (e.g. markdown "+ bullet") → exit 1
//       Tests that the check-leak-diff.sh grep fix ('^+' | grep -v '^+++') catches these;
//       after the shell strips the diff marker, the content reaching check-leak.js is "+ SECRET".
//
// NOTE: secret values are assembled at runtime so no contiguous literal sits in this committed
// file — same technique as check-leak.test.js to avoid GitHub push-protection false positives.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main } = require("./check-leak.js");

// Assembled at runtime — not a real credential, just a value that triggers secret-assignment.
const T_pw = "H".repeat(20);
const leakLine = `DB_PASSWORD=${T_pw}  # leak-ok fixture`;

let dir;
let cleanFile, leakOkFile, plusPrefixLeakFile;

test("setup temp fixtures", () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-leak-delta-"));
  cleanFile = path.join(dir, "clean.md");
  leakOkFile = path.join(dir, "leak-ok.md");
  plusPrefixLeakFile = path.join(dir, "plus-prefix-leak.md");
  fs.writeFileSync(cleanFile, "# Skill\n\nGeneric methodology. No secrets here.\n");
  fs.writeFileSync(leakOkFile, leakLine + "\n");
  // Simulates check-leak-diff.sh output after stripping the diff "+" marker from a line whose
  // content starts with "+": e.g. diff line "++ DB_PASSWORD=xxx # leak-ok" → content "+ DB_PASSWORD=xxx # leak-ok"
  fs.writeFileSync(plusPrefixLeakFile, "+ " + leakLine + "\n");
});

test("(a) clean content in strict mode → exit 0", () => {
  assert.strictEqual(main(["node", "check-leak.js", "--strict", cleanFile]), 0);
});

test("(b) HIGH secret + leak-ok on a newly-added line (strict mode) → exit 1", () => {
  // In strict mode (used by delta-gate), leak-ok markers are ignored — the agent cannot bypass
  // the gate by adding a secret and marking it leak-ok on the same new line.
  assert.strictEqual(main(["node", "check-leak.js", "--strict", leakOkFile]), 1);
});

test("(c) HIGH secret + leak-ok on an unchanged context line (normal mode) → exit 0", () => {
  // In normal mode (full-file scan), leak-ok still exempts the line.
  // This covers unchanged lines that legitimately carry a leak-ok marker.
  assert.strictEqual(main(["node", "check-leak.js", leakOkFile]), 0);
});

test("(d) HIGH secret + leak-ok where content starts with '+' (strict) → exit 1", () => {
  // After check-leak-diff.sh strips the diff marker from "++content", the scanner receives
  // "+content". Before the grep fix ('^+[^+]'), this line was silently dropped and never scanned.
  assert.strictEqual(main(["node", "check-leak.js", "--strict", plusPrefixLeakFile]), 1);
});

test("teardown temp fixtures", () => {
  fs.rmSync(dir, { recursive: true, force: true });
});
