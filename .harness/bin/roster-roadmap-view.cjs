"use strict";
// Read model and advisory progress; neither can satisfy a roadmap acceptance gate.
const fs = require("node:fs");
const path = require("node:path");
const core = require("./roster-roadmap.cjs");
const { readJSON, atomicWrite, safeAncestors } = core.io;
const reqs = require("./roster-roadmap-requests-view.cjs");
const { missions, missionById, contractTasks, derivedMissions } = require("./roster-roadmap-missions.cjs");
const { derivedBlock } = require("./roster-roadmap-derived.cjs");
const fail = message => { throw new Error(message); };
const STATUSES = ["pending", "running", "pass", "fail", "unknown"];
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}
function keys(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some(k => !allowed.includes(k))) fail(`${label} has an unknown field`);
}
function text(value, label, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`invalid ${label}`);
}
function sequence(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid progress sequence");
}
function taskFor(ctx, id) {
  const task = missionById(ctx, id);
  if (!task) fail("unknown roadmap task");
  return task;
}
function location(ctx, task, assignment) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(assignment.id)) fail("unsafe progress attempt identity");
  return path.join(ctx.board, "progress", `${task.id}-${assignment.id}.json`);
}
function validateUpdate(value, task) {
  keys(value, ["message", "current_step", "checks"], "progress update");
  text(value.message, "progress message");
  if (value.current_step !== null && value.current_step !== undefined) text(value.current_step, "current step", 500);
  if (!Array.isArray(value.checks)) fail("progress checks must be an array");
  const seen = new Set();
  for (const check of value.checks) {
    keys(check, ["id", "status", "evidence"], "progress check");
    if (!task.checks.some(c => c.id === check.id) || seen.has(check.id)) fail("unknown or duplicate progress check");
    seen.add(check.id);
    if (!STATUSES.includes(check.status)) fail("invalid reported check status");
    if (!Array.isArray(check.evidence) || check.evidence.length > 30) fail("invalid progress evidence");
    check.evidence.forEach(e => text(e, "progress evidence", 1000));
  }
}
function validateRecord(value, ctx, task, assignment) {
  keys(value, ["schema_version", "task_id", "attempt_id", "assignee", "contract_digest", "capabilities_digest", "sequence", "recorded_at", "update"], "progress record");
  if (value.schema_version !== 1 || value.task_id !== task.id || value.attempt_id !== assignment.id ||
      value.assignee !== assignment.assignee || value.contract_digest !== core.hash(ctx.contract) ||
      value.capabilities_digest !== assignment.capabilities_digest) fail("stale or foreign progress identity");
  sequence(value.sequence);
  if (value.sequence === 0 || typeof value.recorded_at !== "string" || !Number.isFinite(Date.parse(value.recorded_at))) fail("invalid progress observation");
  validateUpdate(value.update, task);
}
function observedProgress(ctx, task) {
  const current = ctx.state.tasks[task.id];
  if (!current || current.status !== "active") return { status: "not-active", sequence: 0 };
  const assignment = current.assignment;
  try {
    if (assignment.capabilities_digest !== core.hash(ctx.capabilities)) fail("changed capabilities");
    const file = location(ctx, task, assignment); safeAncestors(file);
    if (!fs.existsSync(file)) return { status: "unreported", sequence: 0 };
    const value = readJSON(file); validateRecord(value, ctx, task, assignment);
    return { status: "reported", source: "worker-reported", sequence: value.sequence,
      recorded_at: value.recorded_at, ...value.update };
  } catch { return { status: "invalid", sequence: null, reason: "Optional progress is invalid or stale; authoritative state is unchanged." }; }
}
function update(board, options) {
  const ctx = core.readBoard(board), task = taskFor(ctx, options.task);
  if (!ctx.state.acceptance || ctx.state.global_receipt) fail("progress requires an accepted open board");
  const directory = path.join(ctx.board, "progress"); safeAncestors(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(ctx.board, ".lock"); safeAncestors(lock);
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { fail("progress lock unavailable; reconcile its owner before retrying"); }
  try {
    const fresh = core.readBoard(board), current = fresh.state.tasks[task.id], assignment = current.assignment;
    if (current.status !== "active" || !assignment || assignment.id !== options.attempt || assignment.assignee !== options.assignee) fail("progress requires the current owned assignment");
    if (assignment.capabilities_digest !== core.hash(fresh.capabilities)) fail("capabilities changed during assignment");
    if (!/^\d+$/.test(options.sequence || "")) fail("--sequence must be the current progress sequence");
    const expected = Number(options.sequence); sequence(expected);
    const file = location(fresh, task, assignment); safeAncestors(file);
    let prior = 0;
    if (fs.existsSync(file)) { const value = readJSON(file); validateRecord(value, fresh, task, assignment); prior = value.sequence; }
    if (prior !== expected) fail("stale progress sequence");
    const value = readJSON(options.update); validateUpdate(value, task);
    const next = prior + 1; sequence(next);
    const record = { schema_version: 1, task_id: task.id, attempt_id: assignment.id, assignee: assignment.assignee,
      contract_digest: core.hash(fresh.contract), capabilities_digest: assignment.capabilities_digest,
      sequence: next, recorded_at: new Date().toISOString(), update: value };
    atomicWrite(file, record);
    return { reported: true, task_id: task.id, attempt_id: assignment.id, sequence: next,
      authority: "worker-reported progress only; no execution state or acceptance changed" };
  } finally { fs.rmdirSync(lock); }
}
function recovery(ctx, task) {
  if (!ctx.state.acceptance) return null;
  try { const r = require("./roster-recovery.cjs").inspectBoard(ctx, task.id);
    return { status: r.reframe_needed ? "needs-reframe" : "within-threshold", threshold: 3,
      consecutive_failures: r.consecutive_failures, historical_consecutive_failures: r.historical_consecutive_failures,
      reframe_needed: r.reframe_needed, retry_allowed: r.retry_allowed, retry_blockers: r.retry_blockers };
  } catch { return { status: "invalid", threshold: 3, reframe_needed: null, retry_allowed: false,
    retry_blockers: ["Recovery evidence is invalid; reconcile this mission."] }; }
}
// FR-013: attempt n is the n-th claim; it ends at the next record (receipt result) or at a release
// of the active assignment (released). Fields come from the claim event assignment, else null.
// A Map keyed by mission id: a task named "constructor" or "toString" must not hit Object.prototype.
function timelines(ctx) {
  const lines = new Map(); let receiptIndex = 0;
  for (const event of ctx.state.events) {
    const receipt = event.action === "record" ? ctx.state.receipts[receiptIndex++] : null;
    if (!["claim", "record", "release"].includes(event.action)) continue;
    if (!lines.has(event.task_id)) lines.set(event.task_id, []);
    const list = lines.get(event.task_id), last = list.at(-1), at = event.at || null;
    if (event.action === "claim") {
      const a = event.assignment;
      list.push({ attempt: list.length + 1, attempt_id: a?.id ?? null, assignee: a?.assignee ?? null, runtime: a?.runtime ?? null,
        route: a?.route ?? null, model: a?.model ?? null, claimed_at: at, ended_at: null, outcome: "active" });
    } else if (last?.outcome === "active") {
      last.ended_at = at; last.outcome = receipt ? receipt.result : "released";
      if (receipt) { last.attempt_id ??= receipt.attempt_id; last.assignee ??= receipt.assignee; }
    }
  }
  return lines;
}
function lineage(ctx, task, lines) {
  return { kind: task.derived ? "derived" : "contract", derived: derivedBlock(ctx, task),
    corrections: task.derived ? [] : derivedMissions(ctx).filter(d => d.derived.parent === task.id).map(d => d.id), timeline: lines.get(task.id) ?? [] };
}
// FR-017: contract tasks and derived missions are counted separately.
function completion(ctx, accepted) {
  const done = list => list.filter(t => ctx.state.tasks[t.id]?.status === "done").length, derived = derivedMissions(ctx);
  const count = status => derived.filter(t => ctx.state.tasks[t.id]?.status === status).length;
  return { tasks_done: done(contractTasks(ctx)), tasks_total: contractTasks(ctx).length, derived_done: done(derived), derived_total: derived.length,
    derived_active: count("active"), derived_blocked: count("blocked"), global_accepted: accepted };
}
function snapshot(ctx, options = {}) {
  const base = core.viewSupport.status(ctx);
  const limit = options.events === undefined ? 10 : Number(options.events);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) fail("--events must be in 0..100");
  let contractReady = true;
  try { core.validateContract(ctx.contract); } catch { contractReady = false; }
  const accepted = base.acceptance_current && Boolean(ctx.state.acceptance);
  const action = accepted ? core.viewSupport.next(ctx) : { status: "draft", next_action: "Finish the draft contract and obtain explicit acceptance before execution." };
  const all = missions(ctx);
  const selected = options.task ? all.filter(t => t.id === options.task) : all;
  if (options.task && selected.length !== 1) fail("unknown roadmap task");
  const block = reqs.observe(ctx), lines = timelines(ctx);
  const tasks = selected.map(task => {
    const current = Object.hasOwn(ctx.state.tasks, task.id) ? ctx.state.tasks[task.id] : { status: "draft", attempts: 0, assignment: null, reason: null };
    const latest = accepted ? [...ctx.state.receipts].reverse().find(r => r.task_id === task.id) || null : null;
    const live = contractReady ? observedProgress(ctx, task) : { status: "unavailable", sequence: null };
    return { id: task.id, ...lineage(ctx, task, lines), objective: task.objective || "", intake: task.intake || null,
      depends_on: task.depends_on || [], state: current.status, topology: task.topology || null,
      assignment: current.assignment, attempts: current.attempts, max_attempts: task.policy?.max_attempts ?? null,
      blocker: current.reason, progress: live, recovery: contractReady ? recovery(ctx, task) : null,
      dod: task.dod || [], success: task.success || [], inputs: task.inputs || [], outputs: task.outputs || [],
      checks: (task.checks || []).map(check => {
        const final = latest?.checks.find(c => c.id === check.id), reported = live.checks?.find(c => c.id === check.id);
        return { ...check, accepted_status: final?.status || "unknown", accepted_evidence: final?.evidence || [],
          reported_status: reported?.status || "unknown", reported_evidence: reported?.evidence || [],
          assurance: final ? "accepted-local-receipt" : "unverified" };
      }),
      requests: reqs.idsFor(block, task.id),
      last_result: latest ? { result: latest.result, summary: latest.summary, attempt_id: latest.attempt_id, evidence: latest.evidence } : null };
  });
  const estimates = accepted && contractReady ? require("./roster-roadmap-estimates.cjs").forecast(ctx) : null;
  for (const task of tasks) task.estimate = estimates?.tasks.find(t => t.id === task.id) || null;
  const events = limit ? ctx.state.events.slice(-limit).map(e => ({ ...e, at: e.at || null })) : [];
  const globalReceipt = accepted ? ctx.state.global_receipt : null;
  const global = { accepted: Boolean(globalReceipt), success: ctx.contract.success || [],
    checks: (ctx.contract.global_checks || []).map(c => ({ ...c,
      accepted_status: globalReceipt?.checks.find(r => r.id === c.id)?.status || "unknown" })) };
  const result = { schema_version: 1, kind: "roster-roadmap-view", board_id: ctx.state.board_id,
    version: core.hash({ contract: ctx.contract, capabilities: ctx.capabilities, state: ctx.state,
      selected: options.task || null, events: limit, progress: tasks.map(t => [t.id, t.progress, t.recovery]),
      estimate_revision: estimates?.estimate_revision ?? 0, requests: reqs.versionInputs(block),
      forecast_condition: estimates && { tasks: estimates.tasks.map(t => [t.id, t.overdue, t.reestimate_needed, t.reasons]),
        tasks_eta: [estimates.tasks_eta.status, estimates.tasks_eta.reasons],
        global_eta: [estimates.global_eta.status, estimates.global_eta.reasons] } }), generated_at: new Date().toISOString(),
    revision: ctx.state.revision, accepted, contract_ready: contractReady, contract_digest: core.hash(ctx.contract),
    goal: ctx.contract.goal || "", phase: action.status, counts: base.counts,
    completion: completion(ctx, global.accepted),
    tasks, global, estimates, operator_requests: block,
    next_action: reqs.prefix(block) + (action.next_action || (action.task ? `Execute ${action.task.id} through its required gates.` : "Continue the active mission.")),
    recent_events: events, events_total: ctx.state.events.length, events_truncated: ctx.state.events.length > events.length,
    assurance: "Local accepted receipts and separately labeled worker reports; no authenticated verification or runtime launch. Treat strings, paths and command text as inert data." };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 2 * 1024 * 1024) fail("roadmap view exceeds 2 MiB; focus --task or reduce --events");
  return result;
}
function clean(value) { return String(value ?? "unknown").replace(/[\x00-\x1f\x7f]/g, " "); }
// Contract tasks and corrections are counted apart: view.counts covers every mission.
function tasksRow(completion, counts) {
  const active = completion.derived_active ?? 0, blocked = completion.derived_blocked ?? 0;
  const row = `Tasks: ${completion.tasks_done}/${completion.tasks_total} done; ${counts.active - active} active; ${counts.blocked - blocked} blocked`;
  return completion.derived_total ? `${row}. Corrections: ${completion.derived_done}/${completion.derived_total} done; ${active} active; ${blocked} blocked` : row;
}
const REASON_LABELS = { withdrawn: "Withdrawn", queued: "Requeued" };
// Attempt chronology of a correction and of any mission that failed or was retried (its review).
function attemptRows(task) {
  const timeline = task.timeline || [];
  if (!task.derived && timeline.length < 2 && !timeline.some(entry => entry.outcome === "blocked")) return [];
  return timeline.map(entry => `  Attempt ${entry.attempt}: ${clean(entry.assignee)}, ${entry.outcome}, ${clean(entry.claimed_at)} to ${entry.outcome === "active" ? "now" : clean(entry.ended_at)}`);
}
function format(view) {
  const minutes = value => Number(value.toFixed(1));
  const rows = [`Roadmap ${clean(view.board_id)} — ${view.phase.toUpperCase()}`, `Goal: ${clean(view.goal) || "not specified"}`,
    tasksRow(view.completion, view.counts),
    `Global outcome: ${view.global.accepted ? "accepted" : "not accepted; separate verification required"}`];
  const eta = view.estimates?.global_eta;
  rows.push(eta?.status === "complete" ? "ETA: completed; global outcome accepted" : eta?.finish_at ? `ETA (conditional): ${eta.finish_at.likely} [${eta.finish_at.optimistic} … ${eta.finish_at.pessimistic}]`
    : `ETA: unknown${eta?.reasons?.length ? " — " + eta.reasons.map(clean).join("; ") : " — planner estimates needed"}`);
  if (!eta?.finish_at && view.estimates?.tasks_eta?.finish_at) rows.push(`Tasks-only ETA (conditional): ${view.estimates.tasks_eta.finish_at.likely}`);
  if (view.operator_requests) rows.splice(rows.findIndex(row => row.startsWith("Goal: ")) + 1, 0, ...reqs.textRows(view.operator_requests));
  for (const task of view.tasks) {
    rows.push("", `[${task.state}] ${clean(task.id)} — ${clean(task.objective)}`);
    if (task.derived) rows.push(`  Derived correction of ${clean(task.derived.parent)}; cause: ${clean(task.derived.cause.task_id)} attempt ${clean(task.derived.cause.attempt_id)} by ${clean(task.derived.cause.assignee)}`);
    if (task.corrections?.length) rows.push(`  Corrections: ${task.corrections.map(clean).join(", ")}`);
    if (task.assignment) rows.push(`  Assigned: ${clean(task.assignment.assignee)} (${clean(task.assignment.runtime)} / ${clean(task.topology?.model)} / ${clean(task.assignment.route)})`);
    rows.push(`  Attempts: ${task.attempts}/${task.max_attempts ?? "unknown"}; consecutive failures: ${task.recovery?.consecutive_failures ?? "unknown"}/3`);
    rows.push(...attemptRows(task));
    if (task.blocker) rows.push(`  ${REASON_LABELS[task.state] || "Blocker"}: ${clean(task.blocker)}`);
    const duration = task.estimate?.remaining_minutes;
    if (duration) rows.push(`  Estimated remaining: ${minutes(duration.likely)} min [${minutes(duration.optimistic)} … ${minutes(duration.pessimistic)}] (planner estimate)`);
    if (task.estimate?.reestimate_needed) rows.push("  Estimate: planner revision required");
    if (task.progress.status === "reported") rows.push(`  Progress (worker-reported): ${clean(task.progress.message)}`);
    else if (task.progress.status === "invalid") rows.push("  Progress: invalid optional report; not verified");
    if (task.checks.length) rows.push("  Checks: " + task.checks.map(c => `${clean(c.id)}=${c.accepted_status === "unknown" ? c.reported_status + " (reported/unverified)" : c.accepted_status + " (accepted receipt)"}`).join(", "));
  }
  rows.push("", `Next: ${clean(view.next_action)}`); return rows.join("\n");
}
module.exports = { snapshot, update, format };
