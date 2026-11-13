"use strict";
// Shared fixture of the derived-mission tests (not part of the runtime closure).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("./roster-roadmap.cjs");
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function task(id, deps = [], policy = {}) {
  return { id, intake: `briefs/${id}.md`, objective: `Deliver ${id}`, depends_on: deps, inputs: [], outputs: [`src/${id}.js`], allowed_files: [`src/${id}.js`],
    dod: ["Checks pass"], success: [`${id} works`], checks: [{ id: "unit", description: "Unit checks pass" }],
    topology: { runtime: "codex", model: "configured", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] },
    policy: { max_attempts: 3, on_failure: "retry", stop_if: ["Scope changed"], recovery: ["Diagnose"], failure: "Budget exhausted", ...policy },
    workflow: { recommendation: "none", reason: "Bounded mission", steps: [] } };
}
const TOPOLOGY = { runtime: "codex", model: "opus", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] };
const CAPABILITIES = { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: {} } } };
function setup(t, tasks = [task("impl"), task("review", ["impl"])], accept = true, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-derived-")), board = path.join(root, "board");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  core.main(["init", board, "--id", "demo"]);
  const contract = { schema_version: 1, id: "demo", goal: "Deliver demo", success: ["Integrated"], global_checks: [{ id: "global", description: "Demo works" }], execution: { max_active: options.max_active || 1 }, tasks };
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), options.capabilities || CAPABILITIES);
  const decision = path.join(root, "decision.json");
  write(decision, { by: "owner", basis: "Disposable test", contract_digest: core.hash(contract) });
  if (accept) core.main(["accept", board, "--coordinator", "lead", "--revision", "0", "--decision", decision]);
  return { root, board, stateFile: path.join(board, "state.json"), roadmapFile: path.join(board, "roadmap.json"), capabilitiesFile: path.join(board, "capabilities.json") };
}
const state = f => read(f.stateFile);
const cmd = (f, command, args = []) => core.main([command, f.board, "--coordinator", "lead", "--revision", String(state(f).revision), ...args]);
const claim = (f, id, assignee = "dev") => cmd(f, "claim", ["--task", id, "--assignee", assignee]).assignment;
function receipt(f, id, result, extra = {}) {
  const a = state(f).tasks[id].assignment;
  return { task_id: id, attempt_id: a.id, assignee: a.assignee, contract_digest: a.contract_digest, result, summary: `${id} ${result}`,
    evidence: ["log"], changed_files: result === "done" ? [`src/${id.replace(/-fix-\d+$/, "")}.js`] : [], checks: [{ id: "unit", status: result === "done" ? "pass" : "fail", evidence: ["log"] }], ...extra };
}
function record(f, value) { const file = path.join(f.root, "receipt.json"); write(file, value); return cmd(f, "record", ["--receipt", file]); }
function finish(f, id, result, assignee, extra) { claim(f, id, assignee); return record(f, receipt(f, id, result, extra)); }
const release = (f, id) => cmd(f, "release", ["--task", id, "--reason", "Reconciled", "--reconciled-by", "lead"]);
function request(f, overrides = {}) {
  const file = path.join(f.root, "derive.json");
  write(file, { parent: "impl", cause: "review", objective: "Fix the null check", topology: TOPOLOGY, max_attempts: 2, ...overrides });
  return file;
}
const derive = (f, overrides) => cmd(f, "derive", ["--request", request(f, overrides)]);
function withdraw(f, id, value = { reason: "Topology cannot be claimed on this host" }) {
  const file = path.join(f.root, "withdrawal.json"); write(file, value);
  return cmd(f, "withdraw-derived", ["--task", id, "--withdrawal", file]);
}
// impl done by dev; review blocked by rev1 blaming impl.
function blockedReview(t, tasks, blames = ["impl"]) {
  const f = setup(t, tasks);
  for (const id of Object.keys(state(f).tasks)) if (id !== "review" && !state(f).tasks.review.attempts && read(f.roadmapFile).tasks.find(x => x.id === "review").depends_on.includes(id)) finish(f, id, "done", "dev");
  finish(f, "review", "blocked", "rev1", blames ? { blames } : {});
  return f;
}
// The action must fail with a message matching pattern and leave state.json and roadmap.json byte-identical.
function unchanged(f, action, pattern) {
  assert.ok(pattern instanceof RegExp, "unchanged needs the expected refusal pattern");
  const stateBytes = fs.readFileSync(f.stateFile), roadmapBytes = fs.readFileSync(f.roadmapFile);
  assert.throws(action, pattern);
  assert.deepEqual(fs.readFileSync(f.stateFile), stateBytes);
  assert.deepEqual(fs.readFileSync(f.roadmapFile), roadmapBytes);
}
// A hand-edited state.json must make both status and next fail with a message matching pattern.
function tampered(f, change, pattern) {
  assert.ok(pattern instanceof RegExp, "tampered needs the expected refusal pattern");
  const value = state(f); change(value); write(f.stateFile, value);
  assert.throws(() => core.main(["status", f.board]), pattern);
  assert.throws(() => core.main(["next", f.board]), pattern);
}
module.exports = { core, write, read, task, TOPOLOGY, CAPABILITIES, setup, state, cmd, claim, receipt, record, finish, release, request, derive, withdraw, blockedReview, unchanged, tampered };
