"use strict";
// State-shape validation and execution-history replay for the roadmap core.
const v = require("./roster-roadmap-validate.cjs");
const { missions, contractTasks, completionReady } = require("./roster-roadmap-missions.cjs");
const derived = require("./roster-roadmap-derived.cjs");
const core = () => require("./roster-roadmap.cjs");
const { fail, keys, object, text, identifier, integer, array, oneOf, digestString } = v;
const AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
function validateEvent(event, index) {
  keys(event, ["revision", "action", "coordinator", "task_id", "reason", "reconciled_by", "at", "assignment", "definition_digest"], "state event");
  if (event.at !== undefined && (typeof event.at !== "string" || !AT.test(event.at) || !Number.isFinite(Date.parse(event.at)))) fail("invalid state event timestamp");
  if (event.revision !== index + 1) fail("state event revisions are not contiguous");
  oneOf(event.action, ["accept", "claim", "record", "release", "complete", "derive", "withdraw-derived"], "state event action");
  derived.validateEventPayloads(event);
  identifier(event.coordinator, "state event coordinator");
  if (event.task_id !== null) identifier(event.task_id, "state event task");
  if (event.reason !== null) text(event.reason, "state event reason");
  if (event.reconciled_by !== null) identifier(event.reconciled_by, "state event reconciliation actor");
}
function validateTaskState(id, task) {
  identifier(id, "state task id");
  keys(task, ["status", "attempts", "assignment", "reason"], "task state");
  // "withdrawn" is reachable only by a derived mission (FR-022); replay enforces it.
  oneOf(task.status, ["queued", "active", "blocked", "done", "withdrawn"], "task state status"); integer(task.attempts, "task attempts");
  if (task.reason !== null) text(task.reason, "task reason");
  if (task.assignment !== null) {
    keys(task.assignment, ["id", "assignee", "contract_digest", "capabilities_digest", "route", "runtime"], "assignment");
    text(task.assignment.id, "attempt id"); identifier(task.assignment.assignee, "assignment assignee");
    digestString(task.assignment.contract_digest, "assignment contract digest"); digestString(task.assignment.capabilities_digest, "assignment capabilities digest");
    oneOf(task.assignment.route, v.ROUTES, "assignment route"); oneOf(task.assignment.runtime, v.RUNTIMES, "assignment runtime");
  }
  if ((task.status === "active") !== (task.assignment !== null)) fail(`assignment/status mismatch for ${id}`);
  if (!["queued", "withdrawn"].includes(task.status) && task.attempts === 0) fail(`missing attempt for ${id}`);
}
function validateState(state) {
  keys(state, ["schema_version", "board_id", "revision", "coordinator", "acceptance", "tasks", "receipts", "events", "global_receipt", "derived"], "state");
  if (state.schema_version !== 1) fail("unsupported state schema_version");
  identifier(state.board_id, "state.board_id"); integer(state.revision, "state.revision");
  if (state.coordinator !== null) identifier(state.coordinator, "state.coordinator");
  if (state.acceptance !== null) {
    keys(state.acceptance, ["contract_digest", "decision"], "state.acceptance");
    digestString(state.acceptance.contract_digest, "acceptance.contract_digest");
    v.validateDecision(state.acceptance.decision);
    if (state.acceptance.decision.contract_digest !== state.acceptance.contract_digest) fail("acceptance decision digest mismatch");
    if (state.coordinator === null) fail("accepted board needs coordinator");
  }
  object(state.tasks, "state.tasks"); array(state.receipts, "state.receipts"); array(state.events, "state.events");
  if (state.events.length !== state.revision) fail("state revision/event history mismatch");
  state.events.forEach(validateEvent);
  for (const [id, task] of Object.entries(state.tasks)) validateTaskState(id, task);
  derived.validateDerivedShape(state);
  if (state.global_receipt !== null) object(state.global_receipt, "global receipt");
}
function replayClaim(ctx, task, current, event, replay, history) {
  if (current.status !== "queued" || current.attempts >= task.policy.max_attempts) fail(`illegal claim history for ${task.id}`);
  if (task.depends_on.some(id => replay[id].status !== "done")) fail(`claim history has unmet dependencies for ${task.id}`);
  derived.checkClaimPayload(ctx, task, event, history);
  current.attempts++; current.status = "active"; current.reason = null; current.payload = event.assignment || null;
}
function replayRecord(ctx, task, current, replay, history) {
  const receipt = ctx.state.receipts[history.receiptIndex.value++];
  if (current.status !== "active" || !receipt || receipt.task_id !== task.id || !["done", "blocked"].includes(receipt.result)) fail(`receipt/event history mismatch for ${task.id}`);
  derived.checkReceiptPayload(task, current.payload, receipt);
  current.status = receipt.result; current.reason = receipt.result === "blocked" ? receipt.summary : null; current.payload = null;
  derived.applyRequeue(task, receipt, replay, ctx.state.receipts.slice(0, history.receiptIndex.value), history.known);
}
function replayRelease(ctx, task, current, event, replay, history) {
  if (!["active", "blocked"].includes(current.status) || task.policy.on_failure !== "retry" || current.attempts >= task.policy.max_attempts) fail(`illegal release history for ${task.id}`);
  const refusal = derived.releaseRefusal(task.id, replay, ctx.state.receipts.slice(0, history.receiptIndex.value), history.known);
  if (refusal) fail(`illegal release history for ${task.id}: ${refusal}`);
  text(event.reason, "release history reason"); identifier(event.reconciled_by, "release history actor");
  current.status = "queued"; current.reason = event.reason; current.payload = null;
}
// history = { receiptIndex: { value }, known: [[derivedId, definition], ...] in creation order }.
function replayTaskEvent(ctx, event, replay, receiptIndex, known = []) {
  const history = { receiptIndex, known };
  if (event.action === "derive") return derived.replayDerive(ctx, event, replay, ctx.state.receipts.slice(0, receiptIndex.value), known);
  if (event.action === "withdraw-derived") return derived.replayWithdraw(ctx, event, replay);
  const task = core().taskById(ctx, event.task_id), current = replay[task.id];
  if (!current) fail(`history references ${task.id} before its derive event`);
  if (event.action === "claim") replayClaim(ctx, task, current, event, replay, history);
  else if (event.action === "record") replayRecord(ctx, task, current, replay, history);
  else if (event.action === "release") replayRelease(ctx, task, current, event, replay, history);
  else fail(`invalid task history action ${event.action}`);
}
function compareReplay(ctx, replay) {
  const { state } = ctx;
  const activeIds = new Set(state.receipts.map(receipt => receipt.attempt_id));
  const expectedIds = Object.keys(replay).sort().join("\n");
  if (Object.keys(state.tasks).sort().join("\n") !== expectedIds) fail("state task set disagrees with derive history");
  for (const task of missions(ctx)) {
    const actual = state.tasks[task.id], expected = replay[task.id];
    if (!expected) fail(`derived mission ${task.id} has no derive history`);
    if (actual.status !== expected.status || actual.attempts !== expected.attempts || actual.reason !== expected.reason) fail(`task ${task.id} state/attempt count disagrees with execution history`);
    derived.checkActivePayload(task.id, actual.assignment, expected.payload);
    if (actual.assignment) {
      if (activeIds.has(actual.assignment.id)) fail(`active attempt for ${task.id} duplicates a recorded or active assignment`);
      activeIds.add(actual.assignment.id);
    }
  }
}
function verifyHistory(ctx) {
  const { state } = ctx;
  if (!state.events.length || state.events[0].action !== "accept") fail("accepted roadmap is missing its acceptance history");
  const replay = Object.fromEntries(contractTasks(ctx).map(task => [task.id, { status: "queued", attempts: 0, reason: null }]));
  const receiptIndex = { value: 0 }, known = [];
  state.events.forEach((event, index) => {
    if (event.coordinator !== state.coordinator) fail("foreign coordinator in state history");
    if (event.action === "accept") {
      if (index !== 0 || event.task_id !== null) fail("acceptance history must occur exactly once at the beginning");
    } else if (event.action === "complete") {
      if (index !== state.events.length - 1 || event.task_id !== null || !state.global_receipt || !completionReady(ctx, replay)) fail("completion history is inconsistent");
    } else replayTaskEvent(ctx, event, replay, receiptIndex, known);
  });
  if (receiptIndex.value !== state.receipts.length) fail("stored receipt count differs from record history");
  if (known.length !== Object.keys(state.derived || {}).length) fail("derived mission definitions disagree with derive history");
  compareReplay(ctx, replay);
  if (Boolean(state.global_receipt) !== (state.events.at(-1).action === "complete")) fail("global receipt/completion history mismatch");
}
module.exports = { validateState, replayTaskEvent, verifyHistory };
