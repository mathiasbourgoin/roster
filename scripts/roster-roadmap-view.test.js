"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const CLI = path.join(__dirname, "roster-roadmap.cjs");
function run(board, command, args = []) {
  const out = spawnSync(process.execPath, [CLI, command, board, ...args], { encoding: "utf8" });
  let data; try { data = JSON.parse(out.stdout); } catch { data = out.stdout; }
  return { code: out.status, data, text: out.stdout };
}
function ok(board, command, args = []) {
  const out = run(board, command, args); assert.equal(out.code, 0, JSON.stringify(out)); return out.data;
}
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value) + "\n"); }
function read(file) { return JSON.parse(fs.readFileSync(file)); }
function setup(t, accept = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-view-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const board = path.join(root, "board"); ok(board, "init", ["--id", "demo"]);
  if (!accept) return { root, board };
  const contract = read(path.join(__dirname, "../examples/roadmap/roadmap.json"));
  contract.id = "demo"; contract.tasks = [contract.tasks[0]]; contract.tasks[0].policy.max_attempts = 5;
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: {
    codex: { available: true, evidence: ["Observed native runtime"], capabilities: {} },
  } });
  const decision = path.join(root, "decision.json");
  write(decision, { by: "owner", basis: "Explicit accepted contract", contract_digest: ok(board, "lint").contract_digest });
  mutate(board, "accept", ["--decision", decision]); return { root, board, contract };
}
function mutate(board, command, args) {
  return ok(board, command, ["--coordinator", "lead", "--revision", String(read(path.join(board, "state.json")).revision), ...args]);
}
function claim(board) { return mutate(board, "claim", ["--task", "implement", "--assignee", "worker"]).assignment; }
function update(root, board, assignment, patch = {}, sequence = "0") {
  const file = path.join(root, "update.json");
  write(file, { message: "Running the declared checks", current_step: "Tests", checks: [{ id: "tests", status: "running", evidence: [] }], ...patch });
  return run(board, "progress", ["--task", "implement", "--attempt", assignment.id, "--assignee", assignment.assignee, "--sequence", sequence, "--update", file]);
}

test("formatted status observes a draft without changing or accepting it", t => {
  const { board } = setup(t, false), before = fs.readFileSync(path.join(board, "state.json"));
  const out = run(board, "status", ["--format", "text"]);
  assert.equal(out.code, 0, out.text); assert.match(out.text, /DRAFT/); assert.match(out.text, /Goal:/);
  assert.deepEqual(fs.readFileSync(path.join(board, "state.json")), before);
  assert.equal(fs.existsSync(path.join(board, "progress")), false);
  const view = ok(board, "view"); assert.equal(view.schema_version, 1); assert.equal(view.phase, "draft");
});

test("versioned view is self-contained and default status remains JSON", t => {
  const { board, contract } = setup(t), view = ok(board, "view");
  assert.equal(view.kind, "roster-roadmap-view"); assert.equal(view.goal, contract.goal);
  assert.equal(view.tasks[0].objective, contract.tasks[0].objective); assert.deepEqual(view.tasks[0].depends_on, []);
  assert.equal(view.tasks[0].topology.runtime, "codex"); assert.equal(view.tasks[0].checks[0].accepted_status, "unknown");
  assert.equal(view.global.accepted, false); assert.equal(view.completion.tasks_done, 0);
  assert.equal(view.version, ok(board, "view").version); assert.equal(ok(board, "status").accepted, true);
});

test("a filled valid draft stays observable before acceptance has initialized task state", t => {
  const { board } = setup(t, false), contract = read(path.join(__dirname, "../examples/roadmap/roadmap.json"));
  contract.id = "demo"; contract.tasks = [contract.tasks[0]]; contract.tasks[0].id = "constructor";
  write(path.join(board, "roadmap.json"), contract);
  const before = fs.readFileSync(path.join(board, "state.json")), view = ok(board, "view");
  assert.equal(view.contract_ready, true); assert.equal(view.accepted, false); assert.equal(view.phase, "draft");
  assert.equal(view.estimates, null); assert.equal(view.tasks[0].state, "draft");
  assert.equal(view.tasks[0].assignment, null); assert.equal(view.tasks[0].attempts, 0);
  assert.equal(run(board, "status", ["--format", "text"]).code, 0);
  assert.deepEqual(fs.readFileSync(path.join(board, "state.json")), before);
});

test("live progress changes view version, not authoritative state or accepted checks", t => {
  const { root, board } = setup(t), assignment = claim(board);
  const state = fs.readFileSync(path.join(board, "state.json")), before = ok(board, "view");
  const result = update(root, board, assignment); assert.equal(result.code, 0, result.text);
  const view = ok(board, "view"), task = view.tasks[0];
  assert.equal(task.assignment.assignee, "worker"); assert.equal(task.progress.status, "reported");
  assert.equal(task.progress.sequence, 1); assert.equal(task.checks[0].reported_status, "running");
  assert.equal(task.checks[0].accepted_status, "unknown"); assert.notEqual(view.version, before.version);
  assert.equal(view.version, ok(board, "view").version);
  assert.deepEqual(fs.readFileSync(path.join(board, "state.json")), state);
  const text = run(board, "status", ["--format", "text"]).text;
  assert.match(text, /worker/); assert.match(text, /Running the declared checks/); assert.match(text, /reported/);
});

test("planner revisions change displayed conditional ETA without changing the accepted execution contract", t => {
  const { root, board } = setup(t), first = ok(board, "view");
  const state = fs.readFileSync(path.join(board, "state.json")), contract = fs.readFileSync(path.join(board, "roadmap.json"));
  const file = path.join(root, "estimate.json");
  const record = { schema_version: 1, contract_digest: first.contract_digest,
    based_on_state_revision: first.revision, writer: "planner", basis: "Scoped task and integrated verification burden",
    evidence: ["briefs/demo-plan.md"], updated_at: new Date().toISOString(),
    tasks: { implement: { duration_minutes: { optimistic: 10, likely: 20, pessimistic: 30 } } },
    global_verification_minutes: { optimistic: 2, likely: 5, pessimistic: 10 } };
  write(file, record); ok(board, "estimate", ["--revision", "0", "--update", file]);
  const view = ok(board, "view"), formatted = run(board, "status", ["--format", "text"]);
  assert.equal(view.estimates.global_eta.remaining_minutes.likely, 25);
  assert.notEqual(view.version, first.version); assert.equal(view.estimates.estimate_revision, 1);
  assert.match(formatted.text, /ETA \(conditional\):/); assert.match(formatted.text, /Estimated remaining: 20 min/);
  record.tasks.implement.duration_minutes.likely = 25;
  record.basis = "Planner revisited verification burden"; record.updated_at = new Date().toISOString();
  write(file, record); ok(board, "estimate", ["--revision", "1", "--update", file]);
  assert.equal(ok(board, "view").estimates.global_eta.remaining_minutes.likely, 30);
  assert.deepEqual(fs.readFileSync(path.join(board, "state.json")), state);
  assert.deepEqual(fs.readFileSync(path.join(board, "roadmap.json")), contract);
  claim(board);
  assert.match(run(board, "status", ["--format", "text"]).text, /Estimated remaining: \d+(?:\.\d)? min/);
});

test("polling identity changes at an overrun even when forecast and execution revisions stay unchanged", t => {
  const { root, board } = setup(t); claim(board);
  const context = require("./roster-roadmap.cjs").readBoard(board), at = Date.parse(context.state.events.at(-1).at);
  const file = path.join(root, "estimate.json");
  write(file, { schema_version: 1, contract_digest: ok(board, "lint").contract_digest,
    based_on_state_revision: context.state.revision, writer: "planner", basis: "Observed scope", evidence: ["briefs/demo-plan.md"],
    updated_at: new Date().toISOString(), tasks: { implement: { duration_minutes: { optimistic: 10, likely: 20, pessimistic: 30 } } },
    global_verification_minutes: { optimistic: 1, likely: 2, pessimistic: 3 } });
  ok(board, "estimate", ["--revision", "0", "--update", file]);
  const module = require("./roster-roadmap-view.cjs"), clock = Date.now;
  try {
    Date.now = () => at + 60000; const first = module.snapshot(context);
    Date.now = () => at + 120000; assert.equal(module.snapshot(context).version, first.version);
    Date.now = () => at + 21 * 60000; const overdue = module.snapshot(context);
    assert.notEqual(overdue.version, first.version); assert.equal(overdue.tasks[0].estimate.reestimate_needed, true);
    Date.now = () => at + 31 * 60000; const unknown = module.snapshot(context);
    assert.notEqual(unknown.version, overdue.version); assert.equal(unknown.estimates.global_eta.status, "unknown");
  } finally { Date.now = clock; }
});

test("stale sequence, foreign attempt/assignee and undeclared checks cannot change progress", t => {
  const { root, board } = setup(t), assignment = claim(board);
  assert.equal(update(root, board, assignment).code, 0);
  const version = ok(board, "view").version;
  for (const [who, patch, sequence] of [
    [assignment, {}, "0"], [{ ...assignment, assignee: "other" }, {}, "1"],
    [{ ...assignment, id: "foreign-attempt" }, {}, "1"], [assignment, { checks: [{ id: "invented", status: "pass", evidence: [] }] }, "1"],
  ]) assert.notEqual(update(root, board, who, patch, sequence).code, 0);
  assert.equal(ok(board, "view").version, version);
});

test("accepted receipt supersedes live progress and still requires separate global acceptance", t => {
  const { root, board } = setup(t), assignment = claim(board);
  assert.equal(update(root, board, assignment, { checks: [{ id: "tests", status: "pass", evidence: ["reports/unit.txt"] }] }).code, 0);
  const file = path.join(root, "receipt.json"); write(file, {
    task_id: "implement", attempt_id: assignment.id, assignee: "worker", contract_digest: assignment.contract_digest,
    result: "done", summary: "Implemented and verified", evidence: ["reports/unit.txt"], changed_files: [],
    checks: [{ id: "tests", status: "pass", evidence: ["reports/unit.txt"] }],
  }); mutate(board, "record", ["--receipt", file]);
  const view = ok(board, "view"); assert.equal(view.phase, "global-verification-needed");
  assert.equal(view.completion.tasks_done, 1); assert.equal(view.global.accepted, false);
  assert.equal(view.tasks[0].checks[0].accepted_status, "pass"); assert.equal(view.tasks[0].progress.status, "not-active");
  assert.notEqual(update(root, board, assignment, {}, "1").code, 0);
  const state = read(path.join(board, "state.json")); write(file, {
    contract_digest: assignment.contract_digest, state_revision: state.revision, summary: "Integrated scenario passed",
    evidence: ["reports/global.txt"], checks: [{ id: "integrated", status: "pass", evidence: ["reports/global.txt"] }],
  }); mutate(board, "complete", ["--receipt", file]); assert.equal(ok(board, "view").global.accepted, true);
  assert.match(run(board, "status", ["--format", "text"]).text, /ETA: completed; global outcome accepted/);
});

test("malformed optional progress is visible without laundering it into a passed check", t => {
  const { root, board } = setup(t), assignment = claim(board); assert.equal(update(root, board, assignment).code, 0);
  const file = path.join(board, "progress", `implement-${assignment.id}.json`); fs.writeFileSync(file, "broken");
  const view = ok(board, "view"); assert.equal(view.tasks[0].progress.status, "invalid");
  assert.equal(view.tasks[0].checks[0].accepted_status, "unknown");
});

test("progress refuses managed symlinks and invalid hard-linked reports without changing external content", t => {
  const { root, board } = setup(t), assignment = claim(board), dir = path.join(board, "progress");
  assert.equal(update(root, board, assignment).code, 0);
  fs.unlinkSync(path.join(dir, `implement-${assignment.id}.json`)); const sentinel = path.join(root, "external.json"); fs.writeFileSync(sentinel, "owner content\n");
  const file = path.join(dir, `implement-${assignment.id}.json`); fs.symlinkSync(sentinel, file);
  assert.notEqual(update(root, board, assignment).code, 0); assert.equal(fs.readFileSync(sentinel, "utf8"), "owner content\n");
  fs.unlinkSync(file); fs.linkSync(sentinel, file);
  assert.notEqual(update(root, board, assignment).code, 0); assert.equal(fs.readFileSync(sentinel, "utf8"), "owner content\n");
});
