"use strict";
// CHECK-1 (specs/roadmap-derived-missions.md): AC-1..AC-5, FR-001/FR-003 refusals, tamper cases,
// EC-1, EC-2, EC-3, EC-8.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { core, write, read, task, TOPOLOGY, setup, state, cmd, claim, receipt, record, finish, release, request, derive, blockedReview, unchanged, tampered } = require("./roster-roadmap-derived.fixture.js");
const CLI = path.join(__dirname, "roster-roadmap.cjs");

test("AC-1 derive from a blaming blocked review receipt records definition, queued state and one event (real CLI)", t => {
  const f = blockedReview(t), before = state(f), roadmap = fs.readFileSync(f.roadmapFile);
  const out = spawnSync(process.execPath, [CLI, "derive", f.board, "--coordinator", "lead", "--revision", String(before.revision), "--request", request(f)], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout);
  assert.equal(JSON.parse(out.stdout).task_id, "impl-fix-1");
  const after = state(f), cause = before.receipts.at(-1);
  assert.deepEqual(after.derived["impl-fix-1"], { parent: "impl", cause: { task_id: "review", attempt_id: cause.attempt_id, assignee: "rev1" }, objective: "Fix the null check", topology: TOPOLOGY, max_attempts: 2, revision: before.revision + 1 });
  assert.deepEqual(after.tasks["impl-fix-1"], { status: "queued", attempts: 0, assignment: null, reason: null });
  assert.equal(after.events.length, before.events.length + 1);
  assert.deepEqual({ ...after.events.at(-1), at: null, definition_digest: null }, { revision: before.revision + 1, action: "derive", coordinator: "lead", task_id: "impl-fix-1", reason: null, reconciled_by: null, at: null, definition_digest: null });
  assert.deepEqual(after.tasks.impl, before.tasks.impl); assert.deepEqual(after.tasks.review, before.tasks.review);
  assert.deepEqual(after.receipts, before.receipts);
  assert.deepEqual(fs.readFileSync(f.roadmapFile), roadmap);
});

test("AC-2 derive refuses without blames, with another blamed dependency, or with a malformed request", t => {
  const unblamed = blockedReview(t, undefined, null);
  unchanged(unblamed, () => derive(unblamed), /latest receipt of review does not blame impl/);
  const other = blockedReview(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])], ["lib"]);
  unchanged(other, () => derive(other), /latest receipt of review does not blame impl/);
  const f = blockedReview(t);
  const budget = /request\.max_attempts must be an integer in 1\.\.3/;
  for (const [bad, pattern] of [[{ extra: 1 }, /derive request: unknown field extra/], [{ objective: "" }, /request\.objective must be a nonempty string/],
    [{ objective: "x".repeat(2001) }, /request\.objective exceeds 2000 characters/], [{ max_attempts: 0 }, budget], [{ max_attempts: 4 }, budget], [{ max_attempts: 1.5 }, budget],
    [{ topology: { ...TOPOLOGY, runtime: "unknown" } }, /request\.topology\.runtime must be one of/], [{ topology: { ...TOPOLOGY, route: "workflow" } }, /workflow route needs accepted nonempty workflow steps/],
    [{ parent: "missing" }, /parent missing is not a contract task/], [{ cause: "impl-fix-1" }, /cause impl-fix-1 is not a contract task/]]) unchanged(f, () => derive(f, bad), pattern);
  const file = request(f); const value = read(file); delete value.max_attempts; write(file, value);
  unchanged(f, () => cmd(f, "derive", ["--request", file]), /derive request: missing field max_attempts/);
  unchanged(f, () => core.main(["derive", f.board, "--coordinator", "stranger", "--revision", String(state(f).revision), "--request", request(f)]), /foreign coordinator/);
});

test("AC-2 every FR-003 precondition refuses without mutation", t => {
  const queued = setup(t); finish(queued, "impl", "done", "dev");
  unchanged(queued, () => derive(queued), /cause review is queued, not blocked/);
  const parentNotDependency = blockedReview(t, [task("impl"), task("other"), task("review", ["impl"])]);
  unchanged(parentNotDependency, () => derive(parentNotDependency, { parent: "other" }), /other is not a direct dependency of review/);
  const blocking = blockedReview(t, [task("impl"), task("review", ["impl"], { on_failure: "block" })]);
  unchanged(blocking, () => derive(blocking), /cause review policy does not authorize retry/);
  const exhausted = blockedReview(t, [task("impl"), task("review", ["impl"], { max_attempts: 1 })]);
  unchanged(exhausted, () => derive(exhausted), /cause review attempt budget exhausted/);
  const twice = blockedReview(t); derive(twice);
  unchanged(twice, () => derive(twice), /correction impl-fix-1 already exists for impl and this receipt of review and is pending/);
  const otherDone = blockedReview(t, [task("impl"), task("other"), task("review", ["impl"])]); finish(otherDone, "other", "done", "dev");
  unchanged(otherDone, () => derive(otherDone, { parent: "other" }), /other is not a direct dependency of review/);
  const draft = setup(t, undefined, false);
  assert.throws(() => core.main(["derive", draft.board, "--coordinator", "lead", "--revision", "0", "--request", request(draft)]), /not accepted/);
});

test("AC-2 a cause that needs a recovery reframe cannot derive (live-only check)", t => {
  const f = setup(t, [task("impl"), task("review", ["impl"], { max_attempts: 5 })]);
  finish(f, "impl", "done", "dev");
  // Only the last receipt blames: a blamed receipt without a done correction cannot be released (OD-3).
  for (let i = 0; i < 3; i++) { if (i) release(f, "review"); finish(f, "review", "blocked", "rev1", i === 2 ? { blames: ["impl"] } : {}); }
  assert.throws(() => derive(f), /reframe/);
});

test("AC-2 FR-001 blames misuse and EC-8 blames on a derived receipt are refused", t => {
  const f = setup(t, [task("impl"), task("other"), task("review", ["impl"])]);
  claim(f, "impl");
  assert.throws(() => record(f, receipt(f, "impl", "done", { blames: ["impl"] })), /receipt\.blames is allowed only on a blocked receipt/);
  record(f, receipt(f, "impl", "done"));
  claim(f, "review", "rev1");
  for (const [blames, pattern] of [[[], /receipt\.blames must be a nonempty array/], [["impl", "impl"], /receipt\.blames contains duplicates/], [["other"], /names other, which is not a direct dependency of review/],
    ["impl", /receipt\.blames must be a nonempty array/], [["bad id"], /receipt\.blames entry must be a safe identifier/]]) assert.throws(() => record(f, receipt(f, "review", "blocked", { blames })), pattern);
  record(f, receipt(f, "review", "blocked", { blames: ["impl"] }));
  derive(f); claim(f, "impl-fix-1", "fixer");
  assert.throws(() => record(f, receipt(f, "impl-fix-1", "blocked", { blames: ["impl"] })), /names impl, which is not a direct dependency of impl-fix-1/);
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
  unchanged(f, () => record(f, receipt(f, "impl-fix-1", "done", { changed_files: ["src/review.js"] })), /reported write outside allowed_files: src\/review\.js/);
});

test("AC-4 the failed reviewer cannot claim the correction and release follows the derived budget", t => {
  const f = blockedReview(t); derive(f);
  unchanged(f, () => claim(f, "impl-fix-1", "rev1"), /assignee rev1 produced the failed cause receipt/);
  finish(f, "impl-fix-1", "blocked", "fixer");
  release(f, "impl-fix-1");
  finish(f, "impl-fix-1", "blocked", "fixer2");
  assert.equal(state(f).tasks["impl-fix-1"].attempts, 2);
  unchanged(f, () => release(f, "impl-fix-1"), /attempt budget exhausted; revise the roadmap explicitly/);
});

test("AC-4/EC-3 OD-3 strict: the review release is refused while its correction is pending and after it is exhausted", t => {
  const f = blockedReview(t);
  unchanged(f, () => release(f, "review"), /derive a correction for impl/);
  derive(f, { max_attempts: 1 });
  unchanged(f, () => release(f, "review"), /claim correction impl-fix-1 of impl with a newly launched agent/);
  claim(f, "impl-fix-1", "fixer");
  unchanged(f, () => release(f, "review"), /finish the active attempt of correction impl-fix-1 of impl/);
  record(f, receipt(f, "impl-fix-1", "blocked"));
  assert.equal(state(f).tasks.review.status, "blocked");
  unchanged(f, () => release(f, "review"), /no correction of impl succeeded \(impl-fix-1 exhausted\): derive a new correction for impl/);
  assert.match(core.main(["status", f.board]).tasks.find(x => x.id === "review").next_action, /no correction of impl succeeded \(impl-fix-1 exhausted\): derive a new correction for impl/);
});

test("EC-1 two blamed dependencies: one derive per parent and the review requeues when both are done", t => {
  const f = setup(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])]);
  finish(f, "impl", "done", "dev"); finish(f, "lib", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl", "lib"] });
  assert.equal(derive(f).task_id, "impl-fix-1");
  assert.equal(derive(f, { parent: "lib" }).task_id, "lib-fix-1");
  finish(f, "impl-fix-1", "done", "fixer");
  assert.equal(state(f).tasks.review.status, "blocked");
  unchanged(f, () => release(f, "review"), /claim correction lib-fix-1 of lib with a newly launched agent/);
  unchanged(f, () => claim(f, "lib-fix-1", "fixer"), /already appeared on the correction chain/); // OD-4: family of the review
  finish(f, "lib-fix-1", "done", "fixer2");
  assert.equal(state(f).tasks.review.reason, "corrections done: impl-fix-1, lib-fix-1");
});

test("EC-2 a second blocked review derives impl-fix-2 and the requeue gate uses the latest receipt only", t => {
  const f = blockedReview(t); derive(f);
  finish(f, "impl-fix-1", "done", "fixer");
  finish(f, "review", "blocked", "rev2", { blames: ["impl"] });
  assert.equal(derive(f).task_id, "impl-fix-2");
  assert.equal(state(f).derived["impl-fix-2"].cause.assignee, "rev2");
  unchanged(f, () => release(f, "review"), /claim correction impl-fix-2 of impl with a newly launched agent/);
  for (const seen of ["dev", "rev1", "rev2", "fixer"]) unchanged(f, () => claim(f, "impl-fix-2", seen), new RegExp(`assignee ${seen} (already appeared on the correction chain|produced the failed cause receipt)`)); // FR-020: whole family
  claim(f, "impl-fix-2", "fixer2");
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
for (const [label, change, pattern] of [
  ["derive event without its definition", s => { delete s.derived["impl-fix-1"]; delete s.tasks["impl-fix-1"]; }, /derive history mismatch for impl-fix-1/],
  ["definition without its event", s => { s.derived["impl-fix-9"] = { ...s.derived["impl-fix-1"], revision: s.revision }; s.tasks["impl-fix-9"] = { status: "queued", attempts: 0, assignment: null, reason: null }; }, /derived mission definitions disagree with derive history/],
  ["edited cause attempt", s => { s.derived["impl-fix-1"].cause.attempt_id = "forged"; }, /derive history digest mismatch for impl-fix-1/],
  ["edited cause assignee", s => { s.derived["impl-fix-1"].cause.assignee = "someone"; }, /derive history digest mismatch for impl-fix-1/],
  ["derived id in state.tasks without definition", s => { s.tasks["impl-fix-7"] = { status: "queued", attempts: 0, assignment: null, reason: null }; }, /state task set differs from accepted contract/],
  ["lowered derived attempt counter", s => { s.tasks["impl-fix-1"].attempts = 0; }, /task impl-fix-1 state\/attempt count disagrees with execution history/],
  ["EC-4 definition revision differs from its event", s => { s.derived["impl-fix-1"].revision += 1; }, /derive history mismatch for impl-fix-1/],
  ["derived budget above the parent budget", s => { s.derived["impl-fix-1"].max_attempts = 9; }, /derived mission impl-fix-1 budget exceeds its parent budget/],
  ["unknown definition field", s => { s.derived["impl-fix-1"].note = "x"; }, /derived mission impl-fix-1: unknown field note/],
  ["renamed derived id", s => { s.derived["impl-fix-5"] = s.derived["impl-fix-1"]; delete s.derived["impl-fix-1"]; s.tasks["impl-fix-5"] = s.tasks["impl-fix-1"]; delete s.tasks["impl-fix-1"]; s.events.forEach(e => { if (e.task_id === "impl-fix-1") e.task_id = "impl-fix-5"; }); s.receipts.forEach(r => { if (r.task_id === "impl-fix-1") r.task_id = "impl-fix-5"; }); }, /derive history id allocation mismatch for impl-fix-5/],
  ["claim payload naming the failed reviewer", s => { s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.assignee = "rev1"; s.receipts.find(r => r.task_id === "impl-fix-1").assignee = "rev1"; }, /illegal claim history for impl-fix-1: assignee rev1 produced the failed cause receipt/],
  ["claim payload disagreeing with its receipt", s => { s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.id = "other"; }, /receipt disagrees with its claim assignment for impl-fix-1/],
  ["claim payload with a foreign model", s => { s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.model = "other"; }, /claim history assignment disagrees with the topology of impl-fix-1/],
  ["assignment payload on a release event", s => { s.events.find(e => e.action === "release").assignment = s.events.find(e => e.action === "claim").assignment; }, /state event assignment is allowed only on claim events/],
  ["derived claim payload deleted", s => { delete s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment; }, /claim history of impl-fix-1 on a correction chain lacks its assignment/],
  ["derived claim payload deleted and receipt relabelled to the failed reviewer", s => { delete s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment; s.receipts.find(r => r.task_id === "impl-fix-1").assignee = "rev1"; }, /claim history of impl-fix-1 on a correction chain lacks its assignment/],
  ["forged review requeue", s => { s.tasks.review = { status: "queued", attempts: 1, assignment: null, reason: "corrections done: impl-fix-1" }; }, /task review state\/attempt count disagrees with execution history/],
]) test(`AC-5 tampered derived history is refused: ${label}`, t => tampered(derivedBoard(t), change, pattern));

test("AC-5 a release of the review hidden in history while corrections were pending is refused on read", t => {
  const f = blockedReview(t); derive(f);
  const value = state(f);
  value.revision++; value.events.push({ revision: value.revision, action: "release", coordinator: "lead", task_id: "review", reason: "Sneak", reconciled_by: "lead", at: new Date().toISOString() });
  value.tasks.review = { status: "queued", attempts: 1, assignment: null, reason: "Sneak" };
  write(f.stateFile, value);
  assert.throws(() => core.main(["status", f.board]), /illegal release history for review: blamed dependencies lack a done correction: claim correction impl-fix-1 of impl with a newly launched agent/);
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
  derive(f, { max_attempts: 1 }); finish(f, "impl-fix-2", "done", "fixer2"); // B-exhaustion requeues the review
  finish(f, "review", "blocked", "rev2");
  release(f, "review"); finish(f, "review", "blocked", "rev3");
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

// Owner decision 3 (2026-11-13): FR-007 requeue only when every blamed dependency has a done correction.
test("FR-007 owner decision 3: the review requeues only once every blamed dependency has a done correction", t => {
  const f = setup(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])]);
  finish(f, "impl", "done", "dev"); finish(f, "lib", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl", "lib"] });
  derive(f);
  const first = finish(f, "impl-fix-1", "done", "fixer");
  assert.equal(first.requeued, undefined);
  assert.equal(state(f).tasks.review.status, "blocked");
  assert.equal(core.main(["status", f.board]).tasks.find(x => x.id === "review").status, "blocked"); // replay agrees
  assert.equal(derive(f, { parent: "lib" }).task_id, "lib-fix-1");
  assert.equal(finish(f, "lib-fix-1", "done", "fixer2").requeued, "review");
  assert.deepEqual(state(f).tasks.review, { status: "queued", attempts: 1, assignment: null, reason: "corrections done: impl-fix-1, lib-fix-1" });
});

test("FR-007 OD-3: an exhausted correction keeps the review blocked until a new correction of that dependency is done", t => {
  const f = setup(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])]);
  finish(f, "impl", "done", "dev"); finish(f, "lib", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl", "lib"] });
  derive(f, { max_attempts: 1 }); derive(f, { parent: "lib" });
  finish(f, "impl-fix-1", "blocked", "fixer");
  assert.equal(finish(f, "lib-fix-1", "done", "fixer2").requeued, undefined);
  assert.equal(state(f).tasks.review.status, "blocked");
  unchanged(f, () => release(f, "review"), /no correction of impl succeeded \(impl-fix-1 exhausted\): derive a new correction for impl from the same receipt/); // OD-3 strict
  assert.equal(derive(f).task_id, "impl-fix-2"); // B-exhaustion: same receipt, new budget
  assert.equal(finish(f, "impl-fix-2", "done", "fixer3").requeued, "review");
  assert.deepEqual(state(f).tasks.review, { status: "queued", attempts: 1, assignment: null, reason: "corrections done: lib-fix-1, impl-fix-2" });
  assert.equal(state(f).tasks["impl-fix-1"].status, "blocked"); // the exhausted attempt stays in history
});

test("FR-007 owner decision 3: a forged requeue after a partial correction is refused on read", t => {
  const f = setup(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])]);
  finish(f, "impl", "done", "dev"); finish(f, "lib", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl", "lib"] });
  derive(f); finish(f, "impl-fix-1", "done", "fixer");
  tampered(f, s => { s.tasks.review = { status: "queued", attempts: 1, assignment: null, reason: "corrections done: impl-fix-1" }; }, /task review state\/attempt count disagrees with execution history/);
});

// Owner decision 1 (2026-11-13): a fresh-context agent on every attempt of a correction chain.
test("FR-020 owner decision 1: claim refuses every assignee already seen on the correction chain", t => {
  const f = blockedReview(t); derive(f); // chain impl/review: dev (impl), rev1 (review)
  for (const seen of ["dev", "rev1"]) unchanged(f, () => claim(f, "impl-fix-1", seen), new RegExp(`assignee ${seen} (already appeared on the correction chain|produced the failed cause receipt)`));
  finish(f, "impl-fix-1", "blocked", "fixer"); release(f, "impl-fix-1");
  unchanged(f, () => claim(f, "impl-fix-1", "fixer"), /assignee fixer already appeared on the correction chain of impl-fix-1/); // its own earlier attempt
  assert.equal(finish(f, "impl-fix-1", "done", "fixer2").requeued, "review");
  for (const seen of ["dev", "rev1", "fixer", "fixer2"]) assert.throws(() => claim(f, "review", seen), /correction chain/);
  claim(f, "review", "rev2");
  assert.equal(state(f).tasks.review.assignment.assignee, "rev2");
});

test("FR-020 review family: a second review of a corrected dependency refuses the author of its correction", t => {
  const f = setup(t, [task("impl"), task("review", ["impl"]), task("qa", ["impl"])]);
  finish(f, "impl", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl"] }); derive(f);
  finish(f, "impl-fix-1", "done", "fixer");
  // qa never blamed impl, but impl has a correction: its author would validate its own work.
  unchanged(f, () => claim(f, "qa", "fixer"), /assignee fixer already appeared on the correction chain of qa \(review family: qa, impl, impl-fix-1\)/);
  unchanged(f, () => claim(f, "qa", "dev"), /assignee dev already appeared on the correction chain of qa/);
  finish(f, "qa", "done", "qa1");
  tampered(f, s => {
    s.events.find(e => e.action === "claim" && e.task_id === "qa").assignment.assignee = "fixer";
    s.receipts.find(r => r.task_id === "qa").assignee = "fixer";
  }, /illegal claim history for qa: assignee fixer already appeared on the correction chain/);
});

test("FR-020 review family: a correction caused by another review is on the family", t => {
  const f = setup(t, [task("impl"), task("review", ["impl"]), task("qa", ["impl"])]);
  finish(f, "impl", "done", "dev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl"] }); derive(f);
  finish(f, "impl-fix-1", "done", "fixer");
  finish(f, "qa", "blocked", "qa1", { blames: ["impl"] });
  assert.equal(derive(f, { cause: "qa" }).task_id, "impl-fix-2");
  unchanged(f, () => claim(f, "impl-fix-2", "fixer"), /assignee fixer already appeared on the correction chain of impl-fix-2 \(review family: qa, impl, impl-fix-1, impl-fix-2, review\)/);
  assert.equal(finish(f, "impl-fix-2", "done", "fixer2").requeued, "qa");
  // The first review now has two corrections of impl on its family, whichever review caused them.
  unchanged(f, () => claim(f, "review", "fixer2"), /assignee fixer2 already appeared on the correction chain of review/);
});

for (const [label, change, pattern] of [
  ["a correction claim reusing the parent's implementer", s => {
    s.events.find(e => e.action === "claim" && e.task_id === "impl-fix-1").assignment.assignee = "dev";
    s.receipts.find(r => r.task_id === "impl-fix-1").assignee = "dev";
  }, /illegal claim history for impl-fix-1: assignee dev already appeared on the correction chain/],
  ["a review claim after correction reusing the fixer", s => {
    s.events.filter(e => e.action === "claim" && e.task_id === "review").at(-1).assignment.assignee = "fixer";
    s.tasks.review.assignment.assignee = "fixer";
  }, /illegal claim history for review: assignee fixer already appeared on the correction chain/],
  ["a review claim after correction without its payload", s => {
    delete s.events.filter(e => e.action === "claim" && e.task_id === "review").at(-1).assignment;
  }, /claim history of review on a correction chain lacks its assignment/],
]) test(`FR-020 owner decision 1: replay refuses ${label}`, t => {
  const f = blockedReview(t); derive(f); finish(f, "impl-fix-1", "done", "fixer"); claim(f, "review", "rev2");
  tampered(f, change, pattern);
});

// Owner decision 2 (2026-11-13): the derive event carries a verified digest of the definition.
function canonicalDigest(value) {
  const sort = x => Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
  return require("node:crypto").createHash("sha256").update(JSON.stringify(sort(value)), "utf8").digest("hex");
}
test("FR-019 owner decision 2: the derive event records the sha256 of the canonical definition", t => {
  const f = blockedReview(t); derive(f);
  const s = state(f), { parent, cause, objective, topology, max_attempts } = s.derived["impl-fix-1"];
  assert.equal(s.events.at(-1).definition_digest, canonicalDigest({ parent, cause, objective, topology, max_attempts }));
});

for (const [label, change, pattern] of [
  ["edited objective", s => { s.derived["impl-fix-1"].objective = "Rewrite everything"; }, /derive history digest mismatch for impl-fix-1/],
  ["edited topology", s => { s.derived["impl-fix-1"].topology.persona = "Someone else"; }, /derive history digest mismatch for impl-fix-1/],
  ["lowered budget", s => { s.derived["impl-fix-1"].max_attempts = 1; }, /derive history digest mismatch for impl-fix-1/],
  ["deleted digest", s => { delete s.events.find(e => e.action === "derive").definition_digest; }, /derive event definition_digest/],
  ["digest on a claim event", s => { s.events.find(e => e.action === "claim").definition_digest = s.events.find(e => e.action === "derive").definition_digest; }, /definition_digest is allowed only on derive events/],
]) test(`FR-019 owner decision 2: replay refuses a definition modified after its derive event: ${label}`, t => {
  const f = blockedReview(t); derive(f);
  tampered(f, change, pattern);
});

test("FR-006 the receipt check independently refuses the cause assignee on a derived mission", () => {
  const { validateReceiptLinks } = require("./roster-roadmap-derived.cjs");
  const fix = { id: "impl-fix-1", depends_on: [], derived: { parent: "impl", cause: { task_id: "review", attempt_id: "a", assignee: "rev1" }, revision: 5 } };
  assert.throws(() => validateReceiptLinks({ assignee: "rev1", result: "done" }, fix), /rev1/);
  assert.doesNotThrow(() => validateReceiptLinks({ assignee: "fixer", result: "done" }, fix));
  assert.doesNotThrow(() => validateReceiptLinks({ assignee: "rev1", result: "done" }, { id: "impl", depends_on: [] }));
});
