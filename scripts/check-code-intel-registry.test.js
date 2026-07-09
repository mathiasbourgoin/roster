#!/usr/bin/env node
// check-code-intel-registry.test.js — CommonJS, run via `node --test`.
// Verifies the registry checker accepts an empty registry and a fully-valid entry, and
// rejects each schema/uniqueness/path violation individually with a line number.
// Offline-safe by construction: default mode has no network code path, nothing is mocked.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkRegistry, main } = require("./check-code-intel-registry.js");

// Fake repo root with registry/ and a real pack dir for relative-repo existence checks.
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-intel-registry-"));
  fs.mkdirSync(path.join(root, "extensions", "fake-pack"), { recursive: true });
  fs.mkdirSync(path.join(root, "registry"));
  return root;
}

function writeRegistry(root, lines) {
  const file = path.join(root, "registry", "code-intel.jsonl");
  fs.writeFileSync(file, lines.length ? lines.join("\n") + "\n" : "");
  return file;
}

// Run the checker on the given raw lines inside a fresh fake root → "line N: msg | ..." string.
function violationsFor(lines) {
  const root = makeRoot();
  try {
    const { violations } = checkRegistry(writeRegistry(root, lines), root);
    return violations.map((v) => `line ${v.line}: ${v.msg}`).join(" | ");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function entry(overrides) {
  return JSON.stringify(Object.assign({
    name: "fake-pack",
    tool: "fake-tool",
    repo: "extensions/fake-pack",
    languages: ["go"],
    provides: ["gate"],
    install: "npm install -g fake-tool",
    tier: "community",
  }, overrides));
}

test("accepts an empty registry (zero bytes)", () => {
  assert.strictEqual(violationsFor([]), "");
});

test("accepts a registry that is only a trailing newline", () => {
  const root = makeRoot();
  try {
    const file = path.join(root, "registry", "code-intel.jsonl");
    fs.writeFileSync(file, "\n");
    assert.deepStrictEqual(checkRegistry(file, root).violations, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("accepts a fully-valid verified entry (notes + existing relative repo)", () => {
  const line = entry({ tier: "verified", notes: "Maintained in-repo; install+contract CI-covered." });
  assert.strictEqual(violationsFor([line]), "");
});

test("accepts a community entry with a URL repo and no notes", () => {
  const line = entry({ repo: "https://github.com/example/fake-pack" });
  assert.strictEqual(violationsFor([line]), "");
});

test("rejects each violation individually, with the line number", () => {
  const cases = [
    ["bad tier", [entry({ tier: "gold" })], /line 1: `tier` must be one of: verified, community/],
    ["unknown language", [entry({ languages: ["go", "cobol"] })], /line 1: `languages` contains "cobol"/],
    ["empty languages", [entry({ languages: [] })], /line 1: `languages` must be a non-empty array/],
    ["missing install", [entry({ install: undefined })], /line 1: `install` must be a non-empty string/],
    ["empty install", [entry({ install: "   " })], /line 1: `install` must be a non-empty string/],
    ["bad name (not kebab-case)", [entry({ name: "Fake_Pack" })], /line 1: `name` must be a kebab-case string/],
    ["duplicate name", [entry({}), entry({ tool: "other-tool" })], /line 2: duplicate `name` "fake-pack" \(first seen on line 1\)/],
    ["duplicate tool", [entry({}), entry({ name: "other-pack" })], /line 2: duplicate `tool` "fake-tool" \(first seen on line 1\)/],
    ["relative repo path that doesn't exist", [entry({ repo: "extensions/no-such-pack" })], /line 1: `repo` relative path does not exist/],
    ["relative repo path with ..", [entry({ repo: "extensions/../secrets" })], /line 1: `repo` relative path must not contain '\.\.'/],
    ["absolute repo path", [entry({ repo: "/etc/passwd" })], /line 1: `repo` relative path must not start with '\/'/],
    ["verified without notes", [entry({ tier: "verified" })], /line 1: `notes` is required and must be non-empty for verified-tier entries/],
    ["verified with empty notes", [entry({ tier: "verified", notes: "" })], /line 1: `notes` is required and must be non-empty/],
    ["URL repo malformed", [entry({ repo: "https://" })], /line 1: `repo` URL is malformed/],
    ["non-object line (array)", ["[1,2,3]"], /line 1: line must be a JSON object/],
    ["non-object line (scalar)", ["42"], /line 1: line must be a JSON object/],
    ["unparseable line", ["{not json"], /line 1: unparseable JSON/],
    ["provides outside enum", [entry({ provides: ["gate", "lint"] })], /line 1: `provides` contains "lint"/],
    ["empty provides", [entry({ provides: [] })], /line 1: `provides` must be a non-empty array/],
    ["unknown field", [entry({ extra: true })], /line 1: unknown field `extra`/],
  ];
  for (const [label, lines, re] of cases) {
    const got = violationsFor(lines);
    assert.match(got, re, `${label}: expected a violation matching ${re}, got: ${got || "(none)"}`);
  }
});

test("violation line numbers survive interleaved blank lines", () => {
  const got = violationsFor([entry({}), "", entry({ name: "other-pack", tool: "other-tool", tier: "gold" })]);
  assert.match(got, /line 3: `tier` must be one of/);
});

test("missing registry file is a file-level violation", () => {
  const root = makeRoot();
  try {
    const { violations } = checkRegistry(path.join(root, "registry", "nope.jsonl"), root);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].line, 0);
    assert.match(violations[0].msg, /registry file not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("main() exit codes: 0 valid, 1 violation, 3 usage", () => {
  const root = makeRoot();
  try {
    const valid = writeRegistry(root, [entry({})]);
    assert.strictEqual(main(["node", "check", valid, "--root", root]), 0);
    const bad = writeRegistry(root, [entry({ tier: "gold" })]);
    assert.strictEqual(main(["node", "check", bad, "--root", root]), 1);
    assert.strictEqual(main(["node", "check", "--bogus-flag"]), 3);
    assert.strictEqual(main(["node", "check", valid, "--root"]), 3); // --root without value
    assert.strictEqual(main(["node", "check", "a.jsonl", "b.jsonl"]), 3); // extra positional
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the shipped registry is valid (live check, offline)", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const shipped = path.join(repoRoot, "registry", "code-intel.jsonl");
  const { violations } = checkRegistry(shipped, repoRoot);
  assert.deepStrictEqual(violations, [], "shipped registry/code-intel.jsonl must be valid");
});
