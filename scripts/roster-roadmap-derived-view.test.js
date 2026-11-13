"use strict";
// CHECK-2 (specs/roadmap-derived-missions.md): AC-6..AC-8, EC-5, EC-9 and view schema validation.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("./roster-roadmap.cjs");
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
function task(id, deps = []) {
  return { id, intake: `briefs/${id}.md`, objective: `Deliver ${id}`, depends_on: deps, inputs: [], outputs: [`src/${id}.js`], allowed_files: [`src/${id}.js`],
    dod: ["Checks pass"], success: [`${id} works`], checks: [{ id: "unit", description: "Unit checks pass" }],
    topology: { runtime: "codex", model: "configured", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] },
    policy: { max_attempts: 3, on_failure: "retry", stop_if: ["Scope changed"], recovery: ["Diagnose"], failure: "Budget exhausted" },
    workflow: { recommendation: "none", reason: "Bounded mission", steps: [] } };
}
const TOPOLOGY = { runtime: "codex", model: "opus", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] };
function accepted(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-derived-view-")), board = path.join(root, "board");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  core.main(["init", board, "--id", "demo"]);
  const contract = { schema_version: 1, id: "demo", goal: "Deliver demo", success: ["Integrated"], global_checks: [{ id: "global", description: "Demo works" }], execution: { max_active: 1 }, tasks: [task("impl"), task("review", ["impl"])] };
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: {} } } });
  const decision = path.join(root, "decision.json");
  write(decision, { by: "owner", basis: "Disposable test", contract_digest: core.hash(contract) });
  core.main(["accept", board, "--coordinator", "lead", "--revision", "0", "--decision", decision]);
  return { root, board, stateFile: path.join(board, "state.json"), contract };
}
function setup(t, beforeImpl = () => {}) {
  const f = accepted(t), { root } = f;
  beforeImpl(f);
  finish(f, "impl", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl"] });
  const request = path.join(root, "derive.json");
  write(request, { parent: "impl", cause: "review", objective: "Fix the null check", topology: TOPOLOGY, max_attempts: 3 });
  cmd(f, "derive", ["--request", request]);
  return f;
}
const state = f => read(f.stateFile);
const cmd = (f, command, args = []) => core.main([command, f.board, "--coordinator", "lead", "--revision", String(state(f).revision), ...args]);
const claim = (f, id, assignee) => cmd(f, "claim", ["--task", id, "--assignee", assignee]).assignment;
function finish(f, id, result, assignee, extra = {}) {
  const a = claim(f, id, assignee), file = path.join(f.root, "receipt.json");
  write(file, { task_id: id, attempt_id: a.id, assignee, contract_digest: a.contract_digest, result, summary: `${id} ${result}`, evidence: ["log"],
    changed_files: [], checks: [{ id: "unit", status: result === "done" ? "pass" : "fail", evidence: ["log"] }], ...extra });
  return cmd(f, "record", ["--receipt", file]);
}
const release = (f, id) => cmd(f, "release", ["--task", id, "--reason", "Reconciled", "--reconciled-by", "lead"]);
// claim -> release (active), claim -> blocked, release (blocked: not an attempt), claim -> done.
// Each attempt is a newly launched agent (fresh-context rule on the correction chain).
const FIXERS = ["fixer1", "fixer2", "fixer3"];
function corrected(t, beforeImpl) {
  const f = setup(t, beforeImpl);
  claim(f, "impl-fix-1", FIXERS[0]); release(f, "impl-fix-1");
  finish(f, "impl-fix-1", "blocked", FIXERS[1]); release(f, "impl-fix-1");
  finish(f, "impl-fix-1", "done", FIXERS[2]);
  return f;
}
function check(schema, value, root, where = "$") {
  if (schema.$ref) return check(schema.$ref.split("/").slice(1).reduce((s, k) => s[k], root), value, root, where);
  const errors = [], kind = v => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${where}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where}: enum`);
  if (schema.type) {
    const ok = schema.type === "number" ? typeof value === "number" : kind(value) === schema.type;
    if (!ok) { errors.push(`${where}: type ${schema.type}`); return errors; }
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${where}: pattern`);
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${where}: minimum`);
  if (schema.anyOf && !schema.anyOf.some(option => !check(option, value, root, where).length)) errors.push(`${where}: anyOf`);
  if (kind(value) === "object") {
    for (const name of schema.required || []) if (!Object.hasOwn(value, name)) errors.push(`${where}: missing ${name}`);
    for (const [name, item] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, name)) errors.push(...check(schema.properties[name], item, root, `${where}.${name}`));
      else if (schema.additionalProperties === false) errors.push(`${where}: unexpected ${name}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...check(schema.additionalProperties, item, root, `${where}.${name}`));
    }
  }
  if (kind(value) === "array" && schema.items) value.forEach((item, i) => errors.push(...check(schema.items, item, root, `${where}[${i}]`)));
  return errors;
}
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, "../schema/roadmap-view.schema.json"), "utf8"));
const validView = view => check(SCHEMA, view, SCHEMA);

test("AC-6 view lists derived missions after contract tasks with kind, derived block and corrections", t => {
  const f = corrected(t), view = core.main(["view", f.board]), s = state(f);
  assert.deepEqual(view.tasks.map(x => [x.id, x.kind]), [["impl", "contract"], ["review", "contract"], ["impl-fix-1", "derived"]]);
  const fix = view.tasks[2], cause = s.derived["impl-fix-1"].cause;
  assert.deepEqual(fix.derived, { parent: "impl", cause, created_at: s.events.find(e => e.action === "derive").at });
  assert.deepEqual(view.tasks.map(x => x.corrections), [["impl-fix-1"], [], []]);
  assert.equal(view.tasks[0].derived, null);
  assert.deepEqual(fix.outputs, ["src/impl.js"]); assert.equal(fix.topology.model, "opus"); assert.deepEqual(fix.depends_on, []);
  assert.deepEqual(view.completion, { tasks_done: 1, tasks_total: 2, derived_done: 1, derived_total: 1, derived_active: 0, derived_blocked: 0, global_accepted: false });
  assert.deepEqual(validView(view), []);
});

test("AC-6 timeline entries carry attempts, identities, times and outcomes in claim order", t => {
  const f = corrected(t), view = core.main(["view", f.board]), s = state(f);
  const claims = s.events.filter(e => e.action === "claim" && e.task_id === "impl-fix-1");
  const fix = view.tasks[2].timeline;
  assert.deepEqual(fix.map(x => [x.attempt, x.outcome]), [[1, "released"], [2, "blocked"], [3, "done"]]);
  assert.equal(fix[0].attempt_id, claims[0].assignment.id);
  assert.deepEqual(fix.map(x => x.attempt_id), [claims[0].assignment.id, s.receipts[2].attempt_id, s.receipts[3].attempt_id]);
  for (const [i, entry] of fix.entries()) {
    assert.deepEqual([entry.assignee, entry.runtime, entry.route, entry.model], [FIXERS[i], "codex", "sequential", "opus"]);
    assert.equal(entry.claimed_at, claims[i].at); assert.ok(entry.ended_at >= entry.claimed_at);
  }
  assert.deepEqual(view.tasks[1].timeline.map(x => [x.attempt, x.assignee, x.outcome, x.model]), [[1, "rev1", "blocked", "configured"]]);
  assert.equal(view.tasks[1].state, "queued");
  claim(f, "review", "rev2");
  const active = core.main(["view", f.board]).tasks[1].timeline.at(-1);
  assert.deepEqual([active.attempt, active.outcome, active.ended_at], [2, "active", null]);
});

test("EC-5 legacy events without at or assignment leave timeline fields null, never guessed", t => {
  const f = corrected(t, board => { claim(board, "impl", "dev0"); release(board, "impl"); });
  claim(f, "review", "rev2"); release(f, "review");
  const s = state(f);
  // Every claim of a review family must keep its payload (FR-021), so only the times are legacy here.
  for (const event of s.events) delete event.at;
  write(f.stateFile, s);
  const view = core.main(["view", f.board]), review = view.tasks[1], fix = view.tasks[2];
  assert.equal(fix.derived.created_at, null);
  assert.deepEqual({ ...view.tasks[0].timeline[0], attempt_id: null }, { attempt: 1, attempt_id: null, assignee: "dev0", runtime: "codex", route: "sequential", model: "configured", claimed_at: null, ended_at: null, outcome: "released" });
  assert.deepEqual({ ...review.timeline[1], attempt_id: null }, { attempt: 2, attempt_id: null, assignee: "rev2", runtime: "codex", route: "sequential", model: "configured", claimed_at: null, ended_at: null, outcome: "released" });
  assert.deepEqual([fix.timeline[0].outcome, fix.timeline[0].runtime, fix.timeline[0].claimed_at, fix.timeline[0].ended_at], ["released", "codex", null, null]);
  assert.deepEqual(validView(view), []);
  // A board without derived missions may still hold claims written by an older runtime.
  const legacy = accepted(t);
  claim(legacy, "impl", "dev0"); release(legacy, "impl"); finish(legacy, "impl", "blocked", "dev1");
  const old = state(legacy);
  for (const event of old.events) { delete event.at; delete event.assignment; }
  write(legacy.stateFile, old);
  const lines = core.main(["view", legacy.board]).tasks[0].timeline;
  assert.deepEqual(lines[0], { attempt: 1, attempt_id: null, assignee: null, runtime: null, route: null, model: null, claimed_at: null, ended_at: null, outcome: "released" });
  assert.deepEqual([lines[1].attempt_id, lines[1].assignee, lines[1].runtime, lines[1].claimed_at], [old.receipts[0].attempt_id, "dev1", null, null]);
});

test("AC-6 an earlier saved view without the new fields still validates", t => {
  const view = core.main(["view", corrected(t).board]);
  for (const name of ["derived_done", "derived_total", "derived_active", "derived_blocked"]) delete view.completion[name];
  view.tasks = view.tasks.map(({ kind, derived, corrections, timeline, ...rest }) => rest);
  assert.deepEqual(validView(view), []);
  const broken = core.main(["view", corrected(t).board]); broken.tasks[0].timeline[0].surprise = 1;
  assert.ok(validView(broken).length);
});

test("AC-7 text status shows the derived mission with its parent and cause", t => {
  const f = setup(t), cause = state(f).derived["impl-fix-1"].cause;
  const text = core.main(["status", f.board, "--format", "text"]);
  assert.match(text, /\[queued\] impl-fix-1 — Fix the null check/);
  assert.ok(text.includes(`Derived correction of impl; cause: review attempt ${cause.attempt_id} by rev1`), text);
  assert.match(text, /Corrections: impl-fix-1/);
  assert.match(text, /Corrections: 0\/1 done/);
});

test("AC-7 forecasts are unknown while a derived mission is queued or active, naming it", t => {
  const f = setup(t);
  const estimates = path.join(f.root, "estimates.json"), now = new Date().toISOString();
  const range = { optimistic: 1, likely: 2, pessimistic: 3 };
  const update = tasks => { write(estimates, { schema_version: 1, contract_digest: core.hash(f.contract), based_on_state_revision: state(f).revision, writer: "planner", basis: "test", evidence: ["e"], updated_at: now, tasks, global_verification_minutes: range });
    return core.main(["estimate", f.board, "--revision", "0", "--update", estimates]); };
  assert.throws(() => update({ "impl-fix-1": { duration_minutes: range } }), /unknown fields/);
  update({ impl: { duration_minutes: range }, review: { duration_minutes: range } });
  for (const phase of ["queued", "active"]) {
    if (phase === "active") claim(f, "impl-fix-1", "fixer");
    const forecast = core.main(["view", f.board]).estimates;
    assert.equal(forecast.tasks_eta.status, "unknown"); assert.match(forecast.tasks_eta.reasons[0], /impl-fix-1/);
    assert.equal(forecast.global_eta.status, "unknown"); assert.match(forecast.global_eta.reasons[0], /impl-fix-1/);
  }
  assert.match(core.main(["status", f.board, "--format", "text"]), /ETA: unknown — derived correction mission\(s\) not done: impl-fix-1/);
});

test("AC-8 next selects the derived mission, prompt renders it with a derived block, complete is refused", t => {
  const f = setup(t);
  const next = core.main(["next", f.board]);
  assert.equal(next.status, "ready"); assert.equal(next.task.id, "impl-fix-1");
  const prompt = JSON.parse(core.main(["prompt", f.board, "--task", "impl-fix-1"]).prompt), mission = prompt.mission;
  assert.equal(mission.objective, "Fix the null check"); assert.deepEqual(mission.allowed_files, ["src/impl.js"]);
  assert.deepEqual(mission.checks, f.contract.tasks[0].checks); assert.deepEqual(mission.topology, TOPOLOGY);
  assert.deepEqual(mission.derived, { parent: "impl", cause: state(f).derived["impl-fix-1"].cause, created_at: state(f).events.at(-1).at });
  assert.equal(JSON.parse(core.main(["prompt", f.board, "--task", "impl"]).prompt).mission.derived, undefined);
  const review = core.main(["status", f.board]).tasks.find(x => x.id === "review");
  assert.match(review.next_action, /impl-fix-1/);
  const file = path.join(f.root, "global.json");
  write(file, { contract_digest: core.hash(f.contract), state_revision: state(f).revision, summary: "Done", evidence: ["e"], checks: [{ id: "global", status: "pass", evidence: ["e"] }] });
  assert.throws(() => cmd(f, "complete", ["--receipt", file]), /no derived mission queued or active/);
});

test("EC-9 view --task on a derived mission returns its item with board-wide counts", t => {
  const f = setup(t), view = core.main(["view", f.board, "--task", "impl-fix-1"]);
  assert.deepEqual(view.tasks.map(x => x.id), ["impl-fix-1"]);
  assert.deepEqual(view.counts, { queued: 1, active: 0, blocked: 1, done: 1 });
  assert.deepEqual(view.completion, { tasks_done: 1, tasks_total: 2, derived_done: 0, derived_total: 1, derived_active: 0, derived_blocked: 0, global_accepted: false });
  assert.deepEqual(validView(view), []);
});

test("after the correction the review continues and the roadmap completes globally", t => {
  const f = corrected(t);
  assert.equal(core.main(["next", f.board]).task.id, "review");
  finish(f, "review", "done", "rev2");
  assert.equal(core.main(["next", f.board]).status, "global-verification-needed");
  const file = path.join(f.root, "global.json");
  write(file, { contract_digest: core.hash(f.contract), state_revision: state(f).revision, summary: "Done", evidence: ["e"], checks: [{ id: "global", status: "pass", evidence: ["e"] }] });
  cmd(f, "complete", ["--receipt", file]);
  assert.equal(core.main(["next", f.board]).status, "complete");
  assert.equal(core.main(["view", f.board]).estimates.global_eta.status, "complete");
});
