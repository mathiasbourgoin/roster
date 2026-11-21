import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./resource-analysis/analyze";
import type { AnalysisInput, Observation } from "./resource-analysis/types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function fixture(): AnalysisInput {
  const resource = (id: string, cost: number) => ({
    id, runtime: "codex" as const, model: id, profile: "example", session: null,
    execution_pool: id, routes: ["sequential" as const], capabilities: ["tests"], available: true,
    observed_at: "2026-11-21T00:00:00Z", expires_at: "2026-11-22T00:00:00Z", source: "synthetic fixture",
    cost_mode: "subscription" as const, currency: "USD", rates: null,
    incremental_cost: cost, quota_pool: id, quota_remaining_attempts: null,
  });
  return {
    schema_version: 1, as_of: "2026-11-21T12:00:00Z", currency: "USD",
    policy: { objective: "cost", cost_weight: 0.5, min_success_rate: 0.5, history_max_age_days: 90 },
    resources: [resource("cheap", 0), resource("fast", 1)], memory: [],
    tasks: [{ id: "tests", project: "example", languages: ["ocaml", "shell"], task_types: ["test_execution"], requires: ["tests"], depends_on: [],
      candidates: ["cheap", "fast"].map(resource_id => ({ resource_id, route: "sequential" as const,
        estimate: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, duration_seconds: resource_id === "cheap" ? 100 : 10, success_rate: 1, source: "explicit synthetic prior" },
        overhead: { input_tokens: 0, duration_seconds: 0, incremental_cost: 0 },
      })),
    }],
  };
}
function observation(id: string, overrides: Partial<Observation> = {}): Observation {
  return { schema_version: 1, id, task_id: "old-task", project: "example", languages: ["shell", "ocaml"], task_types: ["test_execution"],
    resource_id: "cheap", runtime: "codex", model: "cheap", profile: "example", route: "sequential", at: "2026-11-21T10:00:00Z",
    source: "test receipt", outcome: "success", verified: true, input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100,
    duration_seconds: 20, actual_cost: 0, currency: "USD", cost_mode: "subscription", ...overrides };
}
test("direction changes selection and returns a Pareto tradeoff", () => {
  const input = fixture();
  const a = analyze(input);
  assert.equal(a.recommended?.assignments[0].resource_id, "cheap");
  assert.equal(a.proposals.duration?.assignments[0].resource_id, "fast");
  assert.equal(a.pareto.length, 2);
  input.policy.objective = "duration";
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "fast");
});
test("language/type sets match independent of order; failures affect estimates", () => {
  const input = fixture();
  input.memory = [observation("a"), observation("b", { outcome: "failure", duration_seconds: 40 })];
  const a = analyze(input).tasks[0].candidates[0];
  assert.equal(a.samples, 2);
  assert.equal(a.success_rate, 0.5);
  assert.equal(a.conditional_duration_to_success_seconds, 60);
});
test("different project, model, language combination, unverified or stale results do not transfer", () => {
  const input = fixture();
  input.memory = [observation("a", { project: "elsewhere" }), observation("b", { languages: ["ocaml"] }),
    observation("c", { verified: false }), observation("d", { model: "changed" }), observation("e", { at: "2025-01-01T00:00:00Z" })];
  assert.equal(analyze(input).tasks[0].candidates[0].samples, 0);
});
test("missing prices remain unknown; duration can still select a known-duration option", () => {
  const input = fixture(); input.resources[0].incremental_cost = null;
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "fast");
  input.policy.objective = "duration";
  input.tasks[0].candidates[0].estimate.duration_seconds = 1;
  const a = analyze(input);
  assert.equal(a.recommended?.assignments[0].resource_id, "cheap");
  assert.equal(a.recommended?.incremental_cost, null);
  assert.ok(!a.pareto.some(p => p.incremental_cost === null));
});
test("API cache is a subset and current prices reprice historical usage", () => {
  const input = fixture();
  Object.assign(input.resources[0], { cost_mode: "api", rates: { input: 2, output: 10, cache_read: 0.2 }, incremental_cost: null });
  input.tasks[0].candidates[0].estimate.cached_input_tokens = 500;
  assert.equal(analyze(input).tasks[0].candidates[0].cost_per_attempt, 0.0021);
  input.resources[0].rates!.cache_read = null;
  assert.equal(analyze(input).tasks[0].candidates[0].cost_per_attempt, null);
});
test("stale, future, unavailable, incapable and exhausted resources are excluded", () => {
  for (const change of [{ expires_at: "2026-11-21T11:00:00Z" }, { observed_at: "2026-11-21T13:00:00Z" }, { available: false }, { capabilities: [] }, { quota_remaining_attempts: 0 }]) {
    const input = fixture(); Object.assign(input.resources[0], change);
    const a = analyze(input);
    assert.equal(a.tasks[0].candidates[0].eligible, false);
    assert.equal(a.recommended?.assignments[0].resource_id, "fast");
  }
});
test("whole-roadmap quota and shared execution pools influence assignment", () => {
  const input = fixture();
  input.resources[0].quota_remaining_attempts = 1;
  input.tasks.push({ ...structuredClone(input.tasks[0]), id: "other" });
  const a = analyze(input);
  assert.equal(a.proposals.cost?.incremental_cost, 1);
  input.resources.forEach(r => r.execution_pool = "shared");
  input.tasks[0].candidates[0].estimate.duration_seconds = 10;
  input.tasks[1].candidates[0].estimate.duration_seconds = 10;
  assert.equal(analyze(input).proposals.duration?.elapsed_seconds, 20);
  input.resources[1].execution_pool = "other";
  assert.equal(analyze(input).proposals.duration?.elapsed_seconds, 10);
});
test("DAG dependencies wait even across independent pools", () => {
  const input = fixture(); input.tasks.push({ ...structuredClone(input.tasks[0]), id: "review", depends_on: ["tests"] });
  assert.equal(analyze(input).proposals.duration?.elapsed_seconds, 20);
  input.tasks[0].depends_on = ["review"];
  assert.throws(() => analyze(input), /cycle/);
});
test("unknown quality, zero successes and insufficient quality cannot silently rank", () => {
  const input = fixture(); input.tasks[0].candidates[0].estimate.success_rate = null;
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "fast");
  input.memory = [observation("fail", { outcome: "failure" })];
  assert.equal(analyze(input).tasks[0].candidates[0].success_rate, 0);
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "fast");
});
test("strict inputs reject malformed, duplicate and inconsistent data", () => {
  for (const mutate of [
    (x: any) => x.policy.cost_weight = 2,
    (x: any) => x.resources[0].available = "yes",
    (x: any) => x.tasks[0].languages.push("ocaml"),
    (x: any) => x.memory = [observation("a"), observation("a")],
    (x: any) => x.tasks[0].candidates[0].estimate.cached_input_tokens = 1001,
    (x: any) => x.resources[0].expires_at = "2026-02-30T00:00:00Z",
    (x: any) => x.policy.typo = true,
    (x: any) => x.tasks[0].candidates[0].overhead.incremental_cost = -1,
  ]) { const x = fixture(); mutate(x); assert.throws(() => analyze(x)); }
});
test("bounded search reports no recommendation instead of a partial optimum", () => {
  const input = fixture();
  input.tasks = Array.from({ length: 16 }, (_, i) => ({ ...structuredClone(input.tasks[0]), id: `task-${i}` }));
  const a = analyze(input);
  assert.equal(a.status, "search_limit"); assert.equal(a.recommended, null); assert.equal(a.assignments_evaluated, 0);
});
test("balanced weight, explicit overhead and shared quota change the proposals", () => {
  const input = fixture(); input.policy.objective = "balanced";
  input.policy.cost_weight = 1;
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "cheap");
  input.policy.cost_weight = 0;
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "fast");
  input.tasks[0].candidates[1].overhead.duration_seconds = 200;
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "cheap");
  input.resources.forEach(r => { r.quota_pool = "shared"; r.quota_remaining_attempts = 1; });
  input.tasks.push({ ...structuredClone(input.tasks[0]), id: "other" });
  assert.equal(analyze(input).status, "infeasible_capacity");
});
test("missing history metrics use identified priors, not a biased known-only mean", () => {
  const input = fixture(); input.memory = [observation("a", { duration_seconds: null }), observation("b")];
  const a = analyze(input).tasks[0].candidates[0];
  assert.equal(a.duration_per_attempt_seconds, 100);
  assert.match(a.metric_sources.duration_seconds, /^prior:/);
});
test("optional planning envelope excludes expensive and unpriced plans without billing enforcement", () => {
  const input = fixture(); input.policy.objective = "duration"; input.policy.max_incremental_cost = 0;
  assert.equal(analyze(input).recommended?.assignments[0].resource_id, "cheap");
  input.resources[0].incremental_cost = null;
  assert.equal(analyze(input).recommended, null);
});
const cli = path.resolve("scripts/roster-analyze.cjs");
function invoke(args: string[], cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 10000 });
}
test("standalone CLI works without source/dependencies in an ESM consumer", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-analysis-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    fs.copyFileSync(cli, path.join(dir, "analyze.cjs"));
    fs.writeFileSync(path.join(dir, "input.json"), JSON.stringify(fixture()));
    const run = spawnSync(process.execPath, [path.join(dir, "analyze.cjs"), "analyze", "--input", "input.json", "--objective", "duration"], { cwd: dir, encoding: "utf8", timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).recommended.assignments[0].resource_id, "fast");
    assert.ok(!fs.existsSync(path.join(dir, "node_modules")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("CLI explicitly records idempotent memory, preserves prefix and rejects conflicts/locks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-memory-"));
  try {
    const memory = path.join(dir, "memory.jsonl"), receipt = path.join(dir, "receipt.json");
    fs.writeFileSync(receipt, JSON.stringify(observation("one")));
    assert.equal(invoke(["record", "--memory", memory, "--observation", receipt]).status, 0);
    const prefix = fs.readFileSync(memory);
    assert.equal(JSON.parse(invoke(["record", "--memory", memory, "--observation", receipt]).stdout).duplicate, true);
    assert.deepEqual(fs.readFileSync(memory), prefix);
    fs.writeFileSync(receipt, JSON.stringify(observation("one", { outcome: "failure" })));
    assert.equal(invoke(["record", "--memory", memory, "--observation", receipt]).status, 1);
    fs.writeFileSync(receipt, JSON.stringify(observation("two", { actual_cost: null })));
    fs.writeFileSync(`${memory}.lock`, "");
    assert.equal(invoke(["record", "--memory", memory, "--observation", receipt]).status, 1);
    fs.unlinkSync(`${memory}.lock`);
    assert.equal(invoke(["record", "--memory", memory, "--observation", receipt]).status, 0);
    assert.ok(fs.readFileSync(memory).subarray(0, prefix.length).equals(prefix));
    const view = JSON.parse(invoke(["memory", "--memory", memory]).stdout);
    assert.equal(view.observations, 2);
    assert.deepEqual(view.groups[0].metrics.actual_cost, { samples: 1, total: 0 });
    fs.writeFileSync(path.join(dir, "input.json"), JSON.stringify(fixture()));
    const a = invoke(["analyze", "--input", path.join(dir, "input.json"), "--memory", memory]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(JSON.parse(a.stdout).tasks[0].candidates[0].samples, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("CLI rejects invalid flags, symlink inputs and partial memory without modifying artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-invalid-"));
  try {
    assert.equal(invoke(["taxonomy", "--typo", "yes"]).status, 1);
    assert.ok(Object.keys(JSON.parse(invoke(["taxonomy"]).stdout).task_types).length >= 10);
    const input = path.join(dir, "input.json"), link = path.join(dir, "link.json"), receipt = path.join(dir, "receipt.json"), memory = path.join(dir, "memory.jsonl");
    fs.writeFileSync(input, JSON.stringify(fixture())); fs.symlinkSync(input, link);
    assert.equal(invoke(["analyze", "--input", link]).status, 1);
    fs.writeFileSync(memory, JSON.stringify(observation("old")));
    fs.writeFileSync(receipt, JSON.stringify(observation("new")));
    const before = fs.readFileSync(memory);
    assert.equal(invoke(["record", "--memory", memory, "--observation", receipt]).status, 1);
    assert.deepEqual(fs.readFileSync(memory), before);
    assert.ok(!fs.existsSync(`${memory}.lock`));
    const x = fixture(); x.resources.forEach(r => r.available = false); fs.writeFileSync(input, JSON.stringify(x));
    assert.equal(invoke(["analyze", "--input", input]).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("all memory paths reject invalid UTF-8, BOM and missing final LF without repair", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-memory-encoding-"));
  try {
    const memory = path.join(dir, "memory.jsonl"), receipt = path.join(dir, "receipt.json"), input = path.join(dir, "input.json");
    fs.writeFileSync(input, JSON.stringify(fixture()));
    const valid = Buffer.from(JSON.stringify(observation("old", { source: "marker" })) + "\n");
    const invalid = Buffer.from(valid); invalid[invalid.indexOf("marker")] = 255;
    for (const bytes of [invalid, valid.subarray(0, valid.length - 1), Buffer.concat([Buffer.from([239, 187, 191]), valid])]) {
      fs.writeFileSync(memory, bytes);
      for (const args of [["memory", "--memory", memory], ["analyze", "--input", input, "--memory", memory]]) assert.equal(invoke(args).status, 1);
      for (const id of ["old", "new"]) {
        fs.writeFileSync(receipt, JSON.stringify(observation(id)));
        const run = invoke(["record", "--memory", memory, "--observation", receipt]);
        assert.equal(run.status, 1, run.stdout);
        assert.deepEqual(fs.readFileSync(memory), bytes);
        assert.ok(!fs.existsSync(`${memory}.lock`));
      }
    }
    fs.writeFileSync(receipt, invalid);
    fs.writeFileSync(memory, valid);
    assert.equal(invoke(["record", "--memory", memory, "--observation", receipt]).status, 1);
    assert.deepEqual(fs.readFileSync(memory), valid);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("changed-source ENOENT cannot recreate canonical memory with only the new receipt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-memory-swap-"));
  try {
    const memory = path.join(dir, "memory.jsonl"), receipt = path.join(dir, "receipt.json"), preload = path.join(dir, "swap.cjs");
    const original = Buffer.from(JSON.stringify(observation("old")) + "\n");
    fs.writeFileSync(memory, original); fs.writeFileSync(receipt, JSON.stringify(observation("new")));
    fs.writeFileSync(preload, `const fs = require("node:fs");
const file = process.env.ROSTER_TEST_MEMORY;
const inode = fs.statSync(file).ino;
const original = fs.fstatSync; let seen = 0;
fs.fstatSync = function (...args) {
  const stat = original.apply(this, args);
  if (stat.ino === inode && ++seen === 2) fs.renameSync(file, file + ".moved");
  return stat;
};\n`);
    const run = spawnSync(process.execPath, ["--require", preload, cli, "record", "--memory", memory, "--observation", receipt], { encoding: "utf8", timeout: 10000, env: { ...process.env, ROSTER_TEST_MEMORY: memory } });
    assert.equal(run.status, 1, run.stdout);
    assert.ok(!fs.existsSync(memory));
    assert.deepEqual(fs.readFileSync(`${memory}.moved`), original);
    assert.ok(!fs.existsSync(`${memory}.lock`));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
