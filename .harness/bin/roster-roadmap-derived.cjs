"use strict";
// Derived correction missions: receipt blames, the derive transition and its definition digest,
// the FR-007 review requeue, the review release freeze, the fresh-context rule on correction
// chains, definition validation, their history replay and the per-attempt timeline. Identity
// labels (assignees, coordinators) are unauthenticated local assertions; the rules compare
// declared labels, they do not authenticate agents.
const { readJSON } = require("./roster-artifacts.cjs");
const v = require("./roster-roadmap-validate.cjs");
const m = require("./roster-roadmap-missions.cjs");
const { fail, keys, object, text, identifier, integer } = v;
const REQUEST = ["parent", "cause", "objective", "topology", "max_attempts"];
const DEFINITION = [...REQUEST, "revision"];
// FR-019 (owner decision 2): fields covered by the derive event's definition_digest.
const DIGESTED = ["parent", "cause", "objective", "topology", "max_attempts"];
function definitionDigest(definition) { return v.hash(Object.fromEntries(DIGESTED.map(name => [name, definition[name]]))); }
const OBJECTIVE_MAX = 2000;
function exact(value, names, label) {
  keys(value, names, label);
  for (const name of names) if (!Object.hasOwn(value, name)) fail(`${label}: missing field ${name}`);
}
function objective(value, label) {
  text(value, label);
  if (value.length > OBJECTIVE_MAX) fail(`${label} exceeds ${OBJECTIVE_MAX} characters`);
}
function topology(value, label) {
  v.validateTopology(value, label);
  // A derived mission has workflow "none", so the contract rule refuses the workflow route.
  if (value.route === "workflow") fail("workflow route needs accepted nonempty workflow steps");
}
function contractTask(ctx, id) { return m.contractTasks(ctx).find(task => task.id === id) || null; }
function latestReceipt(receipts, taskId) {
  for (let i = receipts.length - 1; i >= 0; i--) if (receipts[i].task_id === taskId) return receipts[i];
  return null;
}
// FR-001 blames (blocked only, direct dependencies) and the FR-006 ban on stored or live receipts.
function validateReceiptLinks(receipt, task) {
  const refusal = causeRefusal(task, receipt.assignee);
  if (refusal) fail(`receipt of ${task.id} refused: ${refusal}`);
  if (receipt.blames === undefined) return;
  if (receipt.result !== "blocked") fail("receipt.blames is allowed only on a blocked receipt");
  v.strings(receipt.blames, "receipt.blames", true);
  for (const id of receipt.blames) {
    identifier(id, "receipt.blames entry");
    if (!task.depends_on.includes(id)) fail(`receipt.blames names ${id}, which is not a direct dependency of ${task.id}`);
  }
}
// FR-009: state-internal shape of state.derived; every key must have a task state.
function validateDerivedShape(state) {
  if (state.derived === undefined) return;
  object(state.derived, "state.derived");
  for (const [id, definition] of Object.entries(state.derived)) {
    identifier(id, "derived mission id");
    if (!Object.hasOwn(state.tasks, id)) fail(`derived mission ${id} has no task state`);
    exact(definition, DEFINITION, `derived mission ${id}`);
    identifier(definition.parent, "derived parent");
    exact(definition.cause, ["task_id", "attempt_id", "assignee"], "derived cause");
    identifier(definition.cause.task_id, "derived cause task"); text(definition.cause.attempt_id, "derived cause attempt");
    identifier(definition.cause.assignee, "derived cause assignee");
    objective(definition.objective, "derived objective"); topology(definition.topology, "derived topology");
    integer(definition.max_attempts, "derived max_attempts", 1, 100); integer(definition.revision, "derived revision", 1);
  }
}
// Contract-bound checks of the stored definitions (accepted boards only).
function validateDefinitions(ctx) {
  for (const [id, definition] of m.derivedEntries(ctx)) {
    const parent = contractTask(ctx, definition.parent), cause = contractTask(ctx, definition.cause.task_id);
    if (contractTask(ctx, id)) fail(`derived mission ${id} collides with a contract task`);
    if (!parent || !cause || !cause.depends_on.includes(parent.id)) fail(`derived mission ${id} has an invalid parent or cause`);
    if (definition.max_attempts > parent.policy.max_attempts) fail(`derived mission ${id} budget exceeds its parent budget`);
  }
}
// FR-003 conditions derivable from state and contract; shared by derive and its replay.
function derivePrecondition(ctx, tasks, receipts, known, parentId, causeId) {
  const cause = contractTask(ctx, causeId), parent = contractTask(ctx, parentId);
  if (!cause) return `cause ${causeId} is not a contract task`;
  if (!parent) return `parent ${parentId} is not a contract task`;
  if (!cause.depends_on.includes(parentId)) return `${parentId} is not a direct dependency of ${causeId}`;
  if (tasks[causeId].status !== "blocked") return `cause ${causeId} is ${tasks[causeId].status}, not blocked`;
  const receipt = latestReceipt(receipts, causeId);
  if (!receipt || receipt.result !== "blocked") return `latest receipt of ${causeId} is not blocked`;
  if (!receipt.blames?.includes(parentId)) return `latest receipt of ${causeId} does not blame ${parentId}`;
  if (tasks[parentId].status !== "done") return `parent ${parentId} is not done`;
  if (cause.policy.on_failure !== "retry") return `cause ${causeId} policy does not authorize retry`;
  if (tasks[causeId].attempts >= cause.policy.max_attempts) return `cause ${causeId} attempt budget exhausted`;
  if (known.some(([, d]) => d.parent === parentId && d.cause.task_id === causeId && d.cause.attempt_id === receipt.attempt_id)) return `a derived mission already exists for ${parentId} and this receipt of ${causeId}`;
  return null;
}
function takenIds(ctx, known) { return new Set([...m.contractTasks(ctx).map(task => task.id), ...known.map(([id]) => id)]); }
function allocateId(parentId, taken) {
  const free = prefix => { let n = 1; while (taken.has(`${prefix}${n}`)) n++; return `${prefix}${n}`; };
  const id = free(`${parentId}-fix-`);
  return id.length <= 80 ? id : free("fix-");
}
function readRequest(ctx, file) {
  text(file, "--request");
  const request = readJSON(file);
  exact(request, REQUEST, "derive request");
  identifier(request.parent, "request.parent"); identifier(request.cause, "request.cause");
  objective(request.objective, "request.objective"); topology(request.topology, "request.topology");
  const parent = contractTask(ctx, request.parent);
  if (!parent) fail(`cannot derive: parent ${request.parent} is not a contract task`);
  integer(request.max_attempts, "request.max_attempts", 1, parent.policy.max_attempts);
  return request;
}
// FR-002..FR-004: board acceptance, completion and coordinator are checked by the core mutate.
function transitionDerive(ctx, options) {
  const { state } = ctx, request = readRequest(ctx, options.request), known = m.derivedEntries(ctx);
  const reason = derivePrecondition(ctx, state.tasks, state.receipts, known, request.parent, request.cause);
  if (reason) fail(`cannot derive: ${reason}`);
  // Live-only precondition (FR-010): never re-checked during replay.
  if (require("./roster-recovery.cjs").inspectBoard(ctx, request.cause).reframe_needed) fail("cannot derive: the cause needs a diagnosed recovery reframe first");
  const id = allocateId(request.parent, takenIds(ctx, known));
  identifier(id, "derived mission id");
  if (contractTask(ctx, id) || Object.hasOwn(state.tasks, id)) fail(`derived mission id ${id} collides with an existing mission`);
  const receipt = latestReceipt(state.receipts, request.cause);
  const definition = { parent: request.parent, cause: { task_id: request.cause, attempt_id: receipt.attempt_id, assignee: receipt.assignee },
    objective: request.objective, topology: request.topology, max_attempts: request.max_attempts, revision: state.revision + 1 };
  if (!state.derived) state.derived = {};
  state.derived[id] = definition;
  state.tasks[id] = { status: "queued", attempts: 0, assignment: null, reason: null };
  return { task_id: id, derived: definition };
}
function correctionsOf(known, causeId, attemptId) {
  return known.filter(([, d]) => d.cause.task_id === causeId && d.cause.attempt_id === attemptId).map(([id]) => id);
}
// FR-007 (owner decision 3): after a done receipt of a derived mission, requeue its cause only when
// every dependency blamed by the cause's latest blocked receipt has a done derived mission created
// from that receipt. Applies to live state or to a replay map.
function applyRequeue(task, receipt, tasks, receipts, known) {
  if (!task.derived || receipt.result !== "done") return null;
  const { task_id: causeId, attempt_id: attemptId } = task.derived.cause, latest = latestReceipt(receipts, causeId);
  if (tasks[causeId].status !== "blocked" || latest?.attempt_id !== attemptId) return null;
  const done = known.filter(([id, d]) => d.cause.task_id === causeId && d.cause.attempt_id === attemptId && tasks[id].status === "done");
  const covered = new Set(done.map(([, d]) => d.parent));
  if (!(latest.blames || []).every(id => covered.has(id))) return null;
  tasks[causeId].status = "queued"; tasks[causeId].reason = `corrections done: ${done.map(([id]) => id).join(", ")}`;
  return causeId;
}
function pendingCorrections(taskId, tasks, receipts, known) {
  const latest = latestReceipt(receipts, taskId);
  if (!latest || latest.result !== "blocked") return [];
  const budget = new Map(known.map(([id, d]) => [id, d.max_attempts]));
  return correctionsOf(known, taskId, latest.attempt_id).filter(id => {
    const current = tasks[id];
    return current.status !== "done" && !(current.status === "blocked" && current.attempts >= budget.get(id));
  });
}
// FR-007 freeze: the cause cannot be released while a correction of its latest receipt is pending.
function releaseRefusal(taskId, tasks, receipts, known) {
  const pending = pendingCorrections(taskId, tasks, receipts, known);
  return pending.length ? `corrections pending: ${pending.join(", ")}; the task is requeued automatically when they are done` : null;
}
// FR-006 (D2): never the assignee of the failed cause receipt. Also checked on stored receipts and
// active assignments, where the fresh-context rule below cannot apply (the attempt is its own).
function causeRefusal(task, assignee) {
  return task.derived && assignee === task.derived.cause.assignee ? `assignee ${assignee} produced the failed cause receipt and cannot take its correction` : null;
}
// FR-020 (owner decision 1): the correction chain of a derived mission with parent P and cause C is
// P, C and every derived mission with that parent and cause task (over every receipt of C). A cause
// C with at least one derived mission is on the union of its chains. Null: not on any chain.
function chainMembers(known, task) {
  if (task.derived) {
    const { parent, cause } = task.derived;
    return new Set([parent, cause.task_id, ...known.filter(([, d]) => d.parent === parent && d.cause.task_id === cause.task_id).map(([id]) => id)]);
  }
  const corrections = known.filter(([, d]) => d.cause.task_id === task.id);
  return corrections.length ? new Set([task.id, ...corrections.flatMap(([id, d]) => [d.parent, id])]) : null;
}
// Declared identities of every attempt of the members: receipts, claim payloads, active assignments.
function seenAssignees(members, { events, receipts, tasks }) {
  const seen = new Set();
  for (const receipt of receipts) if (members.has(receipt.task_id)) seen.add(receipt.assignee);
  for (const event of events) if (event.action === "claim" && event.assignment && members.has(event.task_id)) seen.add(event.assignment.assignee);
  for (const id of members) if (tasks?.[id]?.assignment) seen.add(tasks[id].assignment.assignee);
  return seen;
}
// history = { known, events, receipts, tasks? } as of the claim (live state or replay prefix).
function freshnessRefusal(task, assignee, history) {
  const members = chainMembers(history.known, task);
  if (!members || !seenAssignees(members, history).has(assignee)) return null;
  return `assignee ${assignee} already appeared on the correction chain of ${task.id} (${[...members].join(", ")}); claim with a newly launched agent`;
}
function claimRefusal(ctx, task, assignee) {
  const { events, receipts, tasks } = ctx.state;
  return causeRefusal(task, assignee) || freshnessRefusal(task, assignee, { known: m.derivedEntries(ctx), events, receipts, tasks });
}
function replayDerive(ctx, event, replay, receipts, known) {
  const definition = event.task_id === null ? undefined : ctx.state.derived?.[event.task_id];
  if (!definition || definition.revision !== event.revision || event.reason !== null || event.reconciled_by !== null || Object.hasOwn(replay, event.task_id)) fail(`derive history mismatch for ${event.task_id}`);
  if (definitionDigest(definition) !== event.definition_digest) fail(`derive history digest mismatch for ${event.task_id}: the definition changed after its derive event`);
  const reason = derivePrecondition(ctx, replay, receipts, known, definition.parent, definition.cause.task_id);
  if (reason) fail(`illegal derive history for ${event.task_id}: ${reason}`);
  const receipt = latestReceipt(receipts, definition.cause.task_id);
  if (receipt.attempt_id !== definition.cause.attempt_id || receipt.assignee !== definition.cause.assignee) fail(`derive history cause mismatch for ${event.task_id}`);
  if (allocateId(definition.parent, takenIds(ctx, known)) !== event.task_id) fail(`derive history id allocation mismatch for ${event.task_id}`);
  known.push([event.task_id, definition]);
  replay[event.task_id] = { status: "queued", attempts: 0, reason: null };
}
// history = { known, receiptIndex: { value } } of the replay at this claim event.
function checkClaimPayload(ctx, task, event, history) {
  const payload = event.assignment;
  // Chains only exist with the current tool, which always writes the claim payload.
  if (payload === undefined && (task.derived || chainMembers(history.known, task))) fail(`claim history of ${task.id} on a correction chain lacks its assignment`);
  if (payload === undefined) return;
  if (payload.runtime !== task.topology.runtime || payload.model !== task.topology.model || ![task.topology.route, ...task.topology.fallbacks].includes(payload.route)) fail(`claim history assignment disagrees with the topology of ${task.id}`);
  const prefix = { known: history.known, events: ctx.state.events.slice(0, event.revision - 1), receipts: ctx.state.receipts.slice(0, history.receiptIndex.value) };
  const refusal = causeRefusal(task, payload.assignee) || freshnessRefusal(task, payload.assignee, prefix);
  if (refusal) fail(`illegal claim history for ${task.id}: ${refusal}`);
}
function checkReceiptPayload(task, payload, receipt) {
  if (payload && (receipt.attempt_id !== payload.id || receipt.assignee !== payload.assignee)) fail(`receipt disagrees with its claim assignment for ${task.id}`);
}
function checkActivePayload(id, assignment, payload) {
  if (!assignment || !payload) return;
  if (["id", "assignee", "runtime", "route"].some(name => assignment[name] !== payload[name])) fail(`active assignment of ${id} disagrees with its claim history`);
}
function validateEventPayloads(event) {
  if (event.action === "derive" || event.definition_digest !== undefined) {
    if (event.action !== "derive") fail("state event definition_digest is allowed only on derive events");
    v.digestString(event.definition_digest, "derive event definition_digest");
  }
  if (event.assignment === undefined) return;
  if (event.action !== "claim") fail("state event assignment is allowed only on claim events");
  exact(event.assignment, ["id", "assignee", "runtime", "route", "model"], "claim event assignment");
  text(event.assignment.id, "claim event attempt id"); identifier(event.assignment.assignee, "claim event assignee");
  v.oneOf(event.assignment.runtime, v.RUNTIMES, "claim event runtime"); v.oneOf(event.assignment.route, v.ROUTES, "claim event route");
  text(event.assignment.model, "claim event model");
}
// View/prompt block of a derived mission: {parent, cause, created_at}; null for a contract task.
function derivedBlock(ctx, task) {
  if (!task.derived) return null;
  const event = ctx.state.events.find(e => e.action === "derive" && e.task_id === task.id);
  return { parent: task.derived.parent, cause: task.derived.cause, created_at: event?.at || null };
}
function claimPayload(assignment, task) {
  return { id: assignment.id, assignee: assignment.assignee, runtime: assignment.runtime, route: assignment.route, model: task.topology.model };
}
// Extra keys of a new state event: the claim payload, or the derive definition digest.
function eventPayload(ctx, command, result) {
  if (command === "claim") return { assignment: claimPayload(result.assignment, m.missionById(ctx, result.task_id)) };
  if (command === "derive") return { definition_digest: definitionDigest(result.derived) };
  return {};
}
module.exports = {
  validateReceiptLinks, validateDerivedShape, validateDefinitions, transitionDerive, applyRequeue, releaseRefusal,
  causeRefusal, claimRefusal, replayDerive, checkClaimPayload, checkReceiptPayload, checkActivePayload, validateEventPayloads,
  eventPayload, definitionDigest, allocateId, derivedBlock, entries: m.derivedEntries,
};
