"use strict";
// Third review round of specs/roadmap-derived-missions.md: no board state may be left without a
// way forward. Legacy claims known by their receipt (FR-021), withdrawal of a never-claimed
// correction only (FR-022), the correction cap per receipt and dependency (FR-003), next_action
// that follows the real preconditions of derive (FR-007), a last attempt after a capabilities
// change (FR-023), and the text status of corrections (FR-014).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { core, write, task, CAPABILITIES, setup, state, claim, receipt, record, finish, release, derive, withdraw, blockedReview, unchanged, tampered } = require("./roster-roadmap-derived.fixture.js");

const nextAction = (f, id) => core.main(["status", f.board]).tasks.find(x => x.id === id).next_action;
const text = f => core.main(["status", f.board, "--format", "text"]);
function stripClaims(f, keep = () => false) {
  const s = state(f);
  for (const event of s.events) if (event.action === "claim" && !keep(event)) delete event.assignment;
  write(f.stateFile, s);
}

test("FR-021 a board started with an older runtime derives: a recorded claim is known by its receipt", t => {
  const f = blockedReview(t); stripClaims(f); // every claim written without assignment
  assert.match(nextAction(f, "review"), /derive a correction for impl/);
  assert.equal(derive(f).task_id, "impl-fix-1");
  // The receipts still name who worked on the family.
  unchanged(f, () => claim(f, "impl-fix-1", "dev"), /assignee dev already appeared on the correction chain of impl-fix-1/);
  unchanged(f, () => claim(f, "impl-fix-1", "rev1"), /assignee rev1 produced the failed cause receipt/);
  assert.equal(finish(f, "impl-fix-1", "done", "fixer").requeued, "review");
  unchanged(f, () => claim(f, "review", "dev"), /assignee dev already appeared on the correction chain of review/);
  assert.equal(claim(f, "review", "rev2").assignee, "rev2");
  assert.equal(core.main(["status", f.board]).tasks.find(x => x.id === "review").status, "active");
});

test("FR-021 a legacy claim released without a receipt still refuses derive, and next_action says so", t => {
  const f = setup(t);
  claim(f, "impl", "dev0"); release(f, "impl");
  finish(f, "impl", "done", "dev"); finish(f, "review", "blocked", "rev1", { blames: ["impl"] });
  stripClaims(f);
  unchanged(f, () => derive(f), /the claim of impl at revision 2 has no assignment \(written by an older runtime or edited\) and its attempt left no receipt/);
  assert.match(nextAction(f, "review"), /no correction can be derived for impl: the claim of impl at revision 2 has no assignment.*revise the board instead/);
  unchanged(f, () => release(f, "review"), /cannot release review: .*revise the board instead/);
});

test("FR-022 a correction that already started cannot be withdrawn", t => {
  const f = blockedReview(t); derive(f);
  claim(f, "impl-fix-1", "fixer"); release(f, "impl-fix-1"); // queued again, one attempt spent
  unchanged(f, () => withdraw(f, "impl-fix-1"), /cannot withdraw impl-fix-1: it was already claimed \(1 attempts\); only a correction that never started can be withdrawn/);
  tampered(f, s => {
    s.revision++; s.events.push({ revision: s.revision, action: "withdraw-derived", coordinator: "lead", task_id: "impl-fix-1", reason: "x", reconciled_by: null, at: new Date().toISOString() });
    s.tasks["impl-fix-1"] = { status: "withdrawn", attempts: 1, assignment: null, reason: "x" };
  }, /illegal withdraw history for impl-fix-1: it was already claimed/);
});

test("FR-003 corrections of one dependency for one receipt are capped by the parent's max_attempts", t => {
  const f = blockedReview(t, [task("impl", [], { max_attempts: 2 }), task("review", ["impl"])]);
  for (const [id, fixer] of [["impl-fix-1", "fixer1"], ["impl-fix-2", "fixer2"]]) {
    assert.equal(derive(f, { max_attempts: 1 }).task_id, id);
    finish(f, id, "blocked", fixer);
  }
  const cap = /impl already had 2 corrections for this receipt of review, the limit set by its max_attempts; request a revised-roadmap decision/;
  unchanged(f, () => derive(f, { max_attempts: 1 }), cap);
  assert.match(nextAction(f, "review"), /no correction can be derived for impl \(impl-fix-1 exhausted, impl-fix-2 exhausted\): impl already had 2 corrections/);
  assert.doesNotMatch(nextAction(f, "review"), /derive a new correction/);
});

test("FR-003 a withdrawn correction never ran and does not count toward the cap", t => {
  const f = blockedReview(t, [task("impl", [], { max_attempts: 2 }), task("review", ["impl"])]);
  derive(f, { max_attempts: 1 }); withdraw(f, "impl-fix-1");
  derive(f, { max_attempts: 1 }); finish(f, "impl-fix-2", "blocked", "fixer0");
  // Three corrections for a cap of two that ran: the withdrawn one is counted apart.
  assert.equal(derive(f, { max_attempts: 1 }).task_id, "impl-fix-3");
  assert.equal(finish(f, "impl-fix-3", "done", "fixer").requeued, "review");
});

test("FR-007 next_action names a withdrawn correction beside an exhausted one", t => {
  const f = blockedReview(t);
  derive(f, { max_attempts: 1 }); finish(f, "impl-fix-1", "blocked", "fixer");
  derive(f); withdraw(f, "impl-fix-2");
  assert.match(nextAction(f, "review"), /no correction of impl succeeded \(impl-fix-1 exhausted, impl-fix-2 withdrawn\): derive a new correction for impl from the same receipt/);
});

test("FR-007 next_action does not advise a derivation that the review's policy refuses", t => {
  const f = blockedReview(t, [task("impl"), task("review", ["impl"], { on_failure: "block" })]);
  unchanged(f, () => derive(f), /cause review policy does not authorize retry/);
  const action = nextAction(f, "review");
  assert.match(action, /no correction can be derived for impl: cause review policy does not authorize retry; request the blocking decision/);
  assert.doesNotMatch(action, /derive a correction for impl/);
});

test("FR-007 next_action asks for the recovery reframe before a derivation", t => {
  const f = setup(t, [task("impl"), task("review", ["impl"], { max_attempts: 5 })]);
  finish(f, "impl", "done", "dev");
  for (let i = 0; i < 3; i++) { if (i) release(f, "review"); finish(f, "review", "blocked", "rev1", i === 2 ? { blames: ["impl"] } : {}); }
  const action = nextAction(f, "review");
  assert.match(action, /no correction can be derived for impl: review needs a diagnosed recovery reframe first; record it, then derive/);
  assert.doesNotMatch(action, /derive a correction for impl/);
});

const DRIFTED = { schema_version: 1, runtimes: { codex: { ...CAPABILITIES.runtimes.codex, evidence: ["Observed again"] } } };
test("FR-023 a correction on its last attempt ends by a blocked receipt even after capabilities changed", t => {
  const f = blockedReview(t); derive(f, { max_attempts: 1 }); claim(f, "impl-fix-1", "fixer");
  assert.match(nextAction(f, "impl-fix-1"), /Last attempt of this correction.*the coordinator records a blocked receipt under the attempt id and assignee of the assignment/);
  write(f.capabilitiesFile, DRIFTED);
  unchanged(f, () => release(f, "impl-fix-1"), /attempt budget exhausted/);
  unchanged(f, () => withdraw(f, "impl-fix-1"), /it is active/);
  unchanged(f, () => record(f, receipt(f, "impl-fix-1", "done")), /capabilities changed during assignment/); // a result still needs current capabilities
  assert.equal(record(f, receipt(f, "impl-fix-1", "blocked")).result, "blocked");
  assert.equal(derive(f).task_id, "impl-fix-2"); // the review has a way forward again
});

test("FR-023 the exception is for corrections only: a contract task keeps the capabilities refusal", t => {
  const f = setup(t); claim(f, "impl", "dev");
  write(f.capabilitiesFile, DRIFTED);
  unchanged(f, () => record(f, receipt(f, "impl", "blocked")), /capabilities changed during assignment/);
  assert.doesNotMatch(nextAction(f, "impl"), /Last attempt of this correction/);
});

test("FR-014 text status separates tasks from corrections, labels reasons by state and lists attempts", t => {
  const f = blockedReview(t); derive(f); withdraw(f, "impl-fix-1");
  derive(f); claim(f, "impl-fix-2", "fixer");
  let out = text(f);
  assert.match(out, /^Tasks: 1\/2 done; 0 active; 1 blocked\. Corrections: 0\/2 done; 1 active; 0 blocked$/m);
  assert.match(out, /^ {2}Withdrawn: Topology cannot be claimed on this host$/m);
  assert.match(out, /^ {2}Attempt 1: fixer, active, \d{4}-\d\d-\d\dT[\d:.]+Z to now$/m);
  record(f, receipt(f, "impl-fix-2", "done"));
  out = text(f);
  assert.match(out, /^ {2}Requeued: corrections done: impl-fix-2$/m);
  assert.doesNotMatch(out, /Blocker: (Topology|corrections done)/);
  assert.match(out, /^ {2}Attempt 1: rev1, blocked, \d{4}-\d\d-\d\dT[\d:.]+Z to \d{4}-\d\d-\d\dT[\d:.]+Z$/m);
  assert.match(out, /^ {2}Attempt 1: fixer, done, \d{4}-\d\d-\d\dT[\d:.]+Z to \d{4}-\d\d-\d\dT[\d:.]+Z$/m);
  finish(f, "review", "blocked", "rev2");
  assert.match(text(f), /^ {2}Blocker: review blocked$/m);
});
