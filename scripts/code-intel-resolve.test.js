#!/usr/bin/env node
// code-intel-resolve.test.js — CommonJS, run via `node --test`.
// Exercises the code-intel pack resolver (specs/code-intel-packs.md FR-020–044) against
// temp-dir fixture projects with stub `bash -c 'exit N'`-style pack entries.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.resolve(__dirname, "code-intel-resolve.js");

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-intel-resolve-"));
}

// Write <root>/<runtime>/skills/<name>/SKILL.md with the given frontmatter lines.
function writeSkill(root, runtime, name, fmLines) {
  const dir = path.join(root, runtime, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), ["---", ...fmLines, "---", "", "# body", ""].join("\n"));
  return dir;
}

function gatePack(root, name, entry, provides = "gate") {
  return writeSkill(root, ".agents", name, [
    `name: ${name}`,
    "description: stub pack",
    "version: 1.0.0",
    "capability: code-intel",
    `provides: ${provides}`,
    `entry: ${entry}`,
    "requires_tools: []",
  ]);
}

function writeProperties(root, content) {
  fs.mkdirSync(path.join(root, "kb"), { recursive: true });
  fs.writeFileSync(path.join(root, "kb", "properties.md"), content);
}

const VALID_BLOCK = [
  "# Properties",
  "",
  "```code-intel",
  '{"id":"INV-1","type":"layering","description":"no cycles","check":{"kind":"acyclic"}}',
  "```",
  "",
].join("\n");

function run(args, root) {
  return spawnSync(process.execPath, [SCRIPT, ...args, "--root", root], { encoding: "utf8" });
}

function runList(root) {
  const r = run(["list"], root);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

test("list: selects capability code-intel skills, ignores others", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 0'");
  writeSkill(root, ".agents", "plain-skill", ["name: plain-skill", "version: 1.0.0"]);
  const packs = runList(root);
  assert.strictEqual(packs.length, 1);
  assert.strictEqual(packs[0].name, "alpha-gate");
  assert.strictEqual(packs[0].provides, "gate");
  assert.strictEqual(packs[0].valid, true);
  assert.deepStrictEqual(packs[0].violations, []);
});

test("list: dedupes by dir basename, .agents wins, identical copies → no drift", () => {
  const root = makeProject();
  const fm = ["name: dup", "capability: code-intel", "provides: gate", "entry: bash -c 'exit 0'"];
  writeSkill(root, ".agents", "dup", fm);
  writeSkill(root, ".opencode", "dup", fm);
  const packs = runList(root);
  assert.strictEqual(packs.length, 1);
  assert.ok(packs[0].file.includes(".agents"), "the .agents copy must win");
  assert.strictEqual(packs[0].drift, false);
});

test("list: differing runtime copies → drift true, .agents contract used", () => {
  const root = makeProject();
  writeSkill(root, ".agents", "dup", ["name: dup", "capability: code-intel", "provides: gate", "entry: bash agents.sh"]);
  writeSkill(root, ".opencode", "dup", ["name: dup", "capability: code-intel", "provides: gate", "entry: bash opencode.sh"]);
  const packs = runList(root);
  assert.strictEqual(packs.length, 1);
  assert.strictEqual(packs[0].drift, true);
  assert.strictEqual(packs[0].entry, "bash agents.sh");
});

test("list: contract violations — missing entry/provides, bad provides value", () => {
  const root = makeProject();
  writeSkill(root, ".agents", "no-entry", ["name: no-entry", "capability: code-intel", "provides: gate"]);
  writeSkill(root, ".agents", "bad-provides", ["name: bad-provides", "capability: code-intel", "provides: gold", "entry: bash x.sh"]);
  const packs = runList(root);
  const noEntry = packs.find((p) => p.name === "no-entry");
  const badProvides = packs.find((p) => p.name === "bad-provides");
  assert.strictEqual(noEntry.valid, false);
  assert.ok(noEntry.violations.some((v) => /entry/.test(v)));
  assert.strictEqual(badProvides.valid, false);
  assert.ok(badProvides.violations.some((v) => /provides/.test(v)));
});

test("list: picks up runtime_roots from .harness/extensions.json", () => {
  const root = makeProject();
  writeSkill(root, "custom", "extra-pack", ["name: extra-pack", "capability: code-intel", "provides: init", "entry: bash init.sh"]);
  fs.mkdirSync(path.join(root, ".harness"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".harness", "extensions.json"),
    JSON.stringify({ schema_version: "1.0", extensions: [{ name: "x", runtime_roots: ["custom/skills"] }] }),
  );
  const packs = runList(root);
  assert.strictEqual(packs.length, 1);
  assert.strictEqual(packs[0].name, "extra-pack");
});

test("list: tolerates absent and malformed extensions.json", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 0'");
  assert.strictEqual(runList(root).length, 1); // absent
  fs.mkdirSync(path.join(root, ".harness"), { recursive: true });
  fs.writeFileSync(path.join(root, ".harness", "extensions.json"), "{not json");
  assert.strictEqual(runList(root).length, 1); // malformed
});

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

test("gate: absent properties file → skip, exit 0", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 0'");
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /SKIP: no code-intel block/);
  assert.match(r.stdout, /RESULT: skip/);
});

test("gate: prose-only properties → skip, exit 0", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 0'");
  writeProperties(root, "# Properties\n\nJust prose, no fenced block.\n");
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /RESULT: skip/);
});

test("gate: malformed JSONL line → exit 2 with explicit message", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 0'");
  writeProperties(root, "```code-intel\nnot json at all\n```\n");
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /MALFORMED/);
  assert.match(r.stdout, /RESULT: malformed/);
});

test("gate: valid JSON but wrong shape (missing check) → exit 2", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 0'");
  writeProperties(root, '```code-intel\n{"id":"a","type":"t","description":"d"}\n```\n');
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /MALFORMED/);
});

test("gate: zero invariant lines → gates still run, pass with note", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 0'");
  writeProperties(root, "```code-intel\n```\n");
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /0 invariants/);
  assert.match(r.stdout, /GATE alpha-gate: exit 0/);
  assert.match(r.stdout, /RESULT: pass/);
});

test("gate: pack exit 0 → pass with per-pack attribution and relayed output", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'echo checked 3 invariants; exit 0'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /GATE alpha-gate: exit 0/);
  assert.match(r.stdout, /checked 3 invariants/);
  assert.match(r.stdout, /RESULT: pass/);
});

test("gate: pack exit 1 → overall exit 1", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'echo violation INV-1 >&2; exit 1'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /GATE alpha-gate: exit 1/);
  assert.match(r.stderr, /violation INV-1/);
});

test("gate: pack exit 2 → overall exit 2 with malformed message", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 2'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /MALFORMED/);
});

test("gate: pack exit 3 → exit 0 with DEGRADED lines", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 3'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /DEGRADED: alpha-gate:/);
  assert.match(r.stdout, /RESULT: degraded/);
});

test("gate: aggregation — exit 1 beats exit 3; both packs attributed", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 3'");
  gatePack(root, "beta-gate", "bash -c 'exit 1'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /GATE alpha-gate: exit 3/);
  assert.match(r.stdout, /GATE beta-gate: exit 1/);
  assert.match(r.stdout, /RESULT: fail/);
});

test("gate: aggregation — exit 2 beats exit 3 when no exit 1", () => {
  const root = makeProject();
  gatePack(root, "alpha-gate", "bash -c 'exit 2'");
  gatePack(root, "beta-gate", "bash -c 'exit 3'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 2);
});

test("gate: timeout → treated as exit 3 / degraded", () => {
  const root = makeProject();
  gatePack(root, "slow-gate", "bash -c 'sleep 10'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate", "--timeout", "1"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /GATE slow-gate: exit 3/);
  assert.match(r.stdout, /DEGRADED: slow-gate: timeout after 1s/);
  assert.match(r.stdout, /RESULT: degraded/);
});

test("gate: entry receives the block path and SKILL_DIR, runs from project root", () => {
  const root = makeProject();
  const dir = gatePack(root, "arg-gate", "bash gate.sh");
  fs.writeFileSync(
    path.join(dir, "gate.sh"),
    '#!/bin/bash\necho "block=$1"\necho "skdir=$SKILL_DIR"\necho "cwd=$PWD"\ngrep -c INV-1 "$1"\n',
  );
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /block=\S+invariants\.jsonl/);
  assert.ok(r.stdout.includes(`skdir=${dir}`));
  assert.ok(r.stdout.includes(`cwd=${fs.realpathSync(root)}`) || r.stdout.includes(`cwd=${root}`));
});

test("gate: invalid packs (contract violations) are not executed", () => {
  const root = makeProject();
  writeSkill(root, ".agents", "broken", ["name: broken", "capability: code-intel", "provides: gate"]); // no entry
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /RESULT: skip/); // no runnable gate packs
});

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

test("audit: fragment with freshness header → SECTION + fragment, exit 0", () => {
  const root = makeProject();
  gatePack(root, "alpha-audit", "bash -c 'echo \"Index freshness: 2026-07-09\"; echo \"| row | ok |\"'", "audit-section");
  const r = run(["audit"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /SECTION alpha-audit/);
  assert.match(r.stdout, /Index freshness: 2026-07-09/);
  assert.match(r.stdout, /\| row \| ok \|/);
});

test("audit: html-comment freshness header form is accepted", () => {
  const root = makeProject();
  gatePack(root, "alpha-audit", "bash -c 'echo \"<!-- index-freshness: 2026-07-09 -->\"'", "audit-section");
  const r = run(["audit"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /SECTION alpha-audit/);
});

test("audit: missing freshness header → degraded, exit 0", () => {
  const root = makeProject();
  gatePack(root, "alpha-audit", "bash -c 'echo just a fragment'", "audit-section");
  const r = run(["audit"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /DEGRADED alpha-audit: fragment is missing/);
  assert.doesNotMatch(r.stdout, /SECTION/);
});

test("audit: non-zero provider exit → degraded, exit 0", () => {
  const root = makeProject();
  gatePack(root, "alpha-audit", "bash -c 'exit 3'", "audit-section");
  const r = run(["audit"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /DEGRADED alpha-audit: entry exited 3/);
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

test("doctor: lists packs, warns on contract/drift/tool-missing, exits 0", () => {
  const root = makeProject();
  writeSkill(root, ".agents", "ok-pack", [
    "name: ok-pack",
    "capability: code-intel",
    "provides: gate",
    "entry: bash gate.sh",
    "requires_tools: [definitely-not-a-real-tool-xyz]",
  ]);
  writeSkill(root, ".agents", "broken-pack", ["name: broken-pack", "capability: code-intel"]);
  writeSkill(root, ".agents", "drifty", ["name: drifty", "capability: code-intel", "provides: init", "entry: bash a.sh"]);
  writeSkill(root, ".opencode", "drifty", ["name: drifty", "capability: code-intel", "provides: init", "entry: bash b.sh"]);
  const r = run(["doctor"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /code-intel packs \(3\):/);
  assert.match(r.stdout, /WARN contract: broken-pack: missing provides/);
  assert.match(r.stdout, /WARN contract: broken-pack: missing entry/);
  assert.match(r.stdout, /WARN drift: drifty/);
  assert.match(r.stdout, /WARN pack degraded: tool-missing:definitely-not-a-real-tool-xyz \(ok-pack\)/);
});

test("doctor: no packs installed → factual line, exit 0", () => {
  const root = makeProject();
  const r = run(["doctor"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /code-intel packs: none installed/);
});

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

test("usage errors exit 64", () => {
  const root = makeProject();
  assert.strictEqual(run(["frobnicate"], root).status, 64);
  const noValue = spawnSync(process.execPath, [SCRIPT, "list", "--root"], { encoding: "utf8" });
  assert.strictEqual(noValue.status, 64);
  const noCmd = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.strictEqual(noCmd.status, 64);
});
