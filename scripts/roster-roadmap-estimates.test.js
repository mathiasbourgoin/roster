"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("./roster-roadmap.cjs");
const estimates = require("./roster-roadmap-estimates.cjs");
const NOW = "2026-12-01T12:00:00.000Z";
const span = (minutes) => ({ optimistic: minutes, likely: minutes, pessimistic: minutes });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const read = file => JSON.parse(fs.readFileSync(file));
function task(id, depends = [], files = [`src/${id}.js`]) {
  return { id, intake: `briefs/${id}.md`, objective: `Deliver ${id}`, depends_on: depends, inputs: [], outputs: [], allowed_files: files,
    dod: ["Checks pass"], success: ["Observable success"], checks: [{ id: "test", description: "Run test" }],
    topology: { runtime: "codex", model: "configured", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] },
    policy: { max_attempts: 4, on_failure: "retry", stop_if: ["Scope changed"], recovery: ["Diagnose"], failure: "Budget exhausted" },
    workflow: { recommendation: "none", reason: "Bounded mission", steps: [] } };
}
function fixture(t, tasks = [task("a")], capacity = 1, parallel = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-estimates-")), board = path.join(root, "board");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  core.main(["init", board, "--id", "demo"]);
  const contract = { schema_version: 1, id: "demo", goal: "Deliver demo", success: ["Integrated success"], global_checks: [{ id: "global", description: "Demo works" }], execution: { max_active: capacity }, tasks };
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: parallel ? { parallel: { supported: true, authorized: true, evidence: ["Explicit permission"] } } : {} } } });
  const decision = path.join(root, "decision.json");
  write(decision, { by: "owner", basis: "Disposable test", contract_digest: core.hash(contract) });
  core.main(["accept", board, "--coordinator", "lead", "--revision", "0", "--decision", decision]);
  return { root, board, contract };
}
function change(f, command, args = []) {
  return core.main([command, f.board, "--coordinator", "lead", "--revision", String(read(path.join(f.board, "state.json")).revision), ...args]);
}
function payload(f, durations, global = span(5)) {
  return { schema_version: 1, contract_digest: core.hash(f.contract), based_on_state_revision: core.readBoard(f.board).state.revision,
    writer: "planner", basis: "Revisited dependency and check scope", evidence: ["notes/planning.md"], updated_at: NOW,
    tasks: Object.fromEntries(Object.entries(durations).map(([id, duration]) => [id, { duration_minutes: typeof duration === "number" ? span(duration) : duration }])), global_verification_minutes: global };
}
function save(f, value, revision = 0) {
  const file = path.join(f.root, "update.json"); write(file, value);
  return estimates.update(f.board, { revision: String(revision), update: file, as_of: NOW });
}
function view(f, at = NOW) { return estimates.forecast(core.readBoard(f.board), { as_of: at }); }
function finish(f, id = "a", result = "done") {
  const assignment = core.readBoard(f.board).state.tasks[id].assignment, file = path.join(f.root, "receipt.json");
  write(file, { task_id: id, attempt_id: assignment.id, assignee: assignment.assignee, contract_digest: assignment.contract_digest,
    result, summary: `Task ${result}`, evidence: ["test-log"], changed_files: [], checks: [{ id: "test", status: result === "done" ? "pass" : "fail", evidence: ["test-log"] }] });
  change(f, "record", ["--receipt", file]);
}
function claimAt(f, id = "a", at = NOW) {
  const assignment = change(f, "claim", ["--task", id, "--assignee", `worker-${id}`]);
  const file = path.join(f.board, "state.json"), state = read(file); state.events.at(-1).at = at; write(file, state);
  return assignment.assignment;
}

test("legacy board has unknown durations, forecast is read-only and no false zero", t => {
  const f = fixture(t), state = fs.readFileSync(path.join(f.board, "state.json"));
  const before = fs.readdirSync(f.board).sort(), result = view(f);
  assert.equal(result.estimate_revision, 0); assert.equal(result.tasks_eta.status, "unknown");
  assert.equal(result.tasks[0].duration_minutes, null); assert.equal(result.tasks_eta.finish_at, null);
  assert.deepEqual(fs.readdirSync(f.board).sort(), before); assert.deepEqual(fs.readFileSync(path.join(f.board, "state.json")), state);
});

test("DAG list scheduling accounts for capacity, dependency branches and global phase", t => {
  for (const [capacity, expected] of [[1, 70], [2, 40]]) {
    const f = fixture(t, [task("a"), task("b"), task("c", ["a"]), task("d", ["b"])], capacity, true);
    save(f, payload(f, { a: 10, b: 30, c: 20, d: 10 }));
    assert.equal(view(f).tasks_eta.remaining_minutes.likely, expected);
    assert.equal(view(f).global_eta.remaining_minutes.likely, expected + 5);
  }
});

test("capacity does not fabricate parallel permission or ignore overlapping writes", t => {
  const sequential = fixture(t, [task("a"), task("b")], 2);
  save(sequential, payload(sequential, { a: 10, b: 20 }));
  assert.equal(view(sequential).tasks_eta.remaining_minutes.likely, 30);
  const overlap = fixture(t, [task("a", [], ["src/"]), task("b")], 2, true);
  save(overlap, payload(overlap, { a: 10, b: 20 }));
  assert.equal(view(overlap).tasks_eta.remaining_minutes.likely, 30);
});

test("active timestamp anchors finish date across polls rather than resetting duration", t => {
  const f = fixture(t); claimAt(f); save(f, payload(f, { a: { optimistic: 20, likely: 30, pessimistic: 40 } }));
  const first = view(f, "2026-12-01T12:05:00.000Z"), second = view(f, "2026-12-01T12:10:00.000Z");
  assert.equal(first.tasks_eta.finish_at.likely, "2026-12-01T12:30:00.000Z");
  assert.equal(second.tasks_eta.finish_at.likely, first.tasks_eta.finish_at.likely);
  assert.equal(second.tasks[0].remaining_minutes.likely, 20);
  const overdue = view(f, "2026-12-01T12:41:00.000Z");
  assert.equal(overdue.tasks[0].overdue, true); assert.equal(overdue.tasks[0].reestimate_needed, true);
  assert.equal(overdue.tasks_eta.status, "unknown");
});

test("legacy active claim age is unknown until an attempt-bound remaining capture", t => {
  const f = fixture(t), assignment = claimAt(f);
  const stateFile = path.join(f.board, "state.json"), state = read(stateFile); delete state.events.at(-1).at; write(stateFile, state);
  save(f, payload(f, { a: 30 })); assert.equal(view(f).tasks_eta.status, "unknown");
  const update = payload(f, { a: 30 });
  update.tasks.a.remaining = { attempt_id: assignment.id, as_of: NOW, minutes: span(12) };
  save(f, update, 1);
  assert.equal(view(f, "2026-12-01T12:03:00.000Z").tasks_eta.finish_at.likely, "2026-12-01T12:12:00.000Z");
});

test("remaining override is invalid for a new attempt and cannot drift into its ETA", t => {
  const f = fixture(t), assignment = claimAt(f), update = payload(f, { a: 20 });
  update.tasks.a.remaining = { attempt_id: assignment.id, as_of: NOW, minutes: span(10) }; save(f, update);
  finish(f, "a", "blocked"); change(f, "release", ["--task", "a", "--reason", "Diagnosed", "--reconciled-by", "lead"]); claimAt(f);
  const result = view(f); assert.equal(result.tasks_eta.status, "unknown");
  assert.match(result.tasks[0].reasons.join(" "), /different attempt/);
});

test("completed work is zero, missing global estimate cannot imply global completion", t => {
  const f = fixture(t); save(f, payload(f, { a: 10 }, null)); claimAt(f); finish(f);
  const result = view(f); assert.equal(result.tasks_eta.status, "complete");
  assert.equal(result.tasks[0].remaining_minutes.likely, 0); assert.equal(result.global_eta.status, "unknown");
  assert.match(result.global_eta.reasons.join(" "), /global verification/);
});

test("blocked and unauthorized routes produce unknown ETA with specific reasons", t => {
  const f = fixture(t); save(f, payload(f, { a: 10 })); claimAt(f); finish(f, "a", "blocked");
  assert.equal(view(f).tasks_eta.status, "unknown");
  const unavailable = task("a"); unavailable.topology.route = "subagent";
  const g = fixture(t, [unavailable]); save(g, payload(g, { a: 10 }));
  assert.match(view(g).tasks_eta.reasons.join(" "), /unsupported|unauthorized/);
});

test("revisions preserve history independently of execution state and reject stale updates", t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.board, "state.json"));
  save(f, payload(f, { a: 10 })); save(f, payload(f, { a: 20 }), 1);
  const file = path.join(f.board, "estimates.json"), bytes = fs.readFileSync(file);
  assert.equal(read(file).revisions.length, 2); assert.equal(read(file).revisions[0].tasks.a.duration_minutes.likely, 10);
  assert.throws(() => save(f, payload(f, { a: 30 }), 1), /stale forecast/);
  assert.deepEqual(fs.readFileSync(file), bytes); assert.deepEqual(fs.readFileSync(path.join(f.board, "state.json")), before);
});

test("invalid contracts, capture revisions, ranges, actor evidence and locks refuse without writes", t => {
  const f = fixture(t); save(f, payload(f, { a: 10 }));
  const file = path.join(f.board, "estimates.json"), bytes = fs.readFileSync(file);
  for (const corrupt of [p => { p.contract_digest = "0".repeat(64); }, p => { p.based_on_state_revision--; },
    p => { p.tasks.a.duration_minutes.likely = -1; }, p => { p.evidence = []; }, p => { p.writer = ""; }, p => { p.unknown = true; }]) {
    const update = payload(f, { a: 10 }); corrupt(update); assert.throws(() => save(f, update, 1));
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  fs.mkdirSync(path.join(f.board, ".lock")); assert.throws(() => save(f, payload(f, { a: 10 }), 1), /lock unavailable/);
  fs.rmdirSync(path.join(f.board, ".lock"));
});

test("stale estimate contract, malformed sidecar and future capture never invent dates", t => {
  const f = fixture(t); save(f, payload(f, { a: 10 }));
  const file = path.join(f.board, "estimates.json"), store = read(file);
  store.revisions[0].contract_digest = "0".repeat(64); write(file, store);
  assert.equal(view(f).tasks_eta.finish_at, null); assert.match(view(f).tasks_eta.reasons.join(" "), /stale/);
  fs.writeFileSync(file, "{bad"); assert.equal(view(f).status, "unknown");
  fs.unlinkSync(file); save(f, payload(f, { a: 10 }));
  assert.equal(view(f, "2026-12-01T11:00:00.000Z").tasks_eta.status, "unknown");
});

test("sidecar links are refused and prior bytes survive invalid remaining identities", t => {
  const f = fixture(t), assignment = claimAt(f); save(f, payload(f, { a: 10 }));
  const file = path.join(f.board, "estimates.json"), before = fs.readFileSync(file);
  const update = payload(f, { a: 10 }); update.tasks.a.remaining = { attempt_id: `${assignment.id}-stale`, as_of: NOW, minutes: span(5) };
  assert.throws(() => save(f, update, 1), /active attempt/); assert.deepEqual(fs.readFileSync(file), before);
  const target = path.join(f.root, "sentinel.json"); fs.renameSync(file, target); fs.symlinkSync(target, file);
  assert.throws(() => save(f, payload(f, { a: 10 }), 1), /symlink/); assert.deepEqual(fs.readFileSync(target), before);
});

test("separate accepted global receipt makes both phases complete without inventing completion dates", t => {
  const f = fixture(t); save(f, payload(f, { a: 10 })); claimAt(f); finish(f);
  const state = core.readBoard(f.board).state, file = path.join(f.root, "global.json");
  write(file, { contract_digest: core.hash(f.contract), state_revision: state.revision, summary: "Integrated demonstration", evidence: ["integration-log"], checks: [{ id: "global", status: "pass", evidence: ["integration-log"] }] });
  change(f, "complete", ["--receipt", file]);
  const result = view(f); assert.equal(result.status, "complete"); assert.equal(result.tasks_eta.status, "complete");
  assert.equal(result.global_eta.remaining_minutes.likely, 0); assert.equal(result.global_eta.finish_at, null);
});

test("history cap refuses aggregate growth without losing its prior accepted revision", t => {
  const f = fixture(t), first = payload(f, { a: 10 }); first.evidence = ["x".repeat(9 * 1024 * 1024)];
  save(f, first); const file = path.join(f.board, "estimates.json"), before = fs.readFileSync(file);
  assert.throws(() => save(f, first, 1), /16 MiB/);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(view(f).estimate_revision, 1);
});

test("duration uncertainty remains visible and omitted special-name mission is unknown", t => {
  const f = fixture(t); save(f, payload(f, { a: { optimistic: 5, likely: 10, pessimistic: 20 } }));
  assert.deepEqual(view(f).global_eta.remaining_minutes, { optimistic: 10, likely: 15, pessimistic: 25 });
  const g = fixture(t, [task("constructor")]); save(g, payload(g, {}));
  assert.equal(view(g).tasks[0].duration_minutes, null); assert.match(view(g).tasks[0].reasons.join(" "), /missing/);
});

test("active capability drift cannot forecast a result that receipt acceptance would reject", t => {
  const f = fixture(t); claimAt(f); save(f, payload(f, { a: 20 }));
  const capFile = path.join(f.board, "capabilities.json"), capabilities = read(capFile);
  capabilities.runtimes.codex.available = false; write(capFile, capabilities);
  const before = fs.readFileSync(path.join(f.board, "state.json")), result = view(f);
  assert.equal(result.tasks_eta.status, "unknown"); assert.equal(result.global_eta.finish_at, null);
  assert.equal(result.tasks[0].remaining_minutes, null); assert.match(result.tasks[0].reasons.join(" "), /capabilities changed/);
  assert.throws(() => finish(f), /capabilities changed/);
  assert.deepEqual(fs.readFileSync(path.join(f.board, "state.json")), before);
});

test("active assigned route must still be observed available even with a matching local digest", t => {
  const a = task("a"); a.topology.route = "subagent";
  const f = fixture(t, [a]);
  const capFile = path.join(f.board, "capabilities.json"), capabilities = read(capFile);
  capabilities.runtimes.codex.capabilities.subagent = { supported: true, authorized: true, evidence: ["Observed delegation"] };
  write(capFile, capabilities); claimAt(f); save(f, payload(f, { a: 20 }));
  capabilities.runtimes.codex.capabilities.subagent.authorized = false; write(capFile, capabilities);
  const stateFile = path.join(f.board, "state.json"), state = read(stateFile);
  state.tasks.a.assignment.capabilities_digest = core.hash(capabilities); write(stateFile, state);
  const result = view(f); assert.equal(result.tasks_eta.status, "unknown");
  assert.match(result.tasks[0].reasons.join(" "), /route.*unavailable or unauthorized/);
  assert.equal(result.tasks_eta.finish_at, null);
});

test("backdated planner capture refuses before persistence and preserves readable history", t => {
  const f = fixture(t); save(f, payload(f, { a: 10 }));
  const file = path.join(f.board, "estimates.json"), before = fs.readFileSync(file);
  const update = payload(f, { a: 15 }); update.updated_at = "2026-12-01T11:59:00.000Z";
  assert.throws(() => save(f, update, 1), /timestamps must be ordered/);
  assert.deepEqual(fs.readFileSync(file), before);
  const result = view(f); assert.equal(result.estimate_revision, 1); assert.equal(result.tasks_eta.status, "conditional");
  assert.equal(result.tasks[0].duration_minutes.likely, 10);
  assert.equal(fs.existsSync(path.join(f.board, ".lock")), false);
});

test("public forecast handles unaccepted filled and empty drafts without fake queued completion", t => {
  const f = fixture(t), file = path.join(f.board, "state.json");
  write(file, { schema_version: 1, board_id: f.contract.id, revision: 0, coordinator: null, acceptance: null, tasks: {}, receipts: [], events: [], global_receipt: null });
  const before = fs.readFileSync(file), result = estimates.forecast(core.readBoard(f.board), { as_of: NOW });
  assert.equal(result.tasks_eta.status, "unknown"); assert.equal(result.tasks[0].status, "draft");
  assert.equal(result.tasks_eta.finish_at, null); assert.match(result.tasks_eta.reasons.join(" "), /not accepted/);
  f.contract.tasks[0].id = "constructor"; write(path.join(f.board, "roadmap.json"), f.contract);
  const special = estimates.forecast(core.readBoard(f.board), { as_of: NOW });
  assert.equal(special.tasks[0].status, "draft"); assert.equal(special.tasks_eta.finish_at, null);
  f.contract.tasks = []; write(path.join(f.board, "roadmap.json"), f.contract);
  const empty = estimates.forecast(core.readBoard(f.board, true), { as_of: NOW });
  assert.equal(empty.tasks_eta.status, "unknown"); assert.equal(empty.status, "unknown");
  assert.deepEqual(fs.readFileSync(file), before);
});
