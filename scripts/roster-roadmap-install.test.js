"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIMES = ["roster-roadmap.cjs", "roster-artifacts.cjs", "roster-recovery.cjs", "roster-roadmap-view.cjs", "roster-roadmap-estimates.cjs", "roster-usage.cjs"];
const RESOURCES = {
  "schema.md": "schema/roadmap-schema.md", "example.json": "examples/roadmap/roadmap.json",
  "capabilities.json": "examples/roadmap/capabilities.json", "model-routing.md": "docs/model-routing.md",
  "recovery-schema.md": "schema/recovery-schema.md", "failure-recovery.md": "docs/failure-recovery.md",
  "usage-schema.md": "schema/usage-report-schema.md", "usage-reports.md": "docs/usage-reports.md",
  "estimates-schema.md": "schema/roadmap-estimates-schema.md", "estimates.md": "docs/roadmap-estimates.md",
  "view-schema.md": "schema/roadmap-view-schema.md", "view.schema.json": "schema/roadmap-view.schema.json",
};
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
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
  for (const name of RUNTIMES) assert.equal(fs.readFileSync(path.join(dir, ".harness/bin", name), "utf8"), fs.readFileSync(path.join(ROOT, "scripts", name), "utf8"));
  for (const [installedName, source] of Object.entries(RESOURCES)) assert.equal(fs.readFileSync(path.join(dir, ".harness/roadmap", installedName), "utf8"), fs.readFileSync(path.join(ROOT, source), "utf8"));
  assert.match(fs.readFileSync(path.join(dir, ".harness/roadmap/schema.md"), "utf8"), /## Receipts/);
  assert.equal(fs.readFileSync(path.join(dir, ".harness/roadmap/model-routing.md"), "utf8"), fs.readFileSync(path.join(ROOT, "docs/model-routing.md"), "utf8"));
  const installed = require(cli);
  installed.validateContract(JSON.parse(fs.readFileSync(path.join(dir, ".harness/roadmap/example.json"))));
  installed.validateCapabilities(JSON.parse(fs.readFileSync(path.join(dir, ".harness/roadmap/capabilities.json"))));
  for (const projected of [".agents/skills/roster-roadmap/SKILL.md", ".claude/commands/roster-roadmap.md", ".opencode/skills/roster-roadmap/SKILL.md"]) {
    assert.match(fs.readFileSync(path.join(dir, projected), "utf8"), /# Roster Roadmap/);
  }
  for (const projected of [".agents/skills/roster-usage/SKILL.md", ".claude/commands/roster-usage.md", ".opencode/skills/roster-usage/SKILL.md"]) {
    assert.match(fs.readFileSync(path.join(dir, projected), "utf8"), /roster-usage/);
  }
  exerciseInstalledConsumer(dir, cli);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "package.json"))).type, "module");
  assert.equal(fs.existsSync(path.join(dir, "node_modules")), false);
  ok(command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, "--check"], dir));
  fs.appendFileSync(cli, "\n// stale installed runtime\n");
  const stale = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, "--check"], dir);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /roadmap runtime is missing or stale/);
});

function installedJSON(dir, cli, args) {
  const result = command(process.execPath, [cli, ...args], dir); ok(result); return JSON.parse(result.stdout);
}
function exerciseInstalledConsumer(dir, cli) {
  const board = path.join(dir, "roadmaps/demo"); installedJSON(dir, cli, ["init", board, "--id", "demo"]);
  const draft = command(process.execPath, [cli, "status", board, "--format", "text"], dir); ok(draft); assert.match(draft.stdout, /DRAFT/);
  const contract = read(path.join(dir, ".harness/roadmap/example.json")); contract.id = "demo"; contract.tasks = [contract.tasks[0]];
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed installed test runtime"], capabilities: {} } } });
  const decision = path.join(dir, "decision.json"); write(decision, { by: "owner", basis: "Disposable installed-only test", contract_digest: installedJSON(dir, cli, ["lint", board]).contract_digest });
  function mutation(commandName, args) { return installedJSON(dir, cli, [commandName, board, "--coordinator", "lead", "--revision", String(read(path.join(board, "state.json")).revision), ...args]); }
  mutation("accept", ["--decision", decision]);
  const estimate = path.join(dir, "estimate.json"), span = { optimistic: 1, likely: 2, pessimistic: 3 };
  write(estimate, { schema_version: 1, contract_digest: read(decision).contract_digest, based_on_state_revision: read(path.join(board, "state.json")).revision,
    writer: "planner", basis: "Reviewed bounded mission", evidence: ["notes/planning.md"], updated_at: new Date().toISOString(), tasks: { implement: { duration_minutes: span } }, global_verification_minutes: span });
  assert.equal(installedJSON(dir, cli, ["estimate", board, "--revision", "0", "--update", estimate]).revision, 1);
  const assignment = mutation("claim", ["--task", "implement", "--assignee", "worker"]).assignment;
  const progress = path.join(dir, "progress.json"); write(progress, { message: "Running installed checks", current_step: "Tests", checks: [{ id: "tests", status: "running", evidence: [] }] });
  assert.equal(installedJSON(dir, cli, ["progress", board, "--task", "implement", "--attempt", assignment.id, "--assignee", "worker", "--sequence", "0", "--update", progress]).reported, true);
  const view = installedJSON(dir, cli, ["view", board]);
  assert.equal(view.kind, "roster-roadmap-view"); assert.equal(view.tasks[0].progress.status, "reported"); assert.equal(view.tasks[0].checks[0].accepted_status, "unknown");
  assert.equal(view.estimates.estimate_revision, 1); assert.equal(view.global.accepted, false);
  const status = command(process.execPath, [cli, "status", board, "--format", "text"], dir); ok(status); assert.match(status.stdout, /Running installed checks/);
  const recovery = path.join(dir, ".harness/bin/roster-recovery.cjs");
  assert.equal(installedJSON(dir, recovery, ["status", "--board", board, "--task", "implement"]).consecutive_failures, 0);
  const usage = path.join(dir, ".harness/bin/roster-usage.cjs");
  assert.equal(installedJSON(dir, usage, ["report"]).status, "no-data");
  const usageDir = path.join(dir, ".harness/.local"); fs.mkdirSync(usageDir, { recursive: true });
  fs.writeFileSync(path.join(usageDir, "usage.jsonl"), JSON.stringify({ schema_version: 1, runtime: "pi", source: "runtime-observed", stream_id: "local", captured_at: "2026-11-12T09:00:00Z", model: "model-a", totals: { input_tokens: 11, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: null } }) + "\n");
  const report = installedJSON(dir, usage, ["report"]); assert.equal(report.groups[0].runtime, "pi"); assert.equal(report.totals.input_tokens, 11);
}

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
  fs.unlinkSync(cli);
  fs.copyFileSync(path.join(ROOT, "scripts/roster-roadmap.cjs"), cli);
  const schema = path.join(dir, ".harness/roadmap/schema.md");
  fs.unlinkSync(schema);
  fs.symlinkSync(sentinel, schema);
  for (const args of [[], ["--check"]]) {
    const result = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, ...args], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /roadmap: refusing managed symlink/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "untouched\n");
  }
});

test("sync replaces managed hard-link entries without truncating unrelated resources", (t) => {
  const dir = sandbox(t);
  ok(command("bash", [path.join(ROOT, "scripts/init-harness.sh"), dir, "core"], dir));
  const sentinel = path.join(dir, "unrelated.md");
  fs.writeFileSync(sentinel, "untouched\n");
  const schema = path.join(dir, ".harness/roadmap/schema.md");
  fs.unlinkSync(schema);
  fs.linkSync(sentinel, schema);
  ok(command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir], dir));
  assert.equal(fs.readFileSync(sentinel, "utf8"), "untouched\n");
  assert.match(fs.readFileSync(schema, "utf8"), /## Receipts/);
});

test("installed model policy is required, repairable and protected before sync writes", (t) => {
  const dir = sandbox(t);
  ok(command("bash", [path.join(ROOT, "scripts/init-harness.sh"), dir, "core"], dir));
  const policy = path.join(dir, ".harness/roadmap/model-routing.md");
  const expected = fs.readFileSync(path.join(ROOT, "docs/model-routing.md"), "utf8");
  assert.equal(fs.readFileSync(policy, "utf8"), expected);
  for (const missing of [false, true]) {
    if (missing) fs.unlinkSync(policy);
    else fs.appendFileSync(policy, "\nstale policy\n");
    const check = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, "--check"], dir);
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stderr, /roadmap runtime is missing or stale/);
    if (missing) assert.equal(fs.existsSync(policy), false);
    else assert.match(fs.readFileSync(policy, "utf8"), /stale policy/);
    ok(command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir], dir));
    assert.equal(fs.readFileSync(policy, "utf8"), expected);
  }
  const sentinel = path.join(dir, "unrelated-policy.md");
  fs.writeFileSync(sentinel, "owner content\n");
  fs.unlinkSync(policy);
  fs.symlinkSync(sentinel, policy);
  for (const check of [[], ["--check"]]) {
    const result = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, ...check], dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /roadmap: refusing managed symlink/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "owner content\n");
    assert.equal(fs.lstatSync(policy).isSymbolicLink(), true);
  }
});

test("sync checks the complete runtime and resource closure and repairs missing or stale entries", t => {
  const dir = sandbox(t); ok(command("bash", [path.join(ROOT, "scripts/init-harness.sh"), dir, "core"], dir));
  const cases = [
    [".harness/bin/roster-artifacts.cjs", "scripts/roster-artifacts.cjs", "missing"],
    [".harness/bin/roster-usage.cjs", "scripts/roster-usage.cjs", "stale"],
    [".harness/roadmap/view.schema.json", "schema/roadmap-view.schema.json", "missing"],
    [".harness/roadmap/estimates-schema.md", "schema/roadmap-estimates-schema.md", "stale"],
  ];
  for (const [relative, source, damage] of cases) {
    const target = path.join(dir, relative);
    if (damage === "missing") fs.unlinkSync(target); else fs.appendFileSync(target, "\nstale installed resource\n");
    const before = damage === "missing" ? null : fs.readFileSync(target, "utf8");
    const check = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, "--check"], dir);
    assert.notEqual(check.status, 0, check.stdout + check.stderr); assert.match(check.stderr, /roadmap runtime is missing or stale/);
    if (damage === "missing") assert.equal(fs.existsSync(target), false); else assert.equal(fs.readFileSync(target, "utf8"), before);
    ok(command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir], dir));
    assert.equal(fs.readFileSync(target, "utf8"), fs.readFileSync(path.join(ROOT, source), "utf8"));
  }
});

test("new runtime and view schema aliases are refused before any managed write", t => {
  const dir = sandbox(t); ok(command("bash", [path.join(ROOT, "scripts/init-harness.sh"), dir, "core"], dir));
  const sentinel = path.join(dir, "external-owner-file"); fs.writeFileSync(sentinel, "owner content\n");
  for (const [relative, source] of [
    [".harness/bin/roster-recovery.cjs", "scripts/roster-recovery.cjs"],
    [".harness/bin/roster-usage.cjs", "scripts/roster-usage.cjs"],
    [".harness/roadmap/view.schema.json", "schema/roadmap-view.schema.json"],
  ]) {
    const target = path.join(dir, relative), unchanged = fs.readFileSync(path.join(dir, ".harness/bin/roster-roadmap.cjs"));
    fs.unlinkSync(target); fs.symlinkSync(sentinel, target);
    for (const args of [[], ["--check"]]) {
      const result = command("bash", [path.join(ROOT, "scripts/sync-harness.sh"), dir, ...args], dir);
      assert.notEqual(result.status, 0); assert.match(result.stderr, /roadmap: refusing managed symlink/);
      assert.equal(fs.readFileSync(sentinel, "utf8"), "owner content\n"); assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
      assert.deepEqual(fs.readFileSync(path.join(dir, ".harness/bin/roster-roadmap.cjs")), unchanged);
    }
    fs.unlinkSync(target); fs.copyFileSync(path.join(ROOT, source), target);
  }
});

test("incomplete trusted runtime closure refuses distribution without changing consumer files", t => {
  const dir = sandbox(t), consumer = path.join(dir, "consumer"), source = path.join(dir, "incomplete-source/scripts");
  ok(command("bash", [path.join(ROOT, "scripts/init-harness.sh"), consumer, "core"], dir));
  fs.mkdirSync(source, { recursive: true });
  for (const name of ["sync-harness.sh", "roster-roadmap.cjs"]) fs.copyFileSync(path.join(ROOT, "scripts", name), path.join(source, name));
  const target = path.join(consumer, ".harness/bin/roster-roadmap.cjs"), before = fs.readFileSync(target);
  const result = command("bash", [path.join(source, "sync-harness.sh"), consumer], dir);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /roadmap: trusted resource missing/);
  assert.deepEqual(fs.readFileSync(target), before);
});
