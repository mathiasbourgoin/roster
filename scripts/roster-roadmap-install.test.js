"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-install-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function command(program, args, dir) {
  return spawnSync(program, args, { cwd: dir, encoding: "utf8", timeout: 120000,
    env: { ...process.env, HOME: dir, CODEX_HOME: path.join(dir, ".codex-home") } });
}
function ok(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ""}`);
}

test("fresh ESM consumer gets runnable toolkit and all existing skill projections", (t) => {
  const dir = sandbox(t);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
  ok(command("bash", [path.join(ROOT, "scripts/init-harness.sh"), dir, "core"], dir));
  const cli = path.join(dir, ".harness/bin/roster-roadmap.cjs");
  assert.equal(fs.readFileSync(cli, "utf8"), fs.readFileSync(path.join(ROOT, "scripts/roster-roadmap.cjs"), "utf8"));
  for (const projected of [".agents/skills/roster-roadmap/SKILL.md", ".claude/commands/roster-roadmap.md", ".opencode/skills/roster-roadmap/SKILL.md"]) {
    assert.match(fs.readFileSync(path.join(dir, projected), "utf8"), /# Roster Roadmap/);
  }
  ok(command(process.execPath, [cli, "init", path.join(dir, "roadmaps/demo"), "--id", "demo"], dir));
  assert.ok(fs.existsSync(path.join(dir, "roadmaps/demo/state.json")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "package.json"))).type, "module");
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
  ok(command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, "--check"], dir));
  fs.appendFileSync(cli, "\n// stale installed runtime\n");
  const stale = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, "--check"], dir);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /roadmap runtime is missing or stale/);
});

test("sync and read-only check refuse linked roadmap runtime without touching its target", (t) => {
  const dir = sandbox(t);
  ok(command("bash", [path.join(ROOT, "scripts/init-harness.sh"), dir, "core"], dir));
  const cli = path.join(dir, ".harness/bin/roster-roadmap.cjs");
  const sentinel = path.join(dir, "unrelated.cjs");
  fs.writeFileSync(sentinel, "untouched\n");
  fs.unlinkSync(cli);
  fs.symlinkSync(sentinel, cli);
  for (const args of [[], ["--check"]]) {
    const result = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, ...args], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /roadmap: refusing managed symlink/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "untouched\n");
    assert.equal(fs.lstatSync(cli).isSymbolicLink(), true);
  }
});
