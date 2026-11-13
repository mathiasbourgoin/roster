"use strict";
// Fourth review round of specs/roadmap-derived-missions.md, owner decision OD-5 "frozen until the
// correction": a dependency with an open correction is unmet for every task that depends on it
// (claim, next, prompt), a dependent that is already active cannot record done, the fresh-context
// rule is checked again at record and on replay (FR-024), next_action names only accepted gestures
// (FR-007) and derive / withdraw-derived is bounded (FR-003).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { core, write, task, CAPABILITIES, setup, state, claim, receipt, record, finish, release, derive, withdraw, blockedReview, unchanged, tampered } = require("./roster-roadmap-derived.fixture.js");

const PARALLEL = { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: { parallel: { supported: true, authorized: true, evidence: ["Observed"] } } } } };
const TWO_REVIEWS = () => [task("impl"), task("review", ["impl"]), task("qa", ["impl"])];
const statusOf = (f, id) => core.main(["status", f.board]).tasks.find(x => x.id === id);
const nextAction = (f, id) => statusOf(f, id).next_action;
// impl done by dev, qa active for qaAgent, review blocked by rev1 blaming impl, impl-fix-1 derived.
function activeSecondReview(t, qaAgent) {
  const f = setup(t, TWO_REVIEWS(), true, { max_active: 2, capabilities: PARALLEL });
  finish(f, "impl", "done", "dev");
  claim(f, "qa", qaAgent);
  finish(f, "review", "blocked", "rev1", { blames: ["impl"] });
  derive(f);
  return f;
}
// Rewrites the stored blocked receipt of id into a done one, as a hand edit of state.json would.
function forgeDone(value, id) {
  const stored = value.receipts.find(r => r.task_id === id);
  stored.result = "done"; stored.checks = [{ id: "unit", status: "pass", evidence: ["log"] }];
  value.tasks[id].status = "done"; value.tasks[id].reason = null;
}

test("B1 an agent holding an attempt of a task that depends on the parent cannot claim its correction", t => {
  const f = activeSecondReview(t, "xx");
  unchanged(f, () => claim(f, "impl-fix-1", "xx"), /cannot claim impl-fix-1: assignee xx already appeared on the correction chain of impl-fix-1 \(review family: review, impl, impl-fix-1, qa\)/);
  assert.equal(claim(f, "impl-fix-1", "fixer").assignee, "fixer");
});

test("B1 an agent that released an attempt of a dependent task cannot claim the correction either", t => {
  const f = setup(t, TWO_REVIEWS());
  finish(f, "impl", "done", "dev");
  claim(f, "qa", "xx"); release(f, "qa");
  finish(f, "review", "blocked", "rev1", { blames: ["impl"] }); derive(f);
  unchanged(f, () => claim(f, "impl-fix-1", "xx"), /assignee xx already appeared on the correction chain of impl-fix-1/);
});

test("FR-021 a dependent's claim without assignment, released without a receipt, refuses the derivation", t => {
  const f = setup(t, TWO_REVIEWS());
  finish(f, "impl", "done", "dev");
  claim(f, "qa", "xx"); release(f, "qa");
  finish(f, "review", "blocked", "rev1", { blames: ["impl"] });
  const value = state(f);
  delete value.events.find(event => event.action === "claim" && event.task_id === "qa").assignment;
  write(f.stateFile, value);
  unchanged(f, () => derive(f), /cannot derive: the claim of qa at revision \d+ has no assignment/);
});

test("B1 a dependent that is already active cannot record done while the correction is open", t => {
  const f = activeSecondReview(t, "xx");
  const done = receipt(f, "qa", "done");
  const refusal = /cannot record: a done receipt of qa is refused while a dependency is under correction: impl \(open correction impl-fix-1\)/;
  unchanged(f, () => record(f, done), refusal); // correction queued
  assert.match(nextAction(f, "qa"), /A dependency is under correction: impl \(open correction impl-fix-1\)\. A done receipt is refused/);
  claim(f, "impl-fix-1", "fixer");
  unchanged(f, () => record(f, done), refusal); // correction active
  record(f, receipt(f, "impl-fix-1", "done"));
  assert.equal(record(f, done).result, "done"); // correction done: the freeze is lifted
});

test("B1 a blocked receipt of an active dependent stays allowed while the correction is open", t => {
  const f = activeSecondReview(t, "xx");
  assert.equal(record(f, receipt(f, "qa", "blocked")).result, "blocked");
  assert.equal(state(f).tasks.qa.status, "blocked");
});

test("B1 replay refuses a correction claimed by an agent of a dependent task and a done receipt recorded during the correction", t => {
  const claimed = activeSecondReview(t, "xx"); claim(claimed, "impl-fix-1", "fixer");
  tampered(claimed, value => {
    value.tasks["impl-fix-1"].assignment.assignee = "xx";
    value.events.findLast(event => event.action === "claim").assignment.assignee = "xx";
  }, /illegal claim history for impl-fix-1: assignee xx already appeared on the correction chain of impl-fix-1/);
  const recorded = activeSecondReview(t, "xx"); record(recorded, receipt(recorded, "qa", "blocked"));
  tampered(recorded, value => forgeDone(value, "qa"), /illegal record history for qa: a done receipt of qa is refused while a dependency is under correction: impl \(open correction impl-fix-1\)/);
});

test("B2 a task that depends on a dependency under correction is not ready until the correction is done", t => {
  const f = setup(t, TWO_REVIEWS());
  finish(f, "impl", "done", "dev");
  finish(f, "qa", "blocked", "qa1", { blames: ["impl"] });
  derive(f, { cause: "qa" });
  const frozen = /cannot claim review: waiting for dependencies: impl \(open correction impl-fix-1\)/;
  const ready = () => core.main(["next", f.board]);
  assert.equal(ready().task.id, "impl-fix-1"); // not review
  assert.equal(JSON.parse(core.main(["prompt", f.board]).prompt).mission.id, "impl-fix-1");
  assert.equal(statusOf(f, "review").reason, "waiting for dependencies: impl (open correction impl-fix-1)");
  unchanged(f, () => claim(f, "review", "rev1"), frozen); // correction queued
  claim(f, "impl-fix-1", "fixer");
  assert.equal(ready().status, "active");
  record(f, receipt(f, "impl-fix-1", "blocked"));
  unchanged(f, () => claim(f, "review", "rev1"), frozen); // correction blocked with attempts left
  assert.equal(ready().status, "blocked");
  release(f, "impl-fix-1");
  assert.equal(finish(f, "impl-fix-1", "done", "fixer2").requeued, "qa");
  assert.equal(claim(f, "review", "rev1").assignee, "rev1");
});

test("B2 an exhausted or withdrawn correction is not open and does not freeze the dependents", t => {
  const f = setup(t, TWO_REVIEWS());
  finish(f, "impl", "done", "dev");
  finish(f, "qa", "blocked", "qa1", { blames: ["impl"] });
  derive(f, { cause: "qa", max_attempts: 1 }); finish(f, "impl-fix-1", "blocked", "fixer");
  derive(f, { cause: "qa" }); withdraw(f, "impl-fix-2");
  assert.equal(core.main(["next", f.board]).task.id, "review");
});

test("B2 replay refuses a claim made while a dependency was under correction", t => {
  const f = setup(t, TWO_REVIEWS());
  finish(f, "impl", "done", "dev");
  finish(f, "qa", "blocked", "qa1", { blames: ["impl"] });
  derive(f, { cause: "qa" });
  finish(f, "impl-fix-1", "done", "fixer");
  claim(f, "review", "rev1");
  // The same events with the claim of review moved before the correction ran.
  tampered(f, value => {
    const [reviewClaim] = value.events.splice(-1, 1);
    value.events.splice(-2, 0, reviewClaim);
    value.events.forEach((event, index) => { event.revision = index + 1; });
  }, /claim history has unmet dependencies for review/);
});

test("FR-024 the fresh-context rule is checked again when a done receipt is recorded, live and on replay", t => {
  // dev implemented impl and holds qa since before any correction existed.
  const f = activeSecondReview(t, "dev");
  finish(f, "impl-fix-1", "done", "fixer");
  unchanged(f, () => record(f, receipt(f, "qa", "done")), /cannot record: assignee dev already appeared on the correction chain of qa \(review family: qa, impl, impl-fix-1\); record a blocked receipt or release this attempt, then claim with a newly launched agent/);
  assert.equal(record(f, receipt(f, "qa", "blocked")).result, "blocked");
  tampered(f, value => forgeDone(value, "qa"), /illegal record history for qa: assignee dev already appeared on the correction chain of qa/);
});

test("FR-024 a fresh agent records done after the correction, and its own claim is not held against it", t => {
  const f = activeSecondReview(t, "qa1");
  finish(f, "impl-fix-1", "done", "fixer");
  assert.equal(record(f, receipt(f, "qa", "done")).result, "done");
  assert.equal(finish(f, "review", "done", "rev2").result, "done");
  assert.equal(core.main(["next", f.board]).status, "global-verification-needed");
});

test("FR-007 the step of a pending correction follows its state", t => {
  const f = blockedReview(t); derive(f);
  assert.match(nextAction(f, "review"), /claim correction impl-fix-1 of impl with a newly launched agent, or withdraw it \(withdraw-derived\) if it cannot be claimed/);
  claim(f, "impl-fix-1", "fixer");
  assert.match(nextAction(f, "review"), /finish the active attempt of correction impl-fix-1 of impl and record its receipt/);
  record(f, receipt(f, "impl-fix-1", "blocked"));
  assert.match(nextAction(f, "review"), /release correction impl-fix-1 of impl \(it has attempts left\), then claim it with a newly launched agent/);
  release(f, "impl-fix-1");
  assert.match(nextAction(f, "review"), /claim correction impl-fix-1 of impl with a newly launched agent\./);
  assert.doesNotMatch(nextAction(f, "review"), /withdraw/); // already started: withdrawal would be refused
});

test("FR-007 a correction blocked after three consecutive failures is sent to roster-recovery reframe, not to release", t => {
  const f = blockedReview(t, [task("impl", [], { max_attempts: 5 }), task("review", ["impl"])]);
  derive(f, { max_attempts: 5 });
  for (let i = 1; i <= 3; i++) { if (i > 1) release(f, "impl-fix-1"); finish(f, "impl-fix-1", "blocked", `fixer${i}`); }
  unchanged(f, () => release(f, "impl-fix-1"), /three consecutive failures require a diagnosed reframe before requeueing/);
  const action = nextAction(f, "review");
  assert.match(action, /correction impl-fix-1 of impl failed three times in a row and its release is refused: record a diagnosed reframe for it \(roster-recovery reframe\), then release it/);
  assert.doesNotMatch(action, /release correction impl-fix-1 of impl \(it has attempts left\)/);
});

test("FR-007 a started correction whose route became unclaimable is sent to capabilities.json or a revised roadmap", t => {
  const f = blockedReview(t); derive(f);
  finish(f, "impl-fix-1", "blocked", "fixer"); release(f, "impl-fix-1");
  write(f.capabilitiesFile, { schema_version: 1, runtimes: { codex: { ...CAPABILITIES.runtimes.codex, available: false } } });
  const action = nextAction(f, "review");
  assert.match(action, /correction impl-fix-1 of impl already started and has no claimable route: restore a claimable route in capabilities\.json or request a revised-roadmap decision/);
  assert.doesNotMatch(action, /claim correction impl-fix-1|withdraw/);
});

test("FR-007 an exhausted correction points to the next_action of the review that caused it", t => {
  const f = blockedReview(t);
  derive(f, { max_attempts: 1 }); finish(f, "impl-fix-1", "blocked", "fixer");
  assert.match(nextAction(f, "impl-fix-1"), /Correction exhausted: no further attempt of this mission; follow the next_action of review/);
  assert.match(nextAction(f, "review"), /derive a new correction for impl from the same receipt/);
});

test("FR-007 the release refusal promises an automatic requeue only when a gap can still be closed", t => {
  const f = blockedReview(t, [task("impl", [], { max_attempts: 1 }), task("review", ["impl"])]);
  unchanged(f, () => release(f, "review"), /derive a correction for impl; the task is requeued automatically once every blamed dependency has one/);
  derive(f, { max_attempts: 1 }); finish(f, "impl-fix-1", "blocked", "fixer"); // the cap of impl is reached
  const stateBytes = JSON.stringify(state(f));
  let message = "";
  try { release(f, "review"); } catch (err) { message = err.message; }
  assert.match(message, /cannot release review: blamed dependencies lack a done correction: no correction can be derived for impl \(impl-fix-1 exhausted\): impl already had 1 corrections/);
  assert.doesNotMatch(message, /requeued automatically/);
  assert.equal(JSON.stringify(state(f)), stateBytes);
});

test("FR-003 withdrawals are capped like corrections, so derive and withdraw-derived cannot alternate forever", t => {
  const f = blockedReview(t); // impl max_attempts 3
  for (let i = 1; i <= 3; i++) { assert.equal(derive(f).task_id, `impl-fix-${i}`); withdraw(f, `impl-fix-${i}`); }
  unchanged(f, () => derive(f), /cannot derive: impl already had 3 withdrawn corrections for this receipt of review, the limit set by its max_attempts; request a revised-roadmap decision/);
  assert.match(nextAction(f, "review"), /no correction can be derived for impl \(impl-fix-1 withdrawn, impl-fix-2 withdrawn, impl-fix-3 withdrawn\): impl already had 3 withdrawn corrections/);
  assert.equal(Object.keys(state(f).derived).length, 3);
});
