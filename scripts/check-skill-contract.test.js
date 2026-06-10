#!/usr/bin/env node
// check-skill-contract.test.js — CommonJS, run via `node --test`.
// Verifies the generic per-file skill-contract validator accepts a conformant skill and rejects each
// contract violation. Also runs it against a real roster skill as a live conformance check.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkFile, main } = require("./check-skill-contract.js");

function tmp(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-contract-"));
  const f = path.join(dir, "SKILL.md");
  fs.writeFileSync(f, content);
  return { f, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const VALID_META = `---
name: demo
description: A demo skill.
version: 1.2.3
phase: null
friction_log: true
---

## Steps
Do the thing.

## When to Go Back
When blocked.

## What Next
Hand off.

## Friction Log
\`\`\`jsonl
{"task":"demo"}
\`\`\`
`;

test("accepts a conformant pipeline/meta skill", () => {
  const { f, cleanup } = tmp(VALID_META);
  try { assert.deepStrictEqual(checkFile(f), []); } finally { cleanup(); }
});

test("rejects each contract violation", () => {
  const cases = [
    ["no frontmatter", "## Steps\nx\n", /frontmatter/],
    ["no version", "---\nname: x\ndescription: y\n---\n## Steps\nx\n", /version/],
    ["bad version (v-prefix)", "---\nname: x\nversion: v1.0.0\n---\n## Steps\nx\n", /semver/],
    ["no Steps", "---\nname: x\nversion: 1.0.0\n---\nbody\n", /Steps/],
    ["meta without When/What", "---\nname: x\nversion: 1.0.0\nfriction_log: true\n---\n## Steps\nx\n", /When to Go Back/],
    ["friction_log without jsonl", "---\nname: x\nversion: 1.0.0\nfriction_log: true\n---\n## Steps\nx\n## When to Go Back\na\n## What Next\nb\n## Friction Log\nno fence\n", /jsonl/],
  ];
  for (const [label, content, re] of cases) {
    const { f, cleanup } = tmp(content);
    try {
      const errs = checkFile(f).join(" | ");
      assert.match(errs, re, `${label}: expected an error matching ${re}, got: ${errs || "(none)"}`);
    } finally { cleanup(); }
  }
});

test("## Steps only inside a fenced code block is not counted as the real section", () => {
  // A skill whose only `## Steps` mention is inside a code fence should fail — the validator
  // must not treat code-block content as a real heading.
  const content = [
    "---",
    "name: x",
    "version: 1.0.0",
    "---",
    "",
    "Here is an example:",
    "```",
    "## Steps",
    "do the thing",
    "```",
    "",
  ].join("\n");
  const { f, cleanup } = tmp(content);
  try {
    const errs = checkFile(f);
    assert.ok(errs.some((e) => /Steps/.test(e)), `expected missing-Steps error, got: ${errs.join(" | ") || "(none)"}`);
  } finally { cleanup(); }
});

test("version with trailing inline comment is accepted", () => {
  // YAML comments are valid — `version: 1.0.0 # latest` should parse as 1.0.0.
  const content = [
    "---",
    "name: x",
    "version: 1.0.0 # latest release",
    "---",
    "",
    "## Steps",
    "do the thing",
  ].join("\n");
  const { f, cleanup } = tmp(content);
  try {
    const errs = checkFile(f);
    assert.ok(!errs.some((e) => /version/.test(e)), `unexpected version error: ${errs.join(" | ")}`);
  } finally { cleanup(); }
});

test("a real roster skill conforms (live check) + main() exit codes", () => {
  const real = path.resolve(__dirname, "../skills/meta/roster-upgrade.md");
  assert.deepStrictEqual(checkFile(real), [], "roster-upgrade.md should conform to its own contract");
  assert.strictEqual(main(["node", "check-skill-contract.js", real]), 0);
  assert.strictEqual(main(["node", "check-skill-contract.js"]), 3); // usage
});
