"use strict";
// CHECK-1 (specs/roadmap-derived-missions.md): AC-1..AC-5, FR-001/FR-003 refusals, tamper cases,
// EC-1, EC-2, EC-3, EC-8.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const core = require("./roster-roadmap.cjs");
const CLI = path.join(__dirname, "roster-roadmap.cjs");
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
function setup(t, tasks = [task("impl"), task("review", ["impl"])], accept = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-derived-")), board = path.join(root, "board");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  core.main(["init", board, "--id", "demo"]);
  const contract = { schema_version: 1, id: "demo", goal: "Deliver demo", success: ["Integrated"], global_checks: [{ id: "global", description: "Demo works" }], execution: { max_active: 1 }, tasks };
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: {} } } });
  const decision = path.join(root, "decision.json");
  write(decision, { by: "owner", basis: "Disposable test", contract_digest: core.hash(contract) });
  if (accept) core.main(["accept", board, "--coordinator", "lead", "--revision", "0", "--decision", decision]);
  return { root, board, stateFile: path.join(board, "state.json"), roadmapFile: path.join(board, "roadmap.json") };
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
// impl done by dev; review blocked by rev1 blaming impl.
function blockedReview(t, tasks, blames = ["impl"]) {
  const f = setup(t, tasks);
  for (const id of Object.keys(state(f).tasks)) if (id !== "review" && !state(f).tasks.review.attempts && read(f.roadmapFile).tasks.find(x => x.id === "review").depends_on.includes(id)) finish(f, id, "done", "dev");
  finish(f, "review", "blocked", "rev1", blames ? { blames } : {});
  return f;
}
function unchanged(f, action) {
  const stateBytes = fs.readFileSync(f.stateFile), roadmapBytes = fs.readFileSync(f.roadmapFile);
  assert.throws(action);
  assert.deepEqual(fs.readFileSync(f.stateFile), stateBytes);
  assert.deepEqual(fs.readFileSync(f.roadmapFile), roadmapBytes);
}

test("AC-1 derive from a blaming blocked review receipt records definition, queued state and one event (real CLI)", t => {
  const f = blockedReview(t), before = state(f), roadmap = fs.readFileSync(f.roadmapFile);
  const out = spawnSync(process.execPath, [CLI, "derive", f.board, "--coordinator", "lead", "--revision", String(before.revision), "--request", request(f)], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout);
  assert.equal(JSON.parse(out.stdout).task_id, "impl-fix-1");
  const after = state(f), cause = before.receipts.at(-1);
  assert.deepEqual(after.derived["impl-fix-1"], { parent: "impl", cause: { task_id: "review", attempt_id: cause.attempt_id, assignee: "rev1" }, objective: "Fix the null check", topology: TOPOLOGY, max_attempts: 2, revision: before.revision + 1 });
  assert.deepEqual(after.tasks["impl-fix-1"], { status: "queued", attempts: 0, assignment: null, reason: null });
  assert.equal(after.events.length, before.events.length + 1);
  assert.deepEqual({ ...after.events.at(-1), at: null }, { revision: before.revision + 1, action: "derive", coordinator: "lead", task_id: "impl-fix-1", reason: null, reconciled_by: null, at: null });
  assert.deepEqual(after.tasks.impl, before.tasks.impl); assert.deepEqual(after.tasks.review, before.tasks.review);
  assert.deepEqual(after.receipts, before.receipts);
  assert.deepEqual(fs.readFileSync(f.roadmapFile), roadmap);
});

test("AC-2 derive refuses without blames, with another blamed dependency, or with a malformed request", t => {
  const unblamed = blockedReview(t, undefined, null);
  unchanged(unblamed, () => derive(unblamed));
  const other = blockedReview(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])], ["lib"]);
  unchanged(other, () => derive(other));
  const f = blockedReview(t);
  for (const bad of [{ extra: 1 }, { objective: "" }, { objective: "x".repeat(2001) }, { max_attempts: 0 }, { max_attempts: 4 }, { max_attempts: 1.5 },
    { topology: { ...TOPOLOGY, runtime: "unknown" } }, { topology: { ...TOPOLOGY, route: "workflow" } }, { parent: "missing" }, { cause: "impl-fix-1" }]) unchanged(f, () => derive(f, bad));
  const file = request(f); const value = read(file); delete value.max_attempts; write(file, value);
  unchanged(f, () => cmd(f, "derive", ["--request", file]));
  unchanged(f, () => core.main(["derive", f.board, "--coordinator", "stranger", "--revision", String(state(f).revision), "--request", request(f)]));
});

test("AC-2 every FR-003 precondition refuses without mutation", t => {
  const queued = setup(t); finish(queued, "impl", "done", "dev");
  unchanged(queued, () => derive(queued));
  const parentNotDependency = blockedReview(t, [task("impl"), task("other"), task("review", ["impl"])]);
  unchanged(parentNotDependency, () => derive(parentNotDependency, { parent: "other" }));
  const blocking = blockedReview(t, [task("impl"), task("review", ["impl"], { on_failure: "block" })]);
  unchanged(blocking, () => derive(blocking));
  const exhausted = blockedReview(t, [task("impl"), task("review", ["impl"], { max_attempts: 1 })]);
  unchanged(exhausted, () => derive(exhausted));
  const twice = blockedReview(t); derive(twice);
  unchanged(twice, () => derive(twice));
  const otherDone = blockedReview(t, [task("impl"), task("other"), task("review", ["impl"])]); finish(otherDone, "other", "done", "dev");
  unchanged(otherDone, () => derive(otherDone, { parent: "other" }));
  const draft = setup(t, undefined, false);
  assert.throws(() => core.main(["derive", draft.board, "--coordinator", "lead", "--revision", "0", "--request", request(draft)]), /not accepted/);
});

test("AC-2 a cause that needs a recovery reframe cannot derive (live-only check)", t => {
  const f = setup(t, [task("impl"), task("review", ["impl"], { max_attempts: 5 })]);
  finish(f, "impl", "done", "dev");
  for (let i = 0; i < 3; i++) { if (i) release(f, "review"); finish(f, "review", "blocked", "rev1", { blames: ["impl"] }); }
  assert.throws(() => derive(f), /reframe/);
});

test("AC-2 FR-001 blames misuse and EC-8 blames on a derived receipt are refused", t => {
  const f = setup(t, [task("impl"), task("other"), task("review", ["impl"])]);
  claim(f, "impl");
  assert.throws(() => record(f, receipt(f, "impl", "done", { blames: ["impl"] })), /blocked/);
  record(f, receipt(f, "impl", "done"));
  claim(f, "review", "rev1");
  for (const blames of [[], ["impl", "impl"], ["other"], "impl", ["bad id"]]) assert.throws(() => record(f, receipt(f, "review", "blocked", { blames })));
  record(f, receipt(f, "review", "blocked", { blames: ["impl"] }));
  derive(f); claim(f, "impl-fix-1", "fixer");
  assert.throws(() => record(f, receipt(f, "impl-fix-1", "blocked", { blames: ["impl"] })), /direct dependency/);
});

test("AC-3 a different agent completes the correction; the review is requeued in the same record event", t => {
  const f = blockedReview(t); derive(f);
  const assignment = claim(f, "impl-fix-1", "fixer");
  assert.equal(assignment.runtime, "codex"); assert.equal(assignment.route, "sequential");
  assert.equal(state(f).tasks["impl-fix-1"].attempts, 1);
  const before = state(f).events.length;
  const result = record(f, receipt(f, "impl-fix-1", "done"));
  assert.equal(result.requeued, "review");
  const after = state(f);
  assert.equal(after.events.length, before + 1);
  assert.equal(after.tasks["impl-fix-1"].status, "done");
  assert.deepEqual(after.tasks.review, { status: "queued", attempts: 1, assignment: null, reason: "corrections done: impl-fix-1" });
  assert.equal(after.tasks.impl.status, "done");
  assert.equal(core.main(["next", f.board]).task.id, "review");
});

test("AC-3 a done receipt outside the parent's allowed_files is refused", t => {
  const f = blockedReview(t); derive(f); claim(f, "impl-fix-1", "fixer");
  unchanged(f, () => record(f, receipt(f, "impl-fix-1", "done", { changed_files: ["src/review.js"] })));
});

test("AC-4 the failed reviewer cannot claim the correction and release follows the derived budget", t => {
  const f = blockedReview(t); derive(f);
  unchanged(f, () => claim(f, "impl-fix-1", "rev1"));
  finish(f, "impl-fix-1", "blocked", "fixer");
  release(f, "impl-fix-1");
  finish(f, "impl-fix-1", "blocked", "fixer");
  assert.equal(state(f).tasks["impl-fix-1"].attempts, 2);
  unchanged(f, () => release(f, "impl-fix-1"));
});

test("AC-4/EC-3 the review is frozen while corrections are pending and released again once they are exhausted", t => {
  const f = blockedReview(t); derive(f, { max_attempts: 1 });
  unchanged(f, () => release(f, "review"));
  claim(f, "impl-fix-1", "fixer");
  unchanged(f, () => release(f, "review"));
  record(f, receipt(f, "impl-fix-1", "blocked"));
  assert.equal(state(f).tasks.review.status, "blocked");
  release(f, "review");
  assert.equal(state(f).tasks.review.status, "queued");
});

test("EC-1 two blamed dependencies: one derive per parent and the review requeues when both are done", t => {
  const f = setup(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])]);
  finish(f, "impl", "done", "dev"); finish(f, "lib", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl", "lib"] });
  assert.equal(derive(f).task_id, "impl-fix-1");
  assert.equal(derive(f, { parent: "lib" }).task_id, "lib-fix-1");
  finish(f, "impl-fix-1", "done", "fixer");
  assert.equal(state(f).tasks.review.status, "blocked");
  unchanged(f, () => release(f, "review"));
  finish(f, "lib-fix-1", "done", "fixer");
  assert.equal(state(f).tasks.review.reason, "corrections done: impl-fix-1, lib-fix-1");
});

test("EC-2 a second blocked review derives impl-fix-2 and the requeue gate uses the latest receipt only", t => {
  const f = blockedReview(t); derive(f);
  finish(f, "impl-fix-1", "done", "fixer");
  finish(f, "review", "blocked", "rev2", { blames: ["impl"] });
  assert.equal(derive(f).task_id, "impl-fix-2");
  assert.equal(state(f).derived["impl-fix-2"].cause.assignee, "rev2");
  unchanged(f, () => release(f, "review"));
  claim(f, "impl-fix-2", "rev1"); // the first reviewer is not the cause of this correction
  record(f, receipt(f, "impl-fix-2", "done"));
  assert.equal(state(f).tasks.review.reason, "corrections done: impl-fix-2");
  assert.deepEqual(core.main(["status", f.board]).tasks.map(x => x.id), ["impl", "review", "impl-fix-1", "impl-fix-2"]);
});

test("C-20 ids skip used numbers and fall back to fix-<n> past 80 characters", t => {
  const derived = require("./roster-roadmap-derived.cjs");
  assert.equal(derived.allocateId("impl", new Set(["impl", "impl-fix-1"])), "impl-fix-2");
  const long = "a".repeat(76);
  assert.equal(derived.allocateId(long, new Set([long, "fix-1"])), "fix-2");
});

function derivedBoard(t) {
  const f = blockedReview(t); derive(f); finish(f, "impl-fix-1", "blocked", "fixer"); release(f, "impl-fix-1");
  return f;
}
function tampered(f, change) {
  const value = state(f); change(value); write(f.stateFile, value);
  assert.throws(() => core.main(["status", f.board]));
  assert.throws(() => core.main(["next", f.board]));
}
for (const [label, change] of [
  ["derive event without its definition", s => { delete s.derived["impl-fix-1"]; delete s.tasks["impl-fix-1"]; }],
  ["definition without its event", s => { s.derived["impl-fix-9"] = { ...s.derived["impl-fix-1"], revision: s.revision }; s.tasks["impl-fix-9"] = { status: "queued", attempts: 0, assignment: null, reason: null }; }],
  ["edited cause attempt", s => { s.derived["impl-fix-1"].cause.attempt_id = "forged"; }],
  ["edited cause assignee", s => { s.derived["impl-fix-1"].cause.assignee = "someone"; }],
  ["derived id in state.tasks without definition", s => { s.tasks["impl-fix-7"] = { status: "queued", attempts: 0, assignment: null, reason: null }; }],
  ["lowered derived attempt counter", s => { s.tasks["impl-fix-1"].attempts = 0; }],
  ["EC-4 definition revision differs from its event", s => { s.derived["impl-fix-1"].revision += 1; }],
  ["derived budget above the parent budget", s => { s.derived["impl-fix-1"].max_attempts = 9; }],
  ["unknown definition field", s => { s.derived["impl-fix-1"].note = "x"; }],
  ["renamed derived id", s => { s.derived["impl-fix-5"] = s.derived["impl-fix-1"]; delete s.derived["impl-fix-1"]; s.tasks["impl-fix-5"] = s.tasks["impl-fix-1"]; delete s.tasks["impl-fix-1"]; s.events.forEach(e => { if (e.task_id === "impl-fix-1") e.task_id = "impl-fix-5"; }); s.receipts.forEach(r => { if (r.task_id === "impl-fix-1") r.task_id = "impl-fix-5"; }); }],
  ["claim payload naming the failed reviewer", s => { s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.assignee = "rev1"; s.receipts.find(r => r.task_id === "impl-fix-1").assignee = "rev1"; }],
  ["claim payload disagreeing with its receipt", s => { s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.id = "other"; }],
  ["claim payload with a foreign model", s => { s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.model = "other"; }],
  ["assignment payload on a release event", s => { s.events.find(e => e.action === "release").assignment = s.events.find(e => e.action === "claim").assignment; }],
  ["derived claim payload deleted", s => { delete s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment; }],
  ["derived claim payload deleted and receipt relabelled to the failed reviewer", s => { delete s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment; s.receipts.find(r => r.task_id === "impl-fix-1").assignee = "rev1"; }],
  ["forged review requeue", s => { s.tasks.review = { status: "queued", attempts: 1, assignment: null, reason: "corrections done: impl-fix-1" }; }],
]) test(`AC-5 tampered derived history is refused: ${label}`, t => tampered(derivedBoard(t), change));

test("AC-5 a release of the review hidden in history while corrections were pending is refused on read", t => {
  const f = blockedReview(t); derive(f);
  const value = state(f);
  value.revision++; value.events.push({ revision: value.revision, action: "release", coordinator: "lead", task_id: "review", reason: "Sneak", reconciled_by: "lead", at: new Date().toISOString() });
  value.tasks.review = { status: "queued", attempts: 1, assignment: null, reason: "Sneak" };
  write(f.stateFile, value);
  assert.throws(() => core.main(["status", f.board]), /corrections were pending/);
});

test("AC-5 replay reproduces derived missions and the review requeue; active payload must match", t => {
  const f = blockedReview(t); derive(f); finish(f, "impl-fix-1", "done", "fixer");
  const status = core.main(["status", f.board]);
  assert.deepEqual(status.tasks.map(x => [x.id, x.status, x.attempts]), [["impl", "done", 1], ["review", "queued", 1], ["impl-fix-1", "done", 1]]);
  claim(f, "review", "rev3");
  const value = state(f); value.tasks.review.assignment.assignee = "rev4"; write(f.stateFile, value);
  assert.throws(() => core.main(["status", f.board]), /claim history/);
});

test("AC-5/FR-011 a legacy board without derived and without claim payloads reads and behaves as before", t => {
  const f = setup(t, [task("impl"), task("review", ["impl"])]);
  finish(f, "impl", "done", "dev"); claim(f, "review", "rev1");
  const value = state(f);
  assert.equal(Object.hasOwn(value, "derived"), false);
  for (const event of value.events) delete event.assignment;
  write(f.stateFile, value);
  const status = core.main(["status", f.board]);
  assert.deepEqual(status.tasks.map(x => x.status), ["done", "active"]);
  record(f, receipt(f, "review", "done"));
  assert.equal(core.main(["next", f.board]).status, "global-verification-needed");
  assert.equal(Object.hasOwn(state(f), "derived"), false);
});

test("FR-008 progress, recovery inspection and operator-request binding treat a derived mission as a mission", t => {
  const f = blockedReview(t); derive(f);
  const file = path.join(f.root, "request.json");
  write(file, { id: "fix-key", to: { kind: "role", label: "owner" }, kind: "supply", text: "Provide the fixture", task_id: "impl-fix-1", need: "before-task" });
  assert.equal(core.main(["request-open", f.board, "--coordinator", "lead", "--revision", "0", "--request", file]).requests_revision, 1);
  const a = claim(f, "impl-fix-1", "fixer"), update = path.join(f.root, "update.json");
  write(update, { message: "Running", current_step: "Tests", checks: [{ id: "unit", status: "running", evidence: [] }] });
  assert.equal(core.main(["progress", f.board, "--task", "impl-fix-1", "--attempt", a.id, "--assignee", "fixer", "--sequence", "0", "--update", update]).reported, true);
  const item = core.main(["view", f.board, "--task", "impl-fix-1"]).tasks[0];
  assert.equal(item.progress.status, "reported"); assert.deepEqual(item.requests, ["fix-key"]);
  record(f, receipt(f, "impl-fix-1", "blocked"));
  const recovery = require("./roster-recovery.cjs").inspectBoard(core.readBoard(f.board), "impl-fix-1");
  assert.deepEqual([recovery.attempts, recovery.max_attempts, recovery.consecutive_failures], [1, 2, 1]);
  assert.equal(require("./roster-recovery.cjs").inspectBoard(core.readBoard(f.board), "review").consecutive_failures, 1);
});

test("EC-7/C-11 a later reframe condition leaves earlier derive events valid; the review streak keeps counting", t => {
  const f = setup(t, [task("impl"), task("review", ["impl"], { max_attempts: 5 })]);
  finish(f, "impl", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl"] });
  derive(f, { max_attempts: 1 }); finish(f, "impl-fix-1", "blocked", "fixer");
  release(f, "review"); finish(f, "review", "blocked", "rev1");
  release(f, "review"); finish(f, "review", "blocked", "rev1");
  const recovery = require("./roster-recovery.cjs").inspectBoard(core.readBoard(f.board), "review");
  assert.equal(recovery.reframe_needed, true); assert.equal(recovery.consecutive_failures, 3);
  assert.equal(core.main(["status", f.board]).tasks.find(x => x.id === "impl-fix-1").status, "blocked");
});

test("AC-5 an active derived assignment relabelled to the failed reviewer is refused on read", t => {
  const f = blockedReview(t); derive(f); claim(f, "impl-fix-1", "fixer");
  const value = state(f); value.tasks["impl-fix-1"].assignment.assignee = "rev1";
  value.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.assignee = "rev1";
  write(f.stateFile, value);
  assert.throws(() => core.main(["status", f.board]), /rev1/);
});

test("EC-1 ordering: every blamed dependency must be derived before the first correction is done", t => {
  const f = setup(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])]);
  finish(f, "impl", "done", "dev"); finish(f, "lib", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl", "lib"] });
  derive(f); finish(f, "impl-fix-1", "done", "fixer");
  assert.equal(state(f).tasks.review.reason, "corrections done: impl-fix-1");
  unchanged(f, () => derive(f, { parent: "lib" }));
});

test("FR-006 the receipt check independently refuses the cause assignee on a derived mission", () => {
  const { validateReceiptLinks } = require("./roster-roadmap-derived.cjs");
  const fix = { id: "impl-fix-1", depends_on: [], derived: { parent: "impl", cause: { task_id: "review", attempt_id: "a", assignee: "rev1" }, revision: 5 } };
  assert.throws(() => validateReceiptLinks({ assignee: "rev1", result: "done" }, fix), /rev1/);
  assert.doesNotThrow(() => validateReceiptLinks({ assignee: "fixer", result: "done" }, fix));
  assert.doesNotThrow(() => validateReceiptLinks({ assignee: "rev1", result: "done" }, { id: "impl", depends_on: [] }));
});
