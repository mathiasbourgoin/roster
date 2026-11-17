"use strict";
// Derived correction missions: receipt blames, the derive transition and its definition digest,
// the FR-007 review requeue, the strict review release refusal (OD-3), the fresh-context rule on
// a review's family (OD-1, OD-4), the freeze of every dependent of a dependency under correction
// (OD-5), withdrawal of a never-claimed correction (FR-022), definition validation and their
// history replay. Identity
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
// Settlement of one correction: done, withdrawn (FR-022), exhausted (blocked at its own budget)
// or pending (queued, active, or blocked with attempts left).
function correctionState(id, definition, tasks) {
  const current = tasks[id];
  if (current.status === "done" || current.status === "withdrawn") return current.status;
  return current.status === "blocked" && current.attempts >= definition.max_attempts ? "exhausted" : "pending";
}
// OD-5 (FR-024): a dependency with an open (pending) correction is unmet for every task that depends
// on it. Returns one label per such dependency; tasks is the live state or a replay map.
function frozenDependencies(task, tasks, known) {
  return task.depends_on.flatMap(dependency => {
    const open = known.filter(([id, d]) => d.parent === dependency && correctionState(id, d, tasks) === "pending").map(([id]) => id);
    return open.length ? [`${dependency} (open correction ${open.join(", ")})`] : [];
  });
}
function unreceiptedLegacyClaim(family, events) {
  const open = new Map();
  for (const event of events) {
    if (!family.has(event.task_id)) continue;
    if (event.action === "claim" && event.assignment === undefined) open.set(event.task_id, event);
    else if (event.action === "release" && open.has(event.task_id)) return open.get(event.task_id);
    else open.delete(event.task_id);
  }
  return null;
}
// FR-021 (mixed history, under OD-4): a family claim without assignment hides an identity only
// when its attempt left no receipt, that is when it was released while active. A recorded attempt
// is known by its receipt, so a board started with an older runtime can still derive.
function legacyClaimRefusal(family, events) {
  const event = unreceiptedLegacyClaim(family, events);
  return event ? `the claim of ${event.task_id} at revision ${event.revision} has no assignment (written by an older runtime or edited) and its attempt left no receipt, so the fresh-context rule cannot tell who already worked on the family of this review; revise the board instead` : null;
}
// FR-003 conditions derivable from state and contract; shared by derive and its replay.
// history = { tasks, receipts, events, known } as of the derivation (live state or replay prefix).
function derivePrecondition(ctx, history, parentId, causeId) {
  const { tasks, receipts, events, known } = history;
  const cause = contractTask(ctx, causeId), parent = contractTask(ctx, parentId);
  if (!cause) return `cause ${causeId} is not a contract task`;
  if (!parent) return `parent ${parentId} is not a contract task`;
  if (!cause.depends_on.includes(parentId)) return `${parentId} is not a direct dependency of ${causeId}`;
  if (tasks[causeId].status !== "blocked") return `cause ${causeId} is ${tasks[causeId].status}, not blocked`;
  const receipt = latestReceipt(receipts, causeId);
  if (!receipt || receipt.result !== "blocked") return `latest receipt of ${causeId} is not blocked`;
  if (!receipt.blames?.includes(parentId)) return `latest receipt of ${causeId} does not blame ${parentId}`;
  if (tasks[parentId].status !== "done") return `parent ${parentId} is not done`;
  if (cause.policy.on_failure !== "retry") return `cause ${causeId} policy does not authorize retry; request the blocking decision (a revised roadmap)`;
  if (tasks[causeId].attempts >= cause.policy.max_attempts) return `cause ${causeId} attempt budget exhausted; request a revised-roadmap decision`;
  // FR-003 B-exhaustion: a new correction for the same receipt only once earlier ones are settled.
  const same = known.filter(([, d]) => d.parent === parentId && d.cause.task_id === causeId && d.cause.attempt_id === receipt.attempt_id);
  const open = same.find(([id, d]) => ["done", "pending"].includes(correctionState(id, d, tasks)));
  if (open) return `correction ${open[0]} already exists for ${parentId} and this receipt of ${causeId} and is ${correctionState(open[0], open[1], tasks)}; derive again only after it is exhausted or withdrawn`;
  // Bound: a correction that never ran (withdrawn, FR-022) does not count; the others are capped by the parent's budget.
  const ran = same.filter(([id]) => tasks[id].status !== "withdrawn").length, withdrawn = same.length - ran;
  if (ran >= parent.policy.max_attempts) return `${parentId} already had ${ran} correction${ran === 1 ? "" : "s"} for this receipt of ${causeId}, the limit set by its max_attempts; request a revised-roadmap decision`;
  // The same cap bounds the withdrawals, so derive / withdraw-derived cannot alternate forever.
  if (withdrawn >= parent.policy.max_attempts) return `${parentId} already had ${withdrawn} withdrawn correction${withdrawn === 1 ? "" : "s"} for this receipt of ${causeId}, the limit set by its max_attempts; request a revised-roadmap decision`;
  return legacyClaimRefusal(correctionFamily(ctx, known, receipts, causeId, parentId), events);
}
// Every refusal of derive that does not depend on the request: FR-003 plus the live reframe check
// (FR-010: never re-checked during replay). Shared by derive, release and next_action.
function deriveBlocker(ctx, parentId, causeId) {
  const { tasks, receipts, events } = ctx.state;
  const reason = derivePrecondition(ctx, { tasks, receipts, events, known: m.derivedEntries(ctx) }, parentId, causeId);
  if (reason) return reason;
  try { if (require("./roster-recovery.cjs").inspectBoard(ctx, causeId).reframe_needed) return `${causeId} needs a diagnosed recovery reframe first; record it, then derive`; }
  catch { return `the recovery evidence of ${causeId} is invalid; reconcile it before deriving`; }
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
  const reason = deriveBlocker(ctx, request.parent, request.cause);
  if (reason) fail(`cannot derive: ${reason}`);
  // Live-only, like the reframe check (FR-010).
  if (!require("./roster-roadmap.cjs").viewSupport.routeFor(ctx, { topology: request.topology, workflow: { recommendation: "none", steps: [] } })) fail("cannot derive: no route of the requested topology is claimable now (runtime unavailable, or route unsupported or unauthorized with no permitted fallback)");
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
// OD-3: each dependency blamed by the latest blocked receipt of taskId that has no done correction
// from that receipt: { dependency, state: missing|pending|exhausted, correction, settled }, where
// settled lists its exhausted and withdrawn corrections as [id, state].
function blameGaps(taskId, tasks, receipts, known) {
  const latest = latestReceipt(receipts, taskId);
  if (!latest || latest.result !== "blocked" || !latest.blames) return [];
  const own = known.filter(([, d]) => d.cause.task_id === taskId && d.cause.attempt_id === latest.attempt_id);
  return latest.blames.map(dependency => {
    const states = own.filter(([, d]) => d.parent === dependency).map(([id, d]) => [id, correctionState(id, d, tasks)]);
    if (states.some(([, s]) => s === "done")) return null;
    const pending = states.find(([, s]) => s === "pending"), settled = states.filter(([, s]) => s !== "pending");
    if (pending) return { dependency, state: "pending", correction: pending[0], settled };
    return { dependency, state: settled.some(([, s]) => s === "exhausted") ? "exhausted" : "missing", correction: null, settled };
  }).filter(Boolean);
}
const settledText = settled => settled.length ? ` (${settled.map(([id, s]) => `${id} ${s}`).join(", ")})` : "";
// The step of a pending correction follows its state: each text names a gesture the tool accepts.
function pendingStep(correction, dependency, current) {
  if (current.status === "active") return `finish the active attempt of correction ${correction} of ${dependency} and record its receipt`;
  if (current.status === "blocked") return `release correction ${correction} of ${dependency} (it has attempts left), then claim it with a newly launched agent`;
  return `claim correction ${correction} of ${dependency} with a newly launched agent${current.attempts === 0 ? ", or withdraw it (withdraw-derived) if it cannot be claimed" : ""}`;
}
function describeGap({ dependency, state, correction, settled }, tasks) {
  if (state === "missing") return `derive a correction for ${dependency}${settledText(settled)}`;
  if (state === "pending") return pendingStep(correction, dependency, tasks[correction]);
  return `no correction of ${dependency} succeeded${settledText(settled)}: derive a new correction for ${dependency} from the same receipt, or request a revised-roadmap decision`;
}
function reframeState(ctx, id) {
  try { return require("./roster-recovery.cjs").inspectBoard(ctx, id).reframe_needed ? "needed" : null; } catch { return "invalid"; }
}
// Live obstacles of a pending correction that the state alone does not show: a release that the
// recovery streak refuses, or a started correction whose route is no longer claimable.
function livePendingStep(ctx, { correction, dependency }) {
  const current = ctx.state.tasks[correction], reframe = current.status === "blocked" ? reframeState(ctx, correction) : null;
  if (reframe === "needed") return `correction ${correction} of ${dependency} failed three times in a row and its release is refused: record a diagnosed reframe for it (roster-recovery reframe), then release it and claim it with a newly launched agent`;
  if (reframe === "invalid") return `the recovery evidence of correction ${correction} of ${dependency} is invalid: reconcile it, then release the correction`;
  const claimable = current.status !== "queued" || require("./roster-roadmap.cjs").viewSupport.routeFor(ctx, m.missionById(ctx, correction));
  if (!claimable && current.attempts > 0) return `correction ${correction} of ${dependency} already started and has no claimable route: restore a claimable route in capabilities.json or request a revised-roadmap decision`;
  return claimable ? null : `correction ${correction} of ${dependency} has no claimable route: withdraw it (withdraw-derived), or restore a claimable route in capabilities.json`;
}
// The same gaps for a live board, where a step the tool would refuse is replaced by its real way
// forward (policy, budgets, reframe, unknown identity, unclaimable route). closable: a correction
// exists or can be derived, so the automatic requeue can still happen.
function liveGaps(ctx, taskId) {
  const { tasks, receipts } = ctx.state;
  if (tasks[taskId]?.status !== "blocked") return [];
  return blameGaps(taskId, tasks, receipts, m.derivedEntries(ctx)).map(gap => {
    if (gap.state === "pending") return { text: livePendingStep(ctx, gap) || describeGap(gap, tasks), closable: true };
    const blocker = deriveBlocker(ctx, gap.dependency, taskId);
    return blocker ? { text: `no correction can be derived for ${gap.dependency}${settledText(gap.settled)}: ${blocker}`, closable: false } : { text: describeGap(gap, tasks), closable: true };
  });
}
function liveAdvice(ctx, taskId) {
  const gaps = liveGaps(ctx, taskId);
  return gaps.length ? gaps.map(gap => gap.text).join("; ") : null;
}
// OD-3 strict (FR-007): a blocked task cannot be released while a dependency blamed by its latest
// blocked receipt has no done correction; next_action carries the same text.
const frozenText = (advice, closable = true) => `blamed dependencies lack a done correction: ${advice}${closable ? "; the task is requeued automatically once every blamed dependency has one" : ""}`;
// The replayed refusal (state only) and the live one (same decision, real way forward in its text).
function releaseRefusal(taskId, tasks, receipts, known) {
  if (tasks[taskId]?.status !== "blocked") return null;
  const gaps = blameGaps(taskId, tasks, receipts, known);
  return gaps.length ? frozenText(gaps.map(gap => describeGap(gap, tasks)).join("; ")) : null;
}
function liveReleaseRefusal(ctx, taskId) {
  const gaps = liveGaps(ctx, taskId);
  return gaps.length ? frozenText(gaps.map(gap => gap.text).join("; "), gaps.some(gap => gap.closable)) : null;
}
// Advice for an active mission. N5: a correction on its last attempt cannot be released (budget)
// nor withdrawn (started). OD-5: a dependent of a dependency under correction cannot record done.
function activeAdvice(ctx, task, current) {
  if (current.status !== "active") return null;
  const frozen = frozenDependencies(task, ctx.state.tasks, m.derivedEntries(ctx));
  if (frozen.length) return `A dependency is under correction: ${frozen.join(", ")}. A done receipt is refused until the correction is done; wait for it, or record a blocked receipt.`;
  if (!task.derived || current.attempts < task.policy.max_attempts) return null;
  return "Last attempt of this correction: continue it. If its agent is gone, the coordinator records a blocked receipt under the attempt id and assignee of the assignment (accepted even after capabilities.json changed); release is refused at the budget.";
}
// An exhausted correction has no gesture of its own: the way forward belongs to its cause review.
function exhaustedAdvice(ctx, task) {
  if (!task.derived) return null;
  const cause = task.derived.cause.task_id;
  return ctx.state.tasks[cause].status === "blocked" ? `Correction exhausted: no further attempt of this mission; follow the next_action of ${cause}, the review that caused it.` : "Correction exhausted: kept for history; no further attempt.";
}
// N5: a blocked receipt only ends the attempt, so a correction accepts it after a capabilities change.
function acceptsStaleCapabilities(task, receipt) { return Boolean(task.derived) && receipt.result === "blocked"; }
// FR-006 (D2): never the assignee of the failed cause receipt. Also checked on stored receipts and
// active assignments, where the fresh-context rule below cannot apply (the attempt is its own).
function causeRefusal(task, assignee) {
  return task.derived && assignee === task.derived.cause.assignee ? `assignee ${assignee} produced the failed cause receipt and cannot take its correction` : null;
}
// FR-020 (owner decisions OD-1 and OD-4): the family of a review C is C, every dependency blamed by
// any receipt of C, every dependency of C that has a correction, and every correction of those
// dependencies, whichever review caused it.
function familyOf(ctx, known, receipts, causeId) {
  const depends = contractTask(ctx, causeId).depends_on, parents = new Set();
  for (const receipt of receipts) if (receipt.task_id === causeId) for (const id of receipt.blames || []) parents.add(id);
  for (const [, d] of known) if (depends.includes(d.parent)) parents.add(d.parent);
  const family = new Set([causeId, ...parents]);
  for (const [id, d] of known) if (parents.has(d.parent)) family.add(id);
  return family;
}
// OD-5: a correction also counts every contract task that depends on its parent, so an agent that
// holds or held an attempt of such a task (a second review started earlier) cannot write the fix.
function correctionFamily(ctx, known, receipts, causeId, parentId) {
  const family = familyOf(ctx, known, receipts, causeId);
  for (const task of m.contractTasks(ctx)) if (task.depends_on.includes(parentId)) family.add(task.id);
  return family;
}
// A derived mission is on the family of its cause, widened by the dependents of its parent; a
// contract task one of whose dependencies has a correction is on its own family. Null: the task is
// on no family (no rule applies).
function chainMembers(ctx, known, receipts, task) {
  if (task.derived) return correctionFamily(ctx, known, receipts, task.derived.cause.task_id, task.derived.parent);
  return known.some(([, d]) => task.depends_on.includes(d.parent)) ? familyOf(ctx, known, receipts, task.id) : null;
}
// Declared identities of every attempt of the members: receipts, claim payloads, active
// assignments. ownAttempt (record-time check) leaves out the attempt being recorded.
function seenAssignees(members, { events, receipts, tasks }, ownAttempt) {
  const seen = new Set();
  for (const receipt of receipts) if (members.has(receipt.task_id) && receipt.attempt_id !== ownAttempt) seen.add(receipt.assignee);
  for (const event of events) if (event.action === "claim" && event.assignment && members.has(event.task_id) && event.assignment.id !== ownAttempt) seen.add(event.assignment.assignee);
  for (const id of members) if (tasks?.[id]?.assignment && tasks[id].assignment.id !== ownAttempt) seen.add(tasks[id].assignment.assignee);
  return seen;
}
// history = { known, events, receipts, tasks? } as of the claim or record (live state or replay prefix).
function freshnessRefusal(ctx, task, assignee, history, ownAttempt = null) {
  const members = chainMembers(ctx, history.known, history.receipts, task);
  if (!members || !seenAssignees(members, history, ownAttempt).has(assignee)) return null;
  const exit = ownAttempt ? "record a blocked receipt or release this attempt, then claim with a newly launched agent" : "claim with a newly launched agent";
  return `assignee ${assignee} already appeared on the correction chain of ${task.id} (review family: ${[...members].join(", ")}); ${exit}`;
}
// OD-5 (FR-024): a done receipt is refused while a dependency of its task is under correction, and
// the fresh-context rule is checked again against every other attempt of the family. A blocked
// receipt always ends the attempt. history as above, taken before this receipt is stored.
function recordRefusal(ctx, task, receipt, history) {
  if (receipt.result !== "done") return null;
  const frozen = frozenDependencies(task, history.tasks, history.known);
  if (frozen.length) return `a done receipt of ${task.id} is refused while a dependency is under correction: ${frozen.join(", ")}; record it once the correction is done, or record a blocked receipt`;
  return freshnessRefusal(ctx, task, receipt.assignee, history, receipt.attempt_id);
}
function liveRecordRefusal(ctx, task, receipt) {
  const { events, receipts, tasks } = ctx.state;
  return recordRefusal(ctx, task, receipt, { known: m.derivedEntries(ctx), events, receipts, tasks });
}
function claimRefusal(ctx, task, assignee) {
  const { events, receipts, tasks } = ctx.state;
  return causeRefusal(task, assignee) || freshnessRefusal(ctx, task, assignee, { known: m.derivedEntries(ctx), events, receipts, tasks });
}
function replayDerive(ctx, event, replay, receipts, known) {
  const definition = event.task_id === null ? undefined : ctx.state.derived?.[event.task_id];
  if (!definition || definition.revision !== event.revision || event.reason !== null || event.reconciled_by !== null || Object.hasOwn(replay, event.task_id)) fail(`derive history mismatch for ${event.task_id}`);
  if (definitionDigest(definition) !== event.definition_digest) fail(`derive history digest mismatch for ${event.task_id}: the definition changed after its derive event`);
  const history = { tasks: replay, receipts, events: ctx.state.events.slice(0, event.revision - 1), known };
  const reason = derivePrecondition(ctx, history, definition.parent, definition.cause.task_id);
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
  const prefix = { known: history.known, events: ctx.state.events.slice(0, event.revision - 1), receipts: ctx.state.receipts.slice(0, history.receiptIndex.value) };
  // Families only exist with the current tool, which always writes the claim payload.
  if (payload === undefined && (task.derived || chainMembers(ctx, history.known, prefix.receipts, task))) fail(`claim history of ${task.id} on a correction chain lacks its assignment`);
  if (payload === undefined) return;
  if (payload.runtime !== task.topology.runtime || payload.model !== task.topology.model || ![task.topology.route, ...task.topology.fallbacks].includes(payload.route)) fail(`claim history assignment disagrees with the topology of ${task.id}`);
  const refusal = causeRefusal(task, payload.assignee) || freshnessRefusal(ctx, task, payload.assignee, prefix);
  if (refusal) fail(`illegal claim history for ${task.id}: ${refusal}`);
}
// history = { known, receiptIndex: { value } } once this receipt was consumed; tasks = replay map.
function checkReceiptPayload(ctx, task, payload, receipt, event, history, tasks) {
  if (payload && (receipt.attempt_id !== payload.id || receipt.assignee !== payload.assignee)) fail(`receipt disagrees with its claim assignment for ${task.id}`);
  const prefix = { known: history.known, events: ctx.state.events.slice(0, event.revision - 1), receipts: ctx.state.receipts.slice(0, history.receiptIndex.value - 1), tasks };
  const refusal = recordRefusal(ctx, task, receipt, prefix);
  if (refusal) fail(`illegal record history for ${task.id}: ${refusal}`);
}
function checkActivePayload(id, assignment, payload) {
  if (!assignment || !payload) return;
  if (["id", "assignee", "runtime", "route"].some(name => assignment[name] !== payload[name])) fail(`active assignment of ${id} disagrees with its claim history`);
}
// FR-022: withdraw-derived retires a queued correction that was never claimed, with a mandatory
// reason read from a file. A started correction ends by its receipts and budget, not by withdrawal.
function withdrawRefusal(current) {
  if (current.status !== "queued") return `it is ${current.status}; only a queued correction can be withdrawn`;
  return current.attempts === 0 ? null : `it was already claimed (${current.attempts} attempts); only a correction that never started can be withdrawn`;
}
function transitionWithdraw(ctx, options) {
  identifier(options.task, "--task");
  const definition = Object.hasOwn(ctx.state.derived || {}, options.task) ? ctx.state.derived[options.task] : null;
  if (!definition) fail(`cannot withdraw ${options.task}: not a derived correction mission`);
  const current = ctx.state.tasks[options.task];
  const refusal = withdrawRefusal(current);
  if (refusal) fail(`cannot withdraw ${options.task}: ${refusal}`);
  text(options.withdrawal, "--withdrawal");
  const input = readJSON(options.withdrawal);
  exact(input, ["reason"], "withdrawal file"); objective(input.reason, "withdrawal reason");
  current.status = "withdrawn"; current.reason = input.reason;
  return { task_id: options.task, withdrawn: true, reason: input.reason };
}
function replayWithdraw(ctx, event, replay) {
  const id = event.task_id, current = id === null ? undefined : replay[id];
  if (!current || !Object.hasOwn(ctx.state.derived || {}, id) || !Object.hasOwn(replay, id)) fail(`withdraw history names ${id}, which is not a derived mission at that point`);
  if (withdrawRefusal(current) || event.reconciled_by !== null) fail(`illegal withdraw history for ${id}: ${withdrawRefusal(current) || "it names a reconciliation actor"}`);
  current.status = "withdrawn"; current.reason = event.reason; current.payload = null;
}
function validateEventPayloads(event) {
  if (event.action === "withdraw-derived") {
    if (event.task_id === null) fail("withdraw-derived event needs its task");
    objective(event.reason, "withdraw-derived event reason");
  }
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
  if (command === "withdraw-derived") return { reason: result.reason };
  return {};
}
module.exports = {
  validateReceiptLinks, validateDerivedShape, validateDefinitions, transitionDerive, transitionWithdraw, replayWithdraw, applyRequeue, releaseRefusal,
  liveReleaseRefusal, liveAdvice, activeAdvice, exhaustedAdvice, acceptsStaleCapabilities, frozenDependencies,
  causeRefusal, claimRefusal, liveRecordRefusal, replayDerive, checkClaimPayload, checkReceiptPayload, checkActivePayload, validateEventPayloads,
  eventPayload, definitionDigest, allocateId, derivedBlock, entries: m.derivedEntries,
};
