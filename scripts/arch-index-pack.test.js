#!/usr/bin/env node
// arch-index-pack.test.js — CommonJS, run via `node --test`.
// Contract tests for the arch-index reference pack (specs/code-intel-packs.md,
// FR-062–071, AC-9/10/11): stub-binary gate exit contract (0/1/2/3), resolver
// integration, extension-CLI install/uninstall round-trip, audit fragment shape.
// No real arch-index binary is ever required (FR-068).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const PACK_ROOT = path.join(REPO_ROOT, "extensions", "arch-index");
const GATE_SH = path.join(PACK_ROOT, "skills", "arch-index-gate", "gate.sh");
const AUDIT_SH = path.join(PACK_ROOT, "skills", "arch-index-audit", "audit.sh");
const RESOLVER = path.join(REPO_ROOT, "scripts", "code-intel-resolve.js");
const EXTENSION_CLI = path.join(REPO_ROOT, "dist", "scripts", "roster-extension.js");

const SKILL_NAMES = ["arch-index-audit", "arch-index-gate", "arch-index-init"];
const SKILL_SCRIPTS = { "arch-index-audit": "audit.sh", "arch-index-gate": "gate.sh", "arch-index-init": "init.sh" };

function makeDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Stub `arch-index`: `query --json <sql>` prints $ARCH_INDEX_ROWS (default []).
function makeStubBin({ archIndex = true, sqlite3 = false, node = false } = {}) {
  const dir = makeDir("arch-index-stubbin-");
  if (archIndex) {
    const stub = [
      "#!/bin/sh",
      'case "$1" in',
      '  query) printf \'%s\' "${ARCH_INDEX_ROWS:-[]}" ;;',
      "  init|refresh) mkdir -p .arch-index && : > .arch-index/index.db ;;",
      "  *) exit 64 ;;",
      "esac",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "arch-index"), stub, { mode: 0o755 });
  }
  if (sqlite3) {
    fs.writeFileSync(path.join(dir, "sqlite3"), '#!/bin/sh\nprintf \'%s\\n\' "${SQLITE_ROWS:-}"\n', {
      mode: 0o755,
    });
  }
  if (node) fs.symlinkSync(process.execPath, path.join(dir, "node"));
  return dir;
}

function makeProjectWithDb() {
  const root = makeDir("arch-index-proj-");
  fs.mkdirSync(path.join(root, ".arch-index"), { recursive: true });
  fs.writeFileSync(path.join(root, ".arch-index", "index.db"), "");
  return root;
}

function writeBlock(root, lines) {
  const block = path.join(root, "invariants.jsonl");
  fs.writeFileSync(block, lines.join("\n") + "\n");
  return block;
}

const REACH_NONE = '{"id":"INV-1","type":"reachability","description":"no exit calls","check":{"query":"SELECT caller FROM calls WHERE callee = \'exit\'","expect":"none"}}';

function runGate(root, block, { stubDir, rows, fullPath = true, extraEnv = {} } = {}) {
  const pathParts = [];
  if (stubDir) pathParts.push(stubDir);
  if (fullPath) pathParts.push(process.env.PATH || "");
  const env = Object.assign({}, fullPath ? process.env : {}, extraEnv, { PATH: pathParts.join(":") });
  if (rows !== undefined) env.ARCH_INDEX_ROWS = rows;
  return spawnSync("/bin/bash", [GATE_SH, block], { cwd: root, env, encoding: "utf8" });
}

// ---------------------------------------------------------------------------
// 1. gate.sh contract — direct invocation with a stub arch-index (FR-068)
// ---------------------------------------------------------------------------

test("gate: exit 0 with PASS line when the query returns no rows", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, [REACH_NONE]);
  const r = runGate(root, block, { stubDir: makeStubBin(), rows: "[]" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS INV-1/);
});

test("gate: exit 1 with invariant id + offending rows on violation", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, [REACH_NONE]);
  const rows = '[{"caller":"main.run"}]';
  const r = runGate(root, block, { stubDir: makeStubBin(), rows });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /VIOLATION INV-1/);
  assert.match(r.stdout, /main\.run/);
});

test("gate: max N semantics — count>N violates, count<=N passes", () => {
  const root = makeProjectWithDb();
  const twoRows = '[{"caller":"a"},{"caller":"b"}]';
  const maxLine = (max) =>
    `{"id":"INV-MAX","type":"reachability","description":"bounded","check":{"query":"SELECT caller FROM calls","max":${max}}}`;
  const violate = runGate(root, writeBlock(root, [maxLine(1)]), { stubDir: makeStubBin(), rows: twoRows });
  assert.strictEqual(violate.status, 1);
  assert.match(violate.stdout, /VIOLATION INV-MAX/);
  const pass = runGate(root, writeBlock(root, [maxLine(2)]), { stubDir: makeStubBin(), rows: twoRows });
  assert.strictEqual(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /PASS INV-MAX/);
});

test("gate: exit 0 and explicit note on zero invariants", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, [""]);
  const r = runGate(root, block, { stubDir: makeStubBin() });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 invariants/);
});

test("gate: exit 2 naming the unsupported check type", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, [
    '{"id":"INV-2","type":"layering","description":"acyclic","check":{"query":"SELECT 1","expect":"none"}}',
  ]);
  const r = runGate(root, block, { stubDir: makeStubBin() });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /unsupported check type "layering"/);
});

test("gate: exit 2 on a malformed JSON line (defense in depth)", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, ["{not json"]);
  const r = runGate(root, block, { stubDir: makeStubBin() });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /malformed JSON/);
});

test("gate: exit 2 on an invalid check shape (no expect/max)", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, [
    '{"id":"INV-3","type":"reachability","description":"x","check":{"query":"SELECT 1"}}',
  ]);
  const r = runGate(root, block, { stubDir: makeStubBin() });
  assert.strictEqual(r.status, 2);
});

test("gate: exit 3 when both arch-index and sqlite3 are missing", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, [REACH_NONE]);
  // Minimal PATH: only a node symlink — no arch-index, no sqlite3.
  const nodeOnly = makeStubBin({ archIndex: false, node: true });
  const r = runGate(root, block, { stubDir: nodeOnly, fullPath: false });
  assert.strictEqual(r.status, 3, r.stderr);
  assert.match(r.stderr, /tool-missing/);
});

test("gate: exit 3 when the index DB is absent", () => {
  const root = makeDir("arch-index-nodb-");
  const block = writeBlock(root, [REACH_NONE]);
  const r = runGate(root, block, { stubDir: makeStubBin() });
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /index-missing/);
});

test("gate: exit 3 cmt-artifacts-missing for an OCaml project without built .cmt", () => {
  const root = makeProjectWithDb();
  fs.writeFileSync(path.join(root, "dune-project"), "(lang dune 3.0)\n");
  const block = writeBlock(root, [REACH_NONE]);
  const r = runGate(root, block, { stubDir: makeStubBin() });
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /cmt-artifacts-missing \(run dune build\)/);
});

test("gate: OCaml project WITH built .cmt artifacts proceeds normally", () => {
  const root = makeProjectWithDb();
  fs.writeFileSync(path.join(root, "dune-project"), "(lang dune 3.0)\n");
  fs.mkdirSync(path.join(root, "_build", "default"), { recursive: true });
  fs.writeFileSync(path.join(root, "_build", "default", "main.cmt"), "");
  const block = writeBlock(root, [REACH_NONE]);
  const r = runGate(root, block, { stubDir: makeStubBin(), rows: "[]" });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("gate: sqlite3 fallback path when arch-index is absent", () => {
  const root = makeProjectWithDb();
  const block = writeBlock(root, [REACH_NONE]);
  const stub = makeStubBin({ archIndex: false, sqlite3: true, node: true });
  const pass = runGate(root, block, { stubDir: stub, fullPath: false, extraEnv: { SQLITE_ROWS: "" } });
  assert.strictEqual(pass.status, 0, pass.stderr);
  const fail = runGate(root, block, { stubDir: stub, fullPath: false, extraEnv: { SQLITE_ROWS: "main.run|exit" } });
  assert.strictEqual(fail.status, 1, fail.stderr);
  assert.match(fail.stdout, /VIOLATION INV-1/);
});

// ---------------------------------------------------------------------------
// 1b. gate through the resolver (pack hand-projected into .agents/skills/)
// ---------------------------------------------------------------------------

function projectPackByHand(root) {
  for (const name of SKILL_NAMES) {
    const src = path.join(PACK_ROOT, "skills", name);
    const dst = path.join(root, ".agents", "skills", name);
    fs.mkdirSync(dst, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, file), path.join(dst, file));
    }
  }
}

// Hand-projected packs have no install record, so executing their entries needs
// the one-time explicit consent act (execution trust model, decision 2026-07-09).
function ackPack(root, name) {
  const r = spawnSync(process.execPath, [RESOLVER, "ack", name, "--root", root], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
}

function writeProperties(root) {
  fs.mkdirSync(path.join(root, "kb"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "kb", "properties.md"),
    ["# Properties", "", "```code-intel", REACH_NONE, "```", ""].join("\n"),
  );
}

function runResolverGate(root, rows) {
  const env = Object.assign({}, process.env, {
    PATH: `${makeStubBin()}:${process.env.PATH}`,
    ARCH_INDEX_ROWS: rows,
  });
  return spawnSync(process.execPath, [RESOLVER, "gate", "--root", root], { encoding: "utf8", env });
}

test("resolver gate: pass end-to-end via projected pack", () => {
  const root = makeProjectWithDb();
  projectPackByHand(root);
  ackPack(root, "arch-index-gate");
  writeProperties(root);
  const r = runResolverGate(root, "[]");
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /GATE arch-index-gate: exit 0/);
  assert.match(r.stdout, /RESULT: pass/);
});

test("resolver gate: violation maps to resolver exit 1 (NO-GO)", () => {
  const root = makeProjectWithDb();
  projectPackByHand(root);
  ackPack(root, "arch-index-gate");
  writeProperties(root);
  const r = runResolverGate(root, '[{"caller":"main.run"}]');
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /VIOLATION INV-1/);
  assert.match(r.stdout, /RESULT: fail/);
});

// ---------------------------------------------------------------------------
// 2. install / uninstall round-trip via the extension CLI (FR-067, FR-070)
// ---------------------------------------------------------------------------

function makeHarnessProject() {
  const root = makeDir("arch-index-install-");
  fs.mkdirSync(path.join(root, ".harness"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".harness", "harness.json"),
    JSON.stringify({
      runtimes: [
        { name: "codex", enabled: true, entrypoint: ".agents/skills" },
        { name: "opencode", enabled: true, entrypoint: ".opencode" },
      ],
    }),
  );
  return root;
}

function runCli(args) {
  return spawnSync(process.execPath, [EXTENSION_CLI, ...args], { encoding: "utf8" });
}

test("install round-trip: three skills + sibling scripts projected, recorded, removable", () => {
  const root = makeHarnessProject();

  const installed = runCli(["install", PACK_ROOT, "--target", root]);
  assert.strictEqual(installed.status, 0, installed.stderr + installed.stdout);

  for (const name of SKILL_NAMES) {
    const dir = path.join(root, ".agents", "skills", name);
    assert.ok(fs.existsSync(path.join(dir, "SKILL.md")), `${name}/SKILL.md projected`);
    assert.ok(fs.existsSync(path.join(dir, SKILL_SCRIPTS[name])), `${name}/${SKILL_SCRIPTS[name]} projected`);
  }
  const registry = JSON.parse(fs.readFileSync(path.join(root, ".harness", "extensions.json"), "utf8"));
  assert.strictEqual(registry.extensions.length, 1);
  assert.strictEqual(registry.extensions[0].name, "arch-index");
  assert.strictEqual(registry.extensions[0].version, "1.0.0");

  // Resolver sees all three pack components with valid seam contracts.
  const list = spawnSync(process.execPath, [RESOLVER, "list", "--root", root], { encoding: "utf8" });
  assert.strictEqual(list.status, 0, list.stderr);
  const packs = JSON.parse(list.stdout);
  assert.deepStrictEqual(packs.map((p) => p.name), SKILL_NAMES);
  assert.deepStrictEqual(packs.map((p) => p.provides), ["audit-section", "gate", "init"]);
  assert.ok(packs.every((p) => p.valid && p.requires_tools.includes("arch-index")));

  // Key UX property of the trust model: extension install IS the consent —
  // the installer's recorded sha256 hashes make every pack trusted with NO
  // manual ack, and the gate executes end-to-end without an ack file.
  assert.ok(packs.every((p) => p.trusted === true), "installer hashes must confer trust (path 1)");
  assert.ok(
    !fs.existsSync(path.join(root, ".harness", "code-intel-ack.json")),
    "no explicit ack may be needed after an extension install",
  );
  fs.mkdirSync(path.join(root, ".arch-index"), { recursive: true });
  fs.writeFileSync(path.join(root, ".arch-index", "index.db"), "");
  writeProperties(root);
  const trustedGate = runResolverGate(root, "[]");
  assert.strictEqual(trustedGate.status, 0, trustedGate.stderr + trustedGate.stdout);
  assert.match(trustedGate.stdout, /GATE arch-index-gate: exit 0/);
  assert.match(trustedGate.stdout, /RESULT: pass/);
  assert.doesNotMatch(trustedGate.stdout, /unacknowledged/);

  // Uninstall: consumers revert to skip (AC-11).
  const removed = runCli(["remove", "arch-index", "--target", root]);
  assert.strictEqual(removed.status, 0, removed.stderr + removed.stdout);
  const listAfter = spawnSync(process.execPath, [RESOLVER, "list", "--root", root], { encoding: "utf8" });
  assert.deepStrictEqual(JSON.parse(listAfter.stdout), []);

  writeProperties(root);
  const gate = spawnSync(process.execPath, [RESOLVER, "gate", "--root", root], { encoding: "utf8" });
  assert.strictEqual(gate.status, 0, gate.stderr);
  assert.match(gate.stdout, /SKIP: no installed gate packs/);
});

// ---------------------------------------------------------------------------
// 3. audit.sh — freshness header + degraded on missing DB
// ---------------------------------------------------------------------------

test("audit: fragment starts with the index-freshness header and includes stub data", () => {
  const root = makeProjectWithDb();
  const env = Object.assign({}, process.env, {
    PATH: `${makeStubBin()}:${process.env.PATH}`,
    ARCH_INDEX_ROWS: '[{"callee":"core.dispatch","fan_in":12}]',
  });
  const r = spawnSync("/bin/bash", [AUDIT_SH], { cwd: root, env, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  const firstLine = r.stdout.split("\n").find((l) => l.trim() !== "");
  assert.match(firstLine, /^<!-- index-freshness: \S+ vs HEAD \S+ -->$/);
  assert.match(r.stdout, /## arch-index audit section/);
  assert.match(r.stdout, /### Fan-in hotspots/);
  assert.match(r.stdout, /core\.dispatch \| 12/);
});

test("audit: exit 3 index-missing when the DB is absent", () => {
  const root = makeDir("arch-index-audit-nodb-");
  const env = Object.assign({}, process.env, { PATH: `${makeStubBin()}:${process.env.PATH}` });
  const r = spawnSync("/bin/bash", [AUDIT_SH], { cwd: root, env, encoding: "utf8" });
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /index-missing/);
});

test("audit: accepted end-to-end by the resolver audit command", () => {
  const root = makeProjectWithDb();
  projectPackByHand(root);
  ackPack(root, "arch-index-audit");
  const env = Object.assign({}, process.env, {
    PATH: `${makeStubBin()}:${process.env.PATH}`,
    ARCH_INDEX_ROWS: '[{"callee":"core.dispatch","fan_in":12}]',
  });
  const r = spawnSync(process.execPath, [RESOLVER, "audit", "--root", root], { encoding: "utf8", env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /SECTION arch-index-audit/);
  assert.match(r.stdout, /<!-- index-freshness: /);
});
