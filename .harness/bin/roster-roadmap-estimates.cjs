"use strict";

// Planner assertions only: forecasts never execute work or alter the accepted board.
const fs = require("node:fs");
const path = require("node:path");
const core = () => require("./roster-roadmap.cjs");
const AXES = ["optimistic", "likely", "pessimistic"];
const LIMIT = 16 * 1024 * 1024;
function fail(message) { throw new Error(`estimates: ${message}`); }
function fields(value, names, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.keys(value).some(key => !names.includes(key))) fail(`${label} contains unknown fields`);
}
function text(value, label) { if (typeof value !== "string" || !value.trim()) fail(`${label} must be nonempty text`); }
function integer(value, label) { if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a nonnegative integer`); }
function instant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} must be a UTC ISO timestamp`);
  if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(`${label} is not a valid calendar timestamp`);
  return Date.parse(value);
}
function range(value, label) {
  fields(value, AXES, label);
  for (const key of AXES) if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 5256000) fail(`${label}.${key} must be finite minutes in 0..5256000`);
  if (value.optimistic > value.likely || value.likely > value.pessimistic) fail(`${label} must be ordered optimistic <= likely <= pessimistic`);
}
function evidence(value, label) {
  if (!Array.isArray(value) || !value.length) fail(`${label} requires evidence references`);
  value.forEach(item => text(item, label));
}
function validateRecord(record, ctx) {
  fields(record, ["schema_version", "revision", "contract_digest", "based_on_state_revision", "writer", "basis", "evidence", "updated_at", "tasks", "global_verification_minutes"], "record");
  if (record.schema_version !== 1) fail("unsupported record schema");
  if (!/^[a-f0-9]{64}$/.test(record.contract_digest)) fail("invalid contract digest");
  integer(record.based_on_state_revision, "based_on_state_revision");
  for (const key of ["writer", "basis"]) text(record[key], key);
  evidence(record.evidence, "record.evidence"); instant(record.updated_at, "updated_at");
  fields(record.tasks, ctx.contract.tasks.map(task => task.id), "tasks");
  for (const [id, task] of Object.entries(record.tasks)) {
    fields(task, ["duration_minutes", "remaining"], `task ${id}`); range(task.duration_minutes, `task ${id} duration`);
    if (task.remaining !== undefined) {
      fields(task.remaining, ["attempt_id", "as_of", "minutes"], "remaining");
      text(task.remaining.attempt_id, "remaining.attempt_id"); instant(task.remaining.as_of, "remaining.as_of"); range(task.remaining.minutes, "remaining.minutes");
      if (Date.parse(task.remaining.as_of) > Date.parse(record.updated_at)) fail("remaining capture cannot follow updated_at");
    }
  }
  if (record.global_verification_minutes !== null) range(record.global_verification_minutes, "global_verification_minutes");
}
function readStore(ctx) {
  const file = path.join(ctx.board, "estimates.json"); core().io.safeAncestors(file);
  if (!fs.existsSync(file)) return { schema_version: 1, board_id: ctx.contract.id, revisions: [] };
  const store = core().io.readJSON(file);
  fields(store, ["schema_version", "board_id", "revisions"], "store");
  if (store.schema_version !== 1 || store.board_id !== ctx.contract.id || !Array.isArray(store.revisions) || !store.revisions.length) fail("invalid forecast history");
  store.revisions.forEach((record, i) => {
    validateRecord(record, ctx);
    if (record.revision !== i + 1) fail("forecast revisions must be contiguous");
    if (i && Date.parse(record.updated_at) < Date.parse(store.revisions[i - 1].updated_at)) fail("forecast timestamps must be ordered");
  });
  return store;
}
function validateUpdate(record, ctx, asOf) {
  validateRecord(record, ctx);
  if (record.revision !== undefined) fail("update cannot choose its revision");
  if (record.contract_digest !== core().hash(ctx.contract)) fail("update contract differs from current accepted contract");
  if (!ctx.state.acceptance) fail("accept the board before estimating");
  if (record.based_on_state_revision !== ctx.state.revision) fail("planner update must bind current board state revision");
  if (Date.parse(record.updated_at) > asOf) fail("updated_at cannot be in the future");
  for (const [id, task] of Object.entries(record.tasks)) {
    if (!task.remaining) continue;
    const current = ctx.state.tasks[id];
    if (current.status !== "active" || current.assignment.id !== task.remaining.attempt_id) fail(`remaining estimate for ${id} needs its active attempt identity`);
    const started = claimTime(ctx, id);
    if (started !== null && Date.parse(task.remaining.as_of) < started) fail(`remaining capture for ${id} predates its claim`);
  }
}
function update(board, options) {
  const revision = String(options.revision ?? "");
  if (!/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) fail("revision must be a nonnegative forecast revision");
  let ctx = core().readBoard(board);
  const lock = path.join(ctx.board, ".lock");
  core().io.safeAncestors(lock);
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (error) { fail(`forecast lock unavailable (${error.code}); inspect before explicit recovery`); }
  try {
    ctx = core().readBoard(board);
    const store = readStore(ctx);
    if (Number(revision) !== store.revisions.length) fail("stale forecast revision");
    const record = core().io.readJSON(options.update);
    validateUpdate(record, ctx, options.as_of === undefined ? Date.now() : instant(options.as_of, "as_of"));
    if (store.revisions.length && Date.parse(record.updated_at) < Date.parse(store.revisions.at(-1).updated_at)) fail("forecast timestamps must be ordered; update predates the previous forecast");
    store.revisions.push({ ...record, revision: store.revisions.length + 1 });
    if (Buffer.byteLength(JSON.stringify(store, null, 2) + "\n", "utf8") > LIMIT) fail("forecast history exceeds 16 MiB; preserve it and explicitly archive before further updates");
    // Serialize only estimates; refuse if execution moved during planner capture.
    const latest = core().readBoard(board);
    if (latest.state.revision !== ctx.state.revision || core().hash(latest.contract) !== record.contract_digest) fail("board changed during forecast update");
    core().io.atomicWrite(path.join(ctx.board, "estimates.json"), store);
    return { schema_version: 1, revision: store.revisions.length, based_on_state_revision: record.based_on_state_revision, updated: true };
  } finally { fs.rmdirSync(lock); }
}
function claimTime(ctx, id) {
  const claims = ctx.state.events.filter(event => event.action === "claim" && event.task_id === id);
  const at = claims.at(-1)?.at;
  if (!at) return null;
  try { return instant(at, "claim.at"); } catch { return null; }
}
function taskEstimate(ctx, task, record, now) {
  const current = Object.hasOwn(ctx.state.tasks, task.id) ? ctx.state.tasks[task.id] : { status: "draft" };
  const estimate = record && Object.hasOwn(record.tasks, task.id) ? record.tasks[task.id] : null;
  const item = { id: task.id, status: current.status, duration_minutes: estimate?.duration_minutes || null, remaining_minutes: null, source: null, overdue: false, reestimate_needed: false, reasons: [] };
  if (current.status === "done") { item.remaining_minutes = Object.fromEntries(AXES.map(key => [key, 0])); item.source = "completed"; return item; }
  if (current.status === "active") {
    if (current.assignment.capabilities_digest !== core().hash(ctx.capabilities)) { item.reasons.push("capabilities changed during active assignment; reconcile before forecasting completion"); return item; }
    const assigned = { ...task, topology: { ...task.topology, route: current.assignment.route, fallbacks: [] } };
    if (!core().viewSupport.routeFor(ctx, assigned)) { item.reasons.push("active assignment runtime or route is currently unavailable or unauthorized"); return item; }
  }
  if (current.status === "blocked") item.reasons.push(current.reason || "mission blocked");
  if (!estimate) { item.reasons.push("missing task duration"); return item; }
  if (current.status !== "active") { item.remaining_minutes = estimate.duration_minutes; item.source = "planner-duration"; return item; }
  const remaining = estimate.remaining;
  let start, minutes;
  if (remaining && remaining.attempt_id === current.assignment.id) {
    start = Date.parse(remaining.as_of); minutes = remaining.minutes; item.source = "planner-remaining";
    const claimed = claimTime(ctx, task.id);
    if (claimed !== null && start < claimed) { item.reasons.push("remaining capture predates its claim"); return item; }
  } else if (remaining) { item.reasons.push("remaining estimate belongs to a different attempt"); return item; }
  else { start = claimTime(ctx, task.id); minutes = estimate.duration_minutes; item.source = "claim-time"; }
  if (start === null || start > now) { item.reasons.push("active age unknown or start is in the future"); return item; }
  const elapsed = (now - start) / 60000;
  item.overdue = elapsed > minutes.likely; item.reestimate_needed = item.overdue;
  if (elapsed > minutes.pessimistic) { item.reasons.push("active mission exceeded pessimistic duration; reestimate required"); return item; }
  item.remaining_minutes = Object.fromEntries(AXES.map(key => [key, Math.max(0, minutes[key] - elapsed)]));
  if (item.overdue) item.reasons.push("active mission exceeded likely duration; range is conditional, reestimate requested");
  return item;
}
function recoveryReason(ctx, task) {
  try {
    const file = path.join(__dirname, "roster-recovery.cjs");
    if (fs.existsSync(file) && require(file).inspectBoard(ctx, task.id).reframe_needed) return "diagnosed recovery reframe required";
  } catch { return "invalid recovery evidence"; }
  return null;
}
function simulate(ctx, tasks, axis) {
  const state = { ...ctx.state, tasks: Object.fromEntries(Object.entries(ctx.state.tasks).map(([id, current]) => [id, { ...current }])) };
  const simulated = { ...ctx, state }, running = new Map(), values = new Map(tasks.map(task => [task.id, task]));
  let time = 0;
  for (const task of ctx.contract.tasks) if (state.tasks[task.id].status === "active") running.set(task.id, values.get(task.id).remaining_minutes[axis]);
  for (let turn = 0; turn <= ctx.contract.tasks.length * 2 + 1; turn++) {
    for (const [id, finish] of running) if (finish <= time) { state.tasks[id].status = "done"; running.delete(id); }
    for (const task of ctx.contract.tasks) {
      if (state.tasks[task.id].status !== "queued" || core().canClaimBasic(simulated, task) || recoveryReason(ctx, task)) continue;
      state.tasks[task.id].status = "active"; running.set(task.id, time + values.get(task.id).remaining_minutes[axis]);
    }
    if (Object.values(state.tasks).every(task => task.status === "done")) return { minutes: time, reasons: [] };
    if (!running.size) return { minutes: null, reasons: ctx.contract.tasks.filter(task => state.tasks[task.id].status !== "done").map(task => `${task.id}: ${recoveryReason(ctx, task) || core().canClaimBasic(simulated, task) || "mission blocked"}`) };
    time = Math.min(...running.values());
  }
  return { minutes: null, reasons: ["schedule could not converge"] };
}
function eta(status, minutes, now, reasons = []) {
  if (minutes && AXES.some(key => !Number.isFinite(now + minutes[key] * 60000) || Math.abs(now + minutes[key] * 60000) > 8640000000000000)) return { status: "unknown", remaining_minutes: null, finish_at: null, reasons: [...reasons, "forecast exceeds representable date horizon"] };
  return { status, remaining_minutes: minutes, finish_at: minutes && status !== "complete" ? Object.fromEntries(AXES.map(key => [key, new Date(now + minutes[key] * 60000).toISOString()])) : null, reasons };
}
function forecast(ctx, options = {}) {
  const now = options.as_of === undefined ? Date.now() : instant(options.as_of, "as_of");
  const digest = core().hash(ctx.contract), reasons = [];
  let store, record;
  try {
    store = readStore(ctx); record = store.revisions.at(-1);
    if (record && record.contract_digest !== digest) { reasons.push("forecast contract is stale"); record = null; }
    if (record && (record.based_on_state_revision > ctx.state.revision || Date.parse(record.updated_at) > now)) { reasons.push("forecast capture is ahead of current state/time"); record = null; }
  } catch (error) { reasons.push(error.message); }
  const tasks = ctx.contract.tasks.map(task => taskEstimate(ctx, task, record, now));
  if (!ctx.state.acceptance) reasons.push("roadmap not accepted");
  for (const task of tasks) if (!task.remaining_minutes) reasons.push(`${task.id}: ${task.reasons.join("; ")}`);
  let tasksEta;
  if (!ctx.state.acceptance) tasksEta = eta("unknown", null, now, reasons);
  else if (tasks.every(task => task.status === "done")) tasksEta = eta("complete", Object.fromEntries(AXES.map(key => [key, 0])), now);
  else if (reasons.length) tasksEta = eta("unknown", null, now, reasons);
  else {
    const runs = AXES.map(axis => simulate(ctx, tasks, axis));
    const duration = { optimistic: Math.min(...runs.map(run => run.minutes)), likely: runs[1].minutes, pessimistic: Math.max(...runs.map(run => run.minutes)) };
    tasksEta = runs.some(run => run.minutes === null) ? eta("unknown", null, now, [...new Set(runs.flatMap(run => run.reasons))]) : eta("conditional", duration, now, tasks.flatMap(task => task.reasons.map(reason => `${task.id}: ${reason}`)));
  }
  let globalEta;
  if (ctx.state.global_receipt) globalEta = eta("complete", Object.fromEntries(AXES.map(key => [key, 0])), now);
  else if (!record?.global_verification_minutes) globalEta = eta("unknown", null, now, ["global verification duration unknown"]);
  else if (!tasksEta.remaining_minutes) globalEta = eta("unknown", null, now, tasksEta.reasons);
  else globalEta = eta("conditional", Object.fromEntries(AXES.map(key => [key, tasksEta.remaining_minutes[key] + record.global_verification_minutes[key]])), now, tasksEta.reasons);
  return { schema_version: 1, as_of: new Date(now).toISOString(), estimate_revision: store?.revisions.length || 0, contract_digest: digest, based_on_state_revision: record?.based_on_state_revision ?? null, status: globalEta.status, tasks_eta: tasksEta, global_eta: globalEta, tasks, assumptions: ["Planner ranges are local assertions, not guarantees.", "Queued missions assume dispatch from the current observation time and successful completion without retries.", "Deterministic contract-order list scheduling respects observed authorization, dependency, capacity and write-scope limits.", "Global verification follows task completion; no global-check start receipt exists, so its duration assumes dispatch then.", "Forecasts never authorize dispatch or replace child pipeline/recovery gates."] };
}

module.exports = { forecast, update };
