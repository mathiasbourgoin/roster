#!/usr/bin/env node
// code-intel-resolve.test.js — CommonJS, run via `node --test`.
// Exercises the code-intel pack resolver (specs/code-intel-packs.md FR-020–044) against
// temp-dir fixture projects with stub `bash -c 'exit N'`-style pack entries.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.resolve(__dirname, "code-intel-resolve.js");
const REPO_ROOT = path.resolve(__dirname, "..");

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-intel-resolve-"));
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Hand-write the documented ack-file format (deliberately NOT via the ack
// subcommand, so the format contract is cross-checked from both sides).
function ackSkillDir(root, skillDir) {
  const base = path.basename(skillDir);
  const digest = sha256Hex(fs.readFileSync(path.join(skillDir, "SKILL.md")));
  const ackPath = path.join(root, ".harness", "code-intel-ack.json");
  let acks = [];
  try {
    acks = JSON.parse(fs.readFileSync(ackPath, "utf8")).acks;
  } catch {
    /* first ack in this fixture project */
  }
  acks = acks.filter((a) => a.skill !== base);
  acks.push({ skill: base, sha256: digest });
  fs.mkdirSync(path.dirname(ackPath), { recursive: true });
  fs.writeFileSync(ackPath, JSON.stringify({ acks }, null, 2) + "\n");
}

// Write <root>/<runtime>/skills/<name>/SKILL.md with the given frontmatter lines.
function writeSkill(root, runtime, name, fmLines) {
  const dir = path.join(root, runtime, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), ["---", ...fmLines, "---", "", "# body", ""].join("\n"));
  return dir;
}

// Fixture packs are acked by default: these tests exercise gate/audit execution
// semantics, and execution now requires acknowledgment. Pass ack: false for the
// trust-model tests below.
function gatePack(root, name, entry, provides = "gate", { ack = true } = {}) {
  const dir = writeSkill(root, ".agents", name, [
    `name: ${name}`,
    "description: stub pack",
    "version: 1.0.0",
    "capability: code-intel",
    `provides: ${provides}`,
    `entry: ${entry}`,
    "requires_tools: []",
  ]);
  if (ack) ackSkillDir(root, dir);
  return dir;
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

test("gate: malformed block with no gate pack installed → skip", () => {
  const root = makeProject();
  writeProperties(root, "```code-intel\nnot json at all\n```\n");
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /SKIP: no installed gate packs/);
  assert.match(r.stdout, /RESULT: skip/);
  assert.doesNotMatch(r.stderr, /MALFORMED/);
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

test("gate: exit 124 (coreutils timeout expiry) maps to degraded, exit 0", () => {
  const root = makeProject();
  gatePack(root, "sig-gate", "bash -c 'exit 124'");
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /GATE sig-gate: exit 3/);
  assert.match(r.stdout, /DEGRADED: sig-gate:/);
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
// execution trust — install-record hash or explicit ack (decision 2026-07-09)
// ---------------------------------------------------------------------------

// Write an extensions.json install record for a skill dir, as the extension
// installer would (target project-relative, sha256 lowercase hex of file bytes).
function recordInstall(root, skillDir, { sha256 } = {}) {
  const skillFile = path.join(skillDir, "SKILL.md");
  const target = path.relative(root, skillFile).replace(/\\/g, "/");
  fs.mkdirSync(path.join(root, ".harness"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".harness", "extensions.json"),
    JSON.stringify({
      schema_version: "1.0",
      extensions: [
        {
          name: "fixture-ext",
          runtime_roots: [".agents/skills"],
          installed_files: [
            { source: "skills/fixture/SKILL.md", target, sha256: sha256 || sha256Hex(fs.readFileSync(skillFile)) },
          ],
        },
      ],
    }),
  );
}

test("list: trusted flag — false for bare checkout, true after ack", () => {
  const root = makeProject();
  gatePack(root, "raw-gate", "bash -c 'exit 0'", "gate", { ack: false });
  assert.strictEqual(runList(root)[0].trusted, false);
  const ack = run(["ack", "raw-gate"], root);
  assert.strictEqual(ack.status, 0, ack.stderr);
  assert.strictEqual(runList(root)[0].trusted, true);
});

test("gate: unacknowledged pack is not executed — degraded with ack hint, exit 0", () => {
  const root = makeProject();
  gatePack(root, "raw-gate", "bash -c 'echo ENTRY-RAN; exit 1'", "gate", { ack: false });
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(
    r.stdout,
    /GATE raw-gate: unacknowledged — not executed \(run: node scripts\/code-intel-resolve\.js ack raw-gate\)/,
  );
  assert.doesNotMatch(r.stdout, /ENTRY-RAN/);
  assert.match(r.stdout, /DEGRADED: raw-gate: unacknowledged — not executed/);
  assert.match(r.stdout, /RESULT: degraded/);
});

test("gate: extension-installed pack with matching install hash executes without ack", () => {
  const root = makeProject();
  const dir = gatePack(root, "ext-gate", "bash -c 'echo ENTRY-RAN; exit 0'", "gate", { ack: false });
  recordInstall(root, dir);
  assert.strictEqual(runList(root)[0].trusted, true);
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /GATE ext-gate: exit 0/);
  assert.match(r.stdout, /ENTRY-RAN/);
  assert.match(r.stdout, /RESULT: pass/);
});

test("gate: install-record hash drift → unacknowledged, degraded", () => {
  const root = makeProject();
  const dir = gatePack(root, "ext-gate", "bash -c 'exit 0'", "gate", { ack: false });
  recordInstall(root, dir, { sha256: sha256Hex(Buffer.from("stale bytes")) });
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /GATE ext-gate: unacknowledged — not executed/);
  assert.match(r.stdout, /RESULT: degraded/);
});

test("ack: prints the consent surface, records {skill, sha256}, unlocks execution", () => {
  const root = makeProject();
  const dir = gatePack(root, "raw-gate", "bash -c 'exit 0'", "gate", { ack: false });
  const ack = run(["ack", "raw-gate"], root);
  assert.strictEqual(ack.status, 0, ack.stderr);
  assert.ok(ack.stdout.includes(`skill dir: ${dir}`));
  assert.match(ack.stdout, /entry: bash -c 'exit 0'/);
  assert.match(ack.stdout, /requires_tools: \[\]/);
  assert.match(ack.stdout, /ACKED raw-gate/);
  const recorded = JSON.parse(fs.readFileSync(path.join(root, ".harness", "code-intel-ack.json"), "utf8"));
  assert.deepStrictEqual(recorded, {
    acks: [{ skill: "raw-gate", sha256: sha256Hex(fs.readFileSync(path.join(dir, "SKILL.md"))) }],
  });
  writeProperties(root, VALID_BLOCK);
  const r = run(["gate"], root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /GATE raw-gate: exit 0/);
  assert.match(r.stdout, /RESULT: pass/);
});

test("ack: content change after ack → blocked again until re-acked", () => {
  const root = makeProject();
  const dir = gatePack(root, "raw-gate", "bash -c 'exit 0'", "gate", { ack: false });
  assert.strictEqual(run(["ack", "raw-gate"], root).status, 0);
  writeProperties(root, VALID_BLOCK);
  assert.match(run(["gate"], root).stdout, /RESULT: pass/);
  fs.appendFileSync(path.join(dir, "SKILL.md"), "\nedited after ack\n");
  const blocked = run(["gate"], root);
  assert.strictEqual(blocked.status, 0);
  assert.match(blocked.stdout, /GATE raw-gate: unacknowledged — not executed/);
  assert.match(blocked.stdout, /RESULT: degraded/);
  assert.strictEqual(run(["ack", "raw-gate"], root).status, 0);
  assert.match(run(["gate"], root).stdout, /RESULT: pass/);
});

test("ack: no matching pack → exit 64 with message", () => {
  const root = makeProject();
  const r = run(["ack", "no-such-pack"], root);
  assert.strictEqual(r.status, 64);
  assert.match(r.stderr, /no installed code-intel pack matches "no-such-pack"/);
  const missingName = spawnSync(process.execPath, [SCRIPT, "ack"], { encoding: "utf8" });
  assert.strictEqual(missingName.status, 64);
});

test("gate: aggregation — unacknowledged is degraded-only, verdict unaffected", () => {
  const passRoot = makeProject();
  gatePack(passRoot, "alpha-gate", "bash -c 'exit 0'");
  gatePack(passRoot, "raw-gate", "bash -c 'exit 1'", "gate", { ack: false });
  writeProperties(passRoot, VALID_BLOCK);
  const pass = run(["gate"], passRoot);
  assert.strictEqual(pass.status, 0, pass.stderr); // untrusted exit-1 pack cannot fail the gate
  assert.match(pass.stdout, /GATE alpha-gate: exit 0/);
  assert.match(pass.stdout, /GATE raw-gate: unacknowledged — not executed/);
  assert.match(pass.stdout, /RESULT: degraded/);

  const failRoot = makeProject();
  gatePack(failRoot, "alpha-gate", "bash -c 'exit 1'");
  gatePack(failRoot, "raw-gate", "bash -c 'exit 0'", "gate", { ack: false });
  writeProperties(failRoot, VALID_BLOCK);
  const fail = run(["gate"], failRoot);
  assert.strictEqual(fail.status, 1); // a real violation still fails
  assert.match(fail.stdout, /RESULT: fail/);
});

test("audit: unacknowledged audit-section pack → DEGRADED, not executed", () => {
  const root = makeProject();
  gatePack(root, "raw-audit", "bash -c 'echo ENTRY-RAN'", "audit-section", { ack: false });
  const r = run(["audit"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /DEGRADED raw-audit: unacknowledged — not executed \(run: node scripts\/code-intel-resolve\.js ack raw-audit\)/);
  assert.doesNotMatch(r.stdout, /ENTRY-RAN|SECTION/);
});

test("doctor: WARN unacknowledged for untrusted packs only", () => {
  const root = makeProject();
  gatePack(root, "acked-gate", "bash -c 'exit 0'");
  gatePack(root, "raw-gate", "bash -c 'exit 0'", "gate", { ack: false });
  const r = run(["doctor"], root);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /WARN unacknowledged: raw-gate \(entry will not execute until acked\)/);
  assert.doesNotMatch(r.stdout, /WARN unacknowledged: acked-gate/);
});

// ---------------------------------------------------------------------------
// frontmatter parity — resolver CJS mirror vs scripts/lib/catalog/frontmatter.ts
// ---------------------------------------------------------------------------

test("frontmatter parity: mirror matches the shared parser except the documented lone-quote case", () => {
  // Compiled by `npm run build:ts` (run it first if this require fails).
  const shared = require(path.join(REPO_ROOT, "dist", "scripts", "lib", "catalog", "frontmatter.js"));
  const mirror = require(SCRIPT);
  const fixture = [
    "---",
    "name: parity-pack",
    'description: "double quoted"',
    "version: '1.2.3'",
    "capability: code-intel",
    "provides: gate",
    "entry: bash -c 'exit 3'",
    "requires_tools: [alpha, \"beta\", 'gamma']",
    "tunables:",
    "  nested_key: nested_value",
    "plain: unquoted value",
    "---",
    "",
    "# body",
    "",
  ].join("\n");
  const fromShared = shared.parseFrontmatter(fixture);
  const fromMirror = mirror.parseFrontmatter(fixture);
  // Documented divergence (resolver comment on stripMatchedQuotes): the shared
  // parseScalar strips a LONE trailing/leading quote, mangling values that merely
  // end in a quote; the mirror strips only matched pairs.
  assert.strictEqual(fromShared.entry, "bash -c 'exit 3");
  assert.strictEqual(fromMirror.entry, "bash -c 'exit 3'");
  // Everything else must be byte-identical between the two parsers.
  const withoutEntry = (fm) => {
    const clone = Object.assign({}, fm);
    delete clone.entry;
    return clone;
  };
  assert.deepStrictEqual(withoutEntry(fromMirror), withoutEntry(fromShared));
  // Pin the shared behaviors the seam relies on.
  assert.strictEqual(fromMirror.description, "double quoted");
  assert.strictEqual(fromMirror.version, "1.2.3");
  assert.deepStrictEqual(fromMirror.requires_tools, ["alpha", "beta", "gamma"]);
  assert.strictEqual(fromMirror.tunables, ""); // flat parser: indented YAML is skipped
  assert.ok(!("nested_key" in fromMirror));
  assert.strictEqual(fromMirror.plain, "unquoted value");
});

// ---------------------------------------------------------------------------
// contract anchoring — consumer skill docs must stay in sync with the resolver
// ---------------------------------------------------------------------------

const CONSUMER_SKILLS = [
  "skills/pipeline/roster-qa.md",
  "skills/pipeline/roster-doctor.md",
  "skills/pipeline/roster-audit.md",
  "skills/kb/code-quality-auditor.md",
];

test("contract anchoring: every consumer skill names both runtime glob roots", () => {
  for (const rel of CONSUMER_SKILLS) {
    const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    for (const glob of [".agents/skills/*/SKILL.md", ".opencode/skills/*/SKILL.md"]) {
      assert.ok(
        text.includes(glob),
        `${rel} must contain the literal glob ${glob} — it drifted from the resolver's seam (FR-021)`,
      );
    }
  }
});

test("contract anchoring: roster-doctor mirrors PROVIDES_VALUES and the degraded warning", () => {
  const { PROVIDES_VALUES } = require(SCRIPT);
  const text = fs.readFileSync(path.join(REPO_ROOT, "skills/pipeline/roster-doctor.md"), "utf8");
  const providesAlternation = `(${PROVIDES_VALUES.join("|")})`;
  assert.ok(
    text.includes(providesAlternation),
    `roster-doctor.md must contain the provides alternation ${providesAlternation} derived from the resolver's PROVIDES_VALUES`,
  );
  assert.ok(
    text.includes("WARN pack degraded:"),
    "roster-doctor.md must contain the literal warning prefix 'WARN pack degraded:' (FR-044)",
  );
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
