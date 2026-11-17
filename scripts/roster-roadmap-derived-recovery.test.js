"use strict";
// Second review round of specs/roadmap-derived-missions.md: unclaimable topologies and
// withdraw-derived (FR-022), B-exhaustion (FR-003), OD-3 strict release, the review family
// (OD-4, FR-020), mixed legacy history (FR-021), prototype-named tasks in view, FR-008 limits.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { core, write, read, task, TOPOLOGY, setup, state, cmd, claim, receipt, record, finish, release, derive, withdraw, blockedReview, unchanged, tampered } = require("./roster-roadmap-derived.fixture.js");

const UNCLAIMABLE = /cannot derive: no route of the requested topology is claimable now/;
test("FR-022 derive refuses a topology with no claimable route at derivation time", t => {
  const f = blockedReview(t);
  unchanged(f, () => derive(f, { topology: { ...TOPOLOGY, runtime: "claude" } }), UNCLAIMABLE); // runtime not available
  unchanged(f, () => derive(f, { topology: { ...TOPOLOGY, route: "subagent" } }), UNCLAIMABLE); // unauthorized, no fallback
  assert.equal(derive(f, { topology: { ...TOPOLOGY, route: "subagent", fallbacks: ["sequential"] } }).task_id, "impl-fix-1");
  assert.equal(claim(f, "impl-fix-1", "fixer").route, "sequential");
});

// A correction that became unclaimable after its derivation (capabilities changed).
function stuckCorrection(t) {
  const f = blockedReview(t); derive(f);
  write(f.capabilitiesFile, { schema_version: 1, runtimes: { codex: { available: false, evidence: [], capabilities: {} } } });
  unchanged(f, () => claim(f, "impl-fix-1", "fixer"), /requested route unsupported or unauthorized/);
  write(f.capabilitiesFile, { schema_version: 1, runtimes: { codex: { available: false, evidence: [], capabilities: {} }, claude: { available: true, evidence: ["Observed"], capabilities: {} } } });
  return f;
}
test("FR-022 withdraw-derived retires a queued correction and lets the same receipt derive again", t => {
  const f = stuckCorrection(t);
  unchanged(f, () => derive(f, { topology: { ...TOPOLOGY, runtime: "claude" } }), /correction impl-fix-1 already exists for impl and this receipt of review and is pending/);
  const out = withdraw(f, "impl-fix-1");
  assert.deepEqual([out.task_id, out.withdrawn], ["impl-fix-1", true]);
  const s = state(f);
  assert.deepEqual(s.tasks["impl-fix-1"], { status: "withdrawn", attempts: 0, assignment: null, reason: "Topology cannot be claimed on this host" });
  assert.deepEqual({ ...s.events.at(-1), at: null }, { revision: s.revision, action: "withdraw-derived", coordinator: "lead", task_id: "impl-fix-1", reason: "Topology cannot be claimed on this host", reconciled_by: null, at: null });
  unchanged(f, () => release(f, "review"), /derive a correction for impl/); // OD-3 still strict
  assert.equal(derive(f, { topology: { ...TOPOLOGY, runtime: "claude" } }).task_id, "impl-fix-2");
  assert.equal(finish(f, "impl-fix-2", "done", "fixer").requeued, "review");
  const status = core.main(["status", f.board]);
  assert.deepEqual(status.tasks.map(x => [x.id, x.status]), [["impl", "done"], ["review", "queued"], ["impl-fix-1", "withdrawn"], ["impl-fix-2", "done"]]);
  assert.equal(status.counts.withdrawn, 1);
  assert.match(core.main(["status", f.board, "--format", "text"]), /impl-fix-1/);
});

test("FR-022 withdraw-derived is coordinator-only, needs a reason file and a queued derived mission", t => {
  const f = blockedReview(t); derive(f);
  const file = `${f.root}/withdrawal.json`; write(file, { reason: "x" });
  unchanged(f, () => core.main(["withdraw-derived", f.board, "--coordinator", "stranger", "--revision", String(state(f).revision), "--task", "impl-fix-1", "--withdrawal", file]), /foreign coordinator/);
  unchanged(f, () => cmd(f, "withdraw-derived", ["--task", "impl-fix-1"]), /--withdrawal must be a nonempty string/);
  unchanged(f, () => withdraw(f, "impl-fix-1", { reason: " " }), /withdrawal reason must be a nonempty string/);
  unchanged(f, () => withdraw(f, "impl-fix-1", { reason: "x", by: "lead" }), /withdrawal file: unknown field by/);
  unchanged(f, () => withdraw(f, "impl"), /cannot withdraw impl: not a derived correction mission/);
  unchanged(f, () => withdraw(f, "constructor"), /cannot withdraw constructor: not a derived correction mission/);
  claim(f, "impl-fix-1", "fixer");
  unchanged(f, () => withdraw(f, "impl-fix-1"), /cannot withdraw impl-fix-1: it is active; only a queued correction can be withdrawn/);
});

for (const [label, change, pattern] of [
  ["withdrawn status without its event", s => { s.tasks["impl-fix-1"] = { status: "withdrawn", attempts: 0, assignment: null, reason: "x" }; }, /task impl-fix-1 state\/attempt count disagrees with execution history/],
  ["withdraw event on a contract task", s => { s.revision++; s.events.push({ revision: s.revision, action: "withdraw-derived", coordinator: "lead", task_id: "impl", reason: "x", reconciled_by: null, at: new Date().toISOString() }); }, /withdraw history names impl, which is not a derived mission at that point/],
  ["withdraw event without its reason", s => { s.revision++; s.events.push({ revision: s.revision, action: "withdraw-derived", coordinator: "lead", task_id: "impl-fix-1", reason: null, reconciled_by: null, at: new Date().toISOString() }); }, /withdraw-derived event reason must be a nonempty string/],
  ["withdraw event of an active correction", s => {
    s.revision++; s.events.push({ revision: s.revision, action: "withdraw-derived", coordinator: "lead", task_id: "impl-fix-1", reason: "x", reconciled_by: null, at: new Date().toISOString() });
    s.tasks["impl-fix-1"] = { status: "withdrawn", attempts: 1, assignment: null, reason: "x" };
  }, /illegal withdraw history for impl-fix-1: it is active/],
]) test(`FR-022 replay refuses a ${label}`, t => {
  const f = blockedReview(t); derive(f);
  if (label.includes("active")) claim(f, "impl-fix-1", "fixer");
  tampered(f, change, pattern);
});

test("FR-003 B-exhaustion: a correction at its budget allows <parent>-fix-<n+1> from the same receipt", t => {
  const f = blockedReview(t); derive(f, { max_attempts: 2 });
  finish(f, "impl-fix-1", "blocked", "fixer");
  unchanged(f, () => derive(f), /correction impl-fix-1 already exists for impl and this receipt of review and is pending; derive again only after it is exhausted or withdrawn/);
  release(f, "impl-fix-1"); finish(f, "impl-fix-1", "blocked", "fixer2");
  unchanged(f, () => derive(f, { max_attempts: 4 }), /request\.max_attempts must be an integer in 1\.\.3/); // still capped by the parent
  const out = derive(f, { max_attempts: 3 });
  assert.equal(out.task_id, "impl-fix-2");
  assert.equal(state(f).derived["impl-fix-2"].cause.attempt_id, state(f).derived["impl-fix-1"].cause.attempt_id);
  assert.equal(finish(f, "impl-fix-2", "done", "fixer3").requeued, "review");
  unchanged(f, () => derive(f), /cause review is queued, not blocked/);
  const view = core.main(["view", f.board]);
  assert.deepEqual(view.tasks.map(x => [x.id, x.state, x.timeline.length]), [["impl", "done", 1], ["review", "queued", 1], ["impl-fix-1", "blocked", 2], ["impl-fix-2", "done", 1]]);
  assert.deepEqual(view.tasks[0].corrections, ["impl-fix-1", "impl-fix-2"]);
});

test("OD-3 strict: next_action names the blamed dependency to correct before any derivation", t => {
  const f = blockedReview(t);
  const review = core.main(["status", f.board]).tasks.find(x => x.id === "review");
  assert.match(review.next_action, /Release is refused until every blamed dependency has a done correction: derive a correction for impl/);
  unchanged(f, () => release(f, "review"), /cannot release review: blamed dependencies lack a done correction: derive a correction for impl/);
  const unblamed = blockedReview(t, undefined, null);
  assert.equal(release(unblamed, "review").reconciled, true); // a blocked receipt without blames keeps the usual rules
});

test("OD-4 family: the implementer of a blamed dependency without a correction cannot fix another one", t => {
  const f = setup(t, [task("impl"), task("lib"), task("review", ["impl", "lib"])]);
  finish(f, "impl", "done", "dev"); finish(f, "lib", "done", "libdev");
  finish(f, "review", "blocked", "rev1", { blames: ["impl", "lib"] });
  derive(f);
  unchanged(f, () => claim(f, "impl-fix-1", "libdev"), /assignee libdev already appeared on the correction chain of impl-fix-1 \(review family: review, impl, lib, impl-fix-1\)/);
  finish(f, "impl-fix-1", "done", "fixer");
  derive(f, { parent: "lib" });
  unchanged(f, () => claim(f, "lib-fix-1", "fixer"), /assignee fixer already appeared on the correction chain of lib-fix-1/);
  assert.equal(finish(f, "lib-fix-1", "done", "fixer2").requeued, "review");
  for (const seen of ["dev", "libdev", "rev1", "fixer", "fixer2"]) unchanged(f, () => claim(f, "review", seen), new RegExp(`assignee ${seen} already appeared on the correction chain of review`));
  // Replay applies the same family rule to a hand-written claim.
  tampered(f, s => {
    s.events.find(e => e.action === "claim" && e.task_id === "lib-fix-1").assignment.assignee = "fixer";
    s.receipts.find(r => r.task_id === "lib-fix-1").assignee = "fixer";
  }, /illegal claim history for lib-fix-1: assignee fixer already appeared on the correction chain/);
});

// FR-021: a claim of the family without assignment (older runtime, or the field deleted) leaves
// an identity the fresh-context rule cannot see.
function releasedImplClaim(t) {
  const f = setup(t);
  claim(f, "impl", "dev0"); release(f, "impl");
  finish(f, "impl", "done", "dev"); finish(f, "review", "blocked", "rev1", { blames: ["impl"] });
  return f;
}
const stripImplClaim = s => { delete s.events.find(e => e.action === "claim" && e.task_id === "impl").assignment; };
test("FR-021 derive refuses a family whose earlier claim has no assignment", t => {
  const f = releasedImplClaim(t);
  const s = state(f); stripImplClaim(s); write(f.stateFile, s);
  assert.equal(core.main(["status", f.board]).tasks[0].status, "done"); // the legacy board still reads
  unchanged(f, () => derive(f), /cannot derive: the claim of impl at revision 2 has no assignment \(written by an older runtime or edited\)/);
});
test("FR-021 deleting a family claim's assignment after derive makes reads fail instead of admitting a seen agent", t => {
  const f = releasedImplClaim(t); derive(f);
  tampered(f, stripImplClaim, /illegal derive history for impl-fix-1: the claim of impl at revision 2 has no assignment/);
});

test("view and text status survive tasks named after Object.prototype members; timeline is [] before any claim", t => {
  const names = ["constructor", "toString", "valueOf", "hasOwnProperty"];
  const f = setup(t, names.map(id => task(id)));
  const view = core.main(["view", f.board]);
  assert.deepEqual(view.tasks.map(x => [x.id, x.timeline]), names.map(id => [id, []]));
  assert.match(core.main(["status", f.board, "--format", "text"]), /constructor/);
  finish(f, "constructor", "done", "dev");
  assert.deepEqual(core.main(["view", f.board]).tasks.map(x => x.timeline.length), [1, 0, 0, 0]);
});

// FR-008: capacity and write-scope overlap treat an active derived mission like any mission.
const PARALLEL = { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: { parallel: { supported: true, authorized: true, evidence: ["Observed"] } } } } };
function activeCorrection(t, options) {
  const f = setup(t, [task("impl"), task("review", ["impl"]), { ...task("shared"), allowed_files: ["src/"] }, task("other")], true, options);
  finish(f, "impl", "done", "dev"); finish(f, "review", "blocked", "rev1", { blames: ["impl"] });
  derive(f); claim(f, "impl-fix-1", "fixer");
  return f;
}
test("FR-008 max_active counts an active derived mission", t => {
  const f = activeCorrection(t);
  unchanged(f, () => claim(f, "other", "dev2"), /cannot claim other: active mission limit reached/);
});
test("FR-008 a derived mission's inherited write scope blocks an overlapping concurrent claim", t => {
  const f = activeCorrection(t, { max_active: 3, capabilities: PARALLEL });
  unchanged(f, () => claim(f, "shared", "dev2"), /cannot claim shared: write scope overlaps active mission/);
  assert.equal(claim(f, "other", "dev3").assignee, "dev3");
  record(f, receipt(f, "impl-fix-1", "done"));
  assert.equal(read(f.stateFile).tasks.review.status, "queued");
});
