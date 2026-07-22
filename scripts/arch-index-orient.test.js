#!/usr/bin/env node
// arch-index-orient.test.js — CommonJS, run via `node --test`.
// Contract tests for the arch-index-orient research-orientation provider
// (specs/arch-index-orient.md, FR-001–004, FR-010–011, FR-020–022, FR-060–063;
// AC-1..AC-4, AC-7, AC-8; CHECK-1..CHECK-4). Uses a real sqlite3-built fixture
// index.db — sqlite3 is a common system utility, not the proprietary
// `arch-index` binary this repo otherwise avoids depending on (FR-068 spirit).

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const PACK_DIR = path.join(REPO_ROOT, "extensions", "arch-index", "skills", "arch-index-orient");
const ORIENT_SH = path.join(PACK_DIR, "orient.sh");
const SKILL_MD = path.join(PACK_DIR, "SKILL.md");
const RESOLVER = path.join(REPO_ROOT, "scripts", "code-intel-resolve.js");

const HAVE_SQLITE3 = spawnSync("bash", ["-c", "command -v sqlite3"]).status === 0;
// Deliberately excludes any host `arch-index` binary (e.g. ~/.local/bin) from
// PATH — tests must be deterministic against the sqlite3 fallback path, not
// whatever happens to be installed on the developer's machine.
const SQLITE_ONLY_PATH = "/usr/bin:/bin";

function makeDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A PATH containing ONLY a `bash` symlink — no sqlite3, no arch-index, no node.
function makeBashOnlyBin() {
  const dir = makeDir("arch-index-orient-bashonly-");
  fs.symlinkSync("/usr/bin/bash", path.join(dir, "bash"));
  return dir;
}

// Fixture graph: foo -> {bar, baz}; a -> b -> c (chain); x <-> y (cycle, unreachable from z).
function makeProjectWithFixtureDb() {
  const root = makeDir("arch-index-orient-");
  fs.mkdirSync(path.join(root, ".arch-index"), { recursive: true });
  const dbPath = path.join(root, ".arch-index", "index.db");
  const sql = [
    "CREATE TABLE calls(caller TEXT, callee TEXT);",
    "CREATE TABLE symbols(name TEXT, visibility TEXT, comment_quality_score REAL);",
    "INSERT INTO calls VALUES ('foo','bar'),('foo','baz'),('a','b'),('b','c'),('x','y'),('y','x');",
    "INSERT INTO symbols VALUES ('foo','public',0.9),('bar','public',0.1);",
  ].join("\n");
  const r = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  return root;
}

function runOrient(root, args, { path: pathOverride } = {}) {
  return spawnSync("bash", [ORIENT_SH, ...args], {
    cwd: root,
    env: Object.assign({}, process.env, { PATH: pathOverride || SQLITE_ONLY_PATH }),
    encoding: "utf8",
  });
}

function firstLine(stdout) {
  return (stdout.split(/\r?\n/).find((l) => l.trim() !== "") || "").trim();
}

function jsonAfterHeader(stdout) {
  const lines = stdout.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim().startsWith("<!-- index-freshness:"));
  return JSON.parse(lines.slice(idx + 1).join("\n"));
}

// ---------------------------------------------------------------------------
// 1. modes — direct invocation (CHECK-1, AC-1)
// ---------------------------------------------------------------------------

test("callees: emits freshness header then rows for foo -> bar, baz", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["callees", "foo"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(firstLine(r.stdout), /^<!-- index-freshness: \S+ vs HEAD \S+ -->$/);
  const rows = jsonAfterHeader(r.stdout);
  assert.deepStrictEqual(
    rows.map((row) => row.callee).sort(),
    ["bar", "baz"],
  );
});

test("callers: emits rows including foo for callers of bar", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["callers", "bar"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = jsonAfterHeader(r.stdout);
  assert.ok(rows.some((row) => row.caller === "foo"));
});

test("fan-in: rows ranked by incoming-caller count, capped at TOP_N", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["fan-in"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = jsonAfterHeader(r.stdout);
  assert.ok(rows.length <= 10);
  assert.ok(rows.every((row) => "callee" in row && "fan_in" in row));
});

test("definition: absent symbol -> freshness header + empty array, exit 0", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["definition", "does-not-exist"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(jsonAfterHeader(r.stdout), []);
});

test("definition: present symbol returns its row", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["definition", "foo"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = jsonAfterHeader(r.stdout);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, "foo");
  assert.strictEqual(rows[0].visibility, "public");
});

// ---------------------------------------------------------------------------
// 2. path query — recursive CTE, cycle safety, same-node (CHECK-1, AC-2, AC-3)
// ---------------------------------------------------------------------------

test("path: depth-bounded chain a -> b -> c", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["path", "a", "c"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = jsonAfterHeader(r.stdout);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].path, "a->b->c");
});

test("path: cyclic input (x<->y) to an unreachable node terminates with empty result", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["path", "x", "z"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(jsonAfterHeader(r.stdout), []);
});

test("path: A == B returns a trivial same-node result, never an error", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeProjectWithFixtureDb();
  const r = runOrient(root, ["path", "a", "a"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = jsonAfterHeader(r.stdout);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].level, 0);
  assert.strictEqual(rows[0].note, "same-node");
});

// ---------------------------------------------------------------------------
// 3. degradation — exit 3 with distinct reason tokens (CHECK-2, AC-4)
// ---------------------------------------------------------------------------

test("index-missing: no .arch-index/index.db -> exit 3", () => {
  const root = makeDir("arch-index-orient-nodb-");
  const r = runOrient(root, ["fan-in"]);
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /DEGRADED: index-missing/);
});

test("tool-missing: neither arch-index nor sqlite3 on PATH -> exit 3", () => {
  const root = makeDir("arch-index-orient-notools-");
  fs.mkdirSync(path.join(root, ".arch-index"), { recursive: true });
  fs.writeFileSync(path.join(root, ".arch-index", "index.db"), "");
  const r = spawnSync("bash", [ORIENT_SH, "fan-in"], {
    cwd: root,
    env: { PATH: makeBashOnlyBin() },
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /DEGRADED: tool-missing: neither arch-index nor sqlite3 is on PATH/);
});

test("schema-mismatch: DB present but missing calls/symbols tables -> exit 3", { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" }, () => {
  const root = makeDir("arch-index-orient-noschema-");
  fs.mkdirSync(path.join(root, ".arch-index"), { recursive: true });
  fs.writeFileSync(path.join(root, ".arch-index", "index.db"), "");
  const r = runOrient(root, ["fan-in"]);
  assert.strictEqual(r.status, 3);
  assert.match(r.stderr, /DEGRADED: schema-mismatch: calls not found/);
});

test("usage errors also degrade with exit 3, never crash", () => {
  const root = makeProjectWithFixtureDb();
  assert.strictEqual(runOrient(root, []).status, 3);
  assert.strictEqual(runOrient(root, ["callees"]).status, 3);
  assert.strictEqual(runOrient(root, ["path", "a"]).status, 3);
  assert.strictEqual(runOrient(root, ["bogus-mode"]).status, 3);
});

// ---------------------------------------------------------------------------
// 4. seam contract — never a gate, provides research-orientation (CHECK-3, AC-7)
// ---------------------------------------------------------------------------

test("SKILL.md is not provides: gate (negative-grep)", () => {
  const text = fs.readFileSync(SKILL_MD, "utf8");
  assert.ok(!/^provides:[ \t]*gate\s*$/m.test(text), "arch-index-orient MUST NOT declare provides: gate");
  assert.ok(/research-orientation/.test(text), "arch-index-orient MUST declare provides: research-orientation");
});

test("registry passes with research-orientation in the arch-index provides array (CHECK-4)", () => {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check-code-intel-registry.js")], {
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const line = fs
    .readFileSync(path.join(REPO_ROOT, "registry", "code-intel.jsonl"), "utf8")
    .split("\n")
    .find((l) => l.includes('"name":"arch-index"'));
  assert.ok(line && JSON.parse(line).provides.includes("research-orientation"));
});

// ---------------------------------------------------------------------------
// 5. resolver integration — orient subcommand, trust gating (AC-7, AC-8)
// ---------------------------------------------------------------------------

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function projectOrientPack(root) {
  const dst = path.join(root, ".agents", "skills", "arch-index-orient");
  fs.mkdirSync(dst, { recursive: true });
  for (const file of fs.readdirSync(PACK_DIR)) {
    fs.copyFileSync(path.join(PACK_DIR, file), path.join(dst, file));
  }
  return dst;
}

function ackPack(root, skillDir) {
  const digest = sha256Hex(fs.readFileSync(path.join(skillDir, "SKILL.md")));
  const ackPath = path.join(root, ".harness", "code-intel-ack.json");
  fs.mkdirSync(path.dirname(ackPath), { recursive: true });
  fs.writeFileSync(ackPath, JSON.stringify({ acks: [{ skill: "arch-index-orient", sha256: digest }] }, null, 2) + "\n");
}

test("resolver orient: unacked pack -> DEGRADED, not executed, exit 0 (AC-8)", () => {
  const root = makeProjectWithFixtureDb();
  projectOrientPack(root);
  const r = spawnSync(
    process.execPath,
    [RESOLVER, "orient", "fan-in", "--root", root],
    { encoding: "utf8", env: Object.assign({}, process.env, { PATH: SQLITE_ONLY_PATH }) },
  );
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /DEGRADED arch-index-orient: unacknowledged — not executed/);
});

test(
  "resolver orient: acked pack executes end-to-end, forwards query args, exit 0",
  { skip: !HAVE_SQLITE3 && "sqlite3 not on PATH" },
  () => {
    const root = makeProjectWithFixtureDb();
    const dir = projectOrientPack(root);
    ackPack(root, dir);
    const r = spawnSync(
      process.execPath,
      [RESOLVER, "orient", "callees", "foo", "--root", root],
      { encoding: "utf8", env: Object.assign({}, process.env, { PATH: SQLITE_ONLY_PATH }) },
    );
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /index-freshness/);
    const rows = jsonAfterHeader(r.stdout);
    assert.deepStrictEqual(
      rows.map((row) => row.callee).sort(),
      ["bar", "baz"],
    );
  },
);

test("resolver orient: editing SKILL.md invalidates the ack -> DEGRADED again", () => {
  const root = makeProjectWithFixtureDb();
  const dir = projectOrientPack(root);
  ackPack(root, dir);
  fs.appendFileSync(path.join(dir, "SKILL.md"), "\n<!-- edited -->\n");
  const r = spawnSync(
    process.execPath,
    [RESOLVER, "orient", "fan-in", "--root", root],
    { encoding: "utf8", env: Object.assign({}, process.env, { PATH: SQLITE_ONLY_PATH }) },
  );
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /DEGRADED arch-index-orient: unacknowledged — not executed/);
});

test("resolver orient: no installed research-orientation pack -> DEGRADED, exit 0", () => {
  const root = makeDir("arch-index-orient-nopack-");
  const r = spawnSync(process.execPath, [RESOLVER, "orient", "fan-in", "--root", root], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /DEGRADED: no installed research-orientation packs/);
});
