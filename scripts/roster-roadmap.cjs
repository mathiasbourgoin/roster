#!/usr/bin/env node
"use strict";
// Portable artifact coordinator. This file deliberately uses only Node built-ins.
// It does not launch agents, execute checks, authenticate identities or sandbox writes.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readJSON, atomicWrite, safeAncestors } = require("./roster-artifacts.cjs");
const {
  RUNTIMES, fail, keys, text, identifier, integer, strings, oneOf, relative, paths,
  validateContract, validateCapabilities, validateDecision, validateRoutingReview, checkResults, hash,
} = require("./roster-roadmap-validate.cjs");
const { validateState, verifyHistory, topologyAt, modelsAt, nextSpecialist, applyRoutingDecision } = require("./roster-roadmap-history.cjs");
const { missions, missionById, completionReady } = require("./roster-roadmap-missions.cjs");
const derived = require("./roster-roadmap-derived.cjs");
const COMMANDS = {
  init: ["id"], lint: [], status: ["format", "events", "task"], next: [], view: ["events", "task"],
  progress: ["task", "attempt", "assignee", "sequence", "update"],
  estimate: ["revision", "update"],
  "request-open": ["coordinator", "revision", "request"], "request-answer": ["coordinator", "revision", "id", "answer"],
  "request-withdraw": ["coordinator", "revision", "id", "withdrawal"], "request-journal": ["coordinator", "revision", "journal"],
  prompt: ["task", "max-chars"],
  accept: ["coordinator", "revision", "decision"],
  claim: ["coordinator", "revision", "task", "assignee", "routing-decision"],
  record: ["coordinator", "revision", "receipt"],
  derive: ["coordinator", "revision", "request"],
  "withdraw-derived": ["coordinator", "revision", "task", "withdrawal"],
  release: ["coordinator", "revision", "task", "reason", "reconciled-by"],
  complete: ["coordinator", "revision", "receipt"],
};
function load(board, strict = true) {
  safeAncestors(board);
  const contract = readJSON(path.join(board, "roadmap.json"));
  const capabilities = readJSON(path.join(board, "capabilities.json"));
  const state = readJSON(path.join(board, "state.json"));
  validateCapabilities(capabilities); validateState(state);
  if (state.board_id !== contract.id) fail("state/contract board identity mismatch");
  if (strict) validateContract(contract);
  return { board, contract, capabilities, state };
}
function requireAccepted(ctx) {
  if (!ctx.state.acceptance) fail("roadmap not accepted; complete the draft and record an explicit decision");
  if (ctx.state.acceptance.contract_digest !== hash(ctx.contract)) fail("accepted contract changed; create a revised board and obtain an explicit decision");
  validateRoutingReview(ctx.contract, ctx.state.acceptance.decision);
  derived.validateDefinitions(ctx);
  const expected = missions(ctx).map(t => t.id).sort().join("\n"), actual = Object.keys(ctx.state.tasks).sort().join("\n");
  if (actual !== expected) fail("state task set differs from accepted contract");
  verifyHistory(ctx);
  for (const task of missions(ctx)) {
    const current = ctx.state.tasks[task.id];
    if (current.attempts > task.policy.max_attempts) fail(`attempt budget corrupted for ${task.id}`);
    const topology = topologyAt(task, ctx.routing.get(task.id)?.level);
    if (current.assignment && (current.assignment.contract_digest !== ctx.state.acceptance.contract_digest || current.assignment.runtime !== task.topology.runtime || ![topology.route, ...topology.fallbacks].includes(current.assignment.route))) fail(`assignment contract/topology mismatch for ${task.id}`);
    if (current.assignment && derived.causeRefusal(task, current.assignment.assignee)) fail(`assignment of ${task.id} refused: ${derived.causeRefusal(task, current.assignment.assignee)}`);
    if (current.status === "done" && !ctx.state.receipts.some(r => r.task_id === task.id && r.result === "done" && r.contract_digest === ctx.state.acceptance.contract_digest)) fail(`done task ${task.id} has no receipt`);
  }
  const attempts = new Set();
  for (const receipt of ctx.state.receipts) {
    validateTaskReceipt(ctx, receipt);
    if (attempts.has(receipt.attempt_id)) fail("duplicate stored attempt receipt"); attempts.add(receipt.attempt_id);
  }
  if (ctx.state.global_receipt !== null) {
    const receipt = ctx.state.global_receipt;
    keys(receipt, ["contract_digest", "state_revision", "summary", "evidence", "checks"], "stored global receipt");
    if (receipt.contract_digest !== ctx.state.acceptance.contract_digest || receipt.state_revision !== ctx.state.revision - 1) fail("stored global receipt is stale or mismatched");
    if (!completionReady(ctx)) fail("stored global receipt has unfinished tasks");
    text(receipt.summary, "stored global summary"); strings(receipt.evidence, "stored global evidence", true);
    checkResults(receipt.checks, ctx.contract.global_checks, true);
  }
}
function capability(ctx, runtimeName, name) {
  const runtime = ctx.capabilities.runtimes[runtimeName];
  const item = runtime?.capabilities[name];
  return runtime?.available === true && item?.supported === true && item?.authorized === true;
}
function routeAvailable(ctx, task, route) {
  const runtime = task.topology.runtime;
  return ctx.capabilities.runtimes[runtime]?.available === true &&
    (route === "sequential" || capability(ctx, runtime, route)) &&
    (route !== "workflow" || task.workflow.recommendation === "accepted" && task.workflow.steps.length > 0);
}
function routeFor(ctx, task, level = ctx.routing?.get(task.id)?.level) {
  const topology = topologyAt(task, level);
  return [topology.route, ...topology.fallbacks].find(route => routeAvailable(ctx, task, route)) || null;
}
function overlaps(a, b) {
  return a === b || a.endsWith("/") && b.startsWith(a) || b.endsWith("/") && a.startsWith(b);
}
function canClaimBasic(ctx, task, level) {
  const state = ctx.state.tasks[task.id];
  if (state.status !== "queued") return `task is ${state.status}`;
  if (state.attempts >= task.policy.max_attempts) return "attempt budget exhausted";
  // OD-5: a dependency with an open correction is unmet for every task that depends on it.
  const unmet = [...task.depends_on.filter(id => ctx.state.tasks[id].status !== "done"), ...derived.frozenDependencies(task, ctx.state.tasks, derived.entries(ctx))];
  if (unmet.length) return `waiting for dependencies: ${unmet.join(", ")}`;
  if (!routeFor(ctx, task, level)) return "requested route unsupported or unauthorized; no permitted fallback";
  const active = missions(ctx).filter(t => ctx.state.tasks[t.id].status === "active");
  if (active.length >= ctx.contract.execution.max_active) return "active mission limit reached";
  if (active.length) {
    if (!capability(ctx, task.topology.runtime, "parallel") || active.some(t => !capability(ctx, t.topology.runtime, "parallel"))) return "concurrent claims require authorized parallel capability on all involved runtimes";
    if (active.some(t => task.allowed_files.some(a => t.allowed_files.some(b => overlaps(a, b))))) return "write scope overlaps active mission";
  }
  return null;
}
function recoveryBlocker(ctx, task) {
  try { if (require("./roster-recovery.cjs").inspectBoard(ctx, task.id).reframe_needed) return "three consecutive failures require a diagnosed reframe before another attempt"; }
  catch { return "recovery evidence is invalid; reconcile this mission before retrying"; }
  return null;
}
function canClaim(ctx, task, level) {
  return canClaimBasic(ctx, task, level) || recoveryBlocker(ctx, task);
}
function claimOptions(ctx, task) {
  const current = ctx.state.tasks[task.id], routing = ctx.routing?.get(task.id);
  const currentBlocker = canClaimBasic(ctx, task);
  const next = routing && current.status !== "done" && nextSpecialist(task, routing);
  let specialist = null;
  if (next) {
    const nextLevel = routing.level + 1;
    specialist = {
      level: nextLevel, role: next.role, persona: next.persona, models: next.models, after: next.after,
      route: routeFor(ctx, task, nextLevel),
      claim_blocker: current.attempts >= task.policy.max_attempts ? "attempt budget exhausted" : canClaimBasic(ctx, task, nextLevel),
    };
  }
  return { currentBlocker, specialist, blocker: specialist && !specialist.claim_blocker ? null : currentBlocker };
}
function routingProgress(ctx, task, specialist) {
  const routing = ctx.routing.get(task.id);
  if (!routing) return null;
  const topology = topologyAt(task, routing.level);
  return {
    ...routing, role: topology.role, persona: topology.persona, models: modelsAt(task, routing.level),
    next_specialist: specialist && { ...specialist, claim_blocker: specialist.claim_blocker || recoveryBlocker(ctx, task) },
  };
}
function next(ctx) {
  requireAccepted(ctx);
  if (ctx.state.global_receipt) return { status: "complete", next_action: "Report the globally verified outcome; do not create more work." };
  const active = missions(ctx).filter(t => ctx.state.tasks[t.id].status === "active").map(t => ({ id: t.id, ...ctx.state.tasks[t.id].assignment }));
  for (const task of missions(ctx)) {
    const { currentBlocker, specialist, blocker } = claimOptions(ctx, task);
    if (blocker || recoveryBlocker(ctx, task)) continue;
    const routing = routingProgress(ctx, task, specialist);
    const nextAction = specialist && !specialist.claim_blocker
      ? `Inspect the eligible specialist for ${task.id}; explicitly select it when the diagnosis and authorized native tools support escalation.`
      : `Claim ${task.id}, execute using authorized native tools, verify and record its receipt, then continue.`;
    return { status: "ready", task, route: currentBlocker ? null : routeFor(ctx, task), active,
      ...(routing && { routing }), next_action: nextAction };
  }
  if (active.length) return { status: "active", active, next_action: "Continue or collect the active missions. Reconcile interrupted work explicitly before reassignment." };
  if (completionReady(ctx)) return { status: "global-verification-needed", next_action: "Verify the original global success criteria on the integrated result, record a fresh global receipt, then complete." };
  return { status: "blocked", blocked: missions(ctx).filter(t => ctx.state.tasks[t.id].status !== "done").map(t => taskProgress(ctx, t)), next_action: "Inspect attempt budgets and preserved failure evidence. Apply only specified recovery/retry policies; exhausted budgets require an explicit roadmap revision/decision. Escalate a precise blocking decision if no authorized progress remains." };
}
function taskProgress(ctx, task) {
  const current = ctx.state.tasks[task.id], exhausted = !["active", "done", "withdrawn"].includes(current.status) && current.attempts >= task.policy.max_attempts;
  const advice = derived.liveAdvice(ctx, task.id), activeAdvice = derived.activeAdvice(ctx, task, current);
  const { currentBlocker, specialist, blocker } = claimOptions(ctx, task);
  const queuedBlocker = current.status === "queued" ? blocker || recoveryBlocker(ctx, task) : null;
  let nextAction;
  if (exhausted) nextAction = derived.exhaustedAdvice(ctx, task) || "Attempt budget exhausted: preserve failure evidence and request an explicit revised-roadmap decision before further attempts.";
  else if (advice) nextAction = `Release is refused until every blamed dependency has a done correction: ${advice}.`;
  else if (current.status === "withdrawn") nextAction = "Withdrawn correction: kept for history; no further attempt.";
  else if (current.status === "blocked") nextAction = task.policy.on_failure === "retry" ? "Inspect the failure and apply declared recovery, then explicitly reconcile before requeueing." : "Retry is not authorized by policy; request the blocking decision.";
  else if (activeAdvice) nextAction = activeAdvice;
  else if (current.status === "active") nextAction = "Continue the owned attempt or explicitly reconcile inspected interrupted work.";
  else if (current.status === "done") nextAction = "Keep the accepted receipt and continue toward the global outcome.";
  else nextAction = queuedBlocker || (currentBlocker ? "Select the eligible specialist before claiming this mission." : "Claim the mission using the current revision.");
  const routing = routingProgress(ctx, task, specialist);
  return { id: task.id, status: current.status, attempts: current.attempts, max_attempts: task.policy.max_attempts, exhausted, reason: current.reason || queuedBlocker, recovery: task.policy.recovery, failure: task.policy.failure,
    ...(routing && { routing }), next_action: nextAction };
}
function status(ctx) {
  const counts = { queued: 0, active: 0, blocked: 0, done: 0 };
  for (const task of Object.values(ctx.state.tasks)) counts[task.status] = (counts[task.status] ?? 0) + 1;
  const current = ctx.state.acceptance?.contract_digest === hash(ctx.contract);
  if (ctx.state.acceptance) requireAccepted(ctx);
  const tasks = ctx.state.acceptance ? missions(ctx).map(task => taskProgress(ctx, task)) : [];
  return { board_id: ctx.state.board_id, revision: ctx.state.revision, coordinator: ctx.state.coordinator, accepted: Boolean(ctx.state.acceptance), acceptance_current: current, contract_digest: hash(ctx.contract), counts, tasks, complete: current && ctx.state.global_receipt !== null, assurance: "Local recorded assertions; no authentication, command execution or sandbox enforcement." };
}
function taskById(ctx, id) {
  identifier(id, "task"); const task = missionById(ctx, id);
  if (!task) fail(`unknown task ${id}`); return task;
}
function validateTaskReceipt(ctx, receipt) {
  keys(receipt, ["task_id", "attempt_id", "assignee", "contract_digest", "result", "summary", "evidence", "changed_files", "checks", "blames", "failure_signature"], "receipt");
  const task = taskById(ctx, receipt.task_id);
  text(receipt.attempt_id, "receipt.attempt_id"); identifier(receipt.assignee, "receipt.assignee");
  if (receipt.contract_digest !== ctx.state.acceptance.contract_digest) fail("receipt contract mismatch");
  oneOf(receipt.result, ["done", "blocked"], "receipt.result"); text(receipt.summary, "receipt.summary"); strings(receipt.evidence, "receipt.evidence", true);
  if (receipt.failure_signature !== undefined) {
    if (receipt.result !== "blocked" || !task.topology.escalation) fail("failure_signature requires a blocked receipt for a task with an escalation policy");
    identifier(receipt.failure_signature, "receipt.failure_signature");
  }
  paths(receipt.changed_files, "receipt.changed_files");
  for (const file of receipt.changed_files) {
    relative(file, "changed file", false);
    if (!task.allowed_files.some(scope => scope === file || scope.endsWith("/") && file.startsWith(scope))) fail(`reported write outside allowed_files: ${file}`);
  }
  checkResults(receipt.checks, task.checks, receipt.result === "done"); derived.validateReceiptLinks(receipt, task); return task;
}
function transitionAccept(ctx, options) {
  const { state, contract } = ctx;
  if (state.acceptance) fail("roadmap is already accepted; changed contracts require a revised board");
  const decision = readJSON(required(options, "decision")); validateDecision(decision);
  if (decision.contract_digest !== hash(contract)) fail("decision contract_digest does not match the current roadmap");
  validateRoutingReview(contract, decision);
  state.coordinator = options.coordinator; state.acceptance = { contract_digest: hash(contract), decision };
  state.tasks = Object.fromEntries(contract.tasks.map(t => [t.id, { status: "queued", attempts: 0, assignment: null, reason: null }]));
  return { accepted: true, contract_digest: hash(contract) };
}
function transitionClaim(ctx, options) {
  const task = taskById(ctx, required(options, "task")); identifier(options.assignee, "--assignee");
  const prior = ctx.routing.get(task.id), routing = prior && { ...prior };
  const decision = options["routing-decision"] === undefined ? undefined : readJSON(required(options, "routing-decision"));
  if (decision !== undefined) applyRoutingDecision(task, routing, decision, ctx.state.revision);
  const reason = canClaim(ctx, task, routing?.level) || derived.claimRefusal(ctx, task, options.assignee); if (reason) fail(`cannot claim ${task.id}: ${reason}`);
  const current = ctx.state.tasks[task.id]; current.status = "active"; current.attempts++; current.reason = null;
  current.assignment = { id: crypto.randomUUID(), assignee: options.assignee, contract_digest: hash(ctx.contract), capabilities_digest: hash(ctx.capabilities), route: routeFor(ctx, task, routing?.level), runtime: task.topology.runtime,
    ...(routing && { specialist_level: routing.level, requested_model: routing.model }) };
  return { task_id: task.id, assignment: current.assignment, ...(decision !== undefined && { routing_decision: decision }) };
}
function transitionRecord(ctx, options) {
  const receipt = readJSON(required(options, "receipt"));
  const task = validateTaskReceipt(ctx, receipt), current = ctx.state.tasks[task.id], assignment = current.assignment;
  if (current.status !== "active" || !assignment) fail("receipt task has no active assignment");
  if (receipt.attempt_id !== assignment.id || receipt.assignee !== assignment.assignee || receipt.contract_digest !== assignment.contract_digest) fail("receipt assignment, assignee or contract mismatch");
  if (assignment.capabilities_digest !== hash(ctx.capabilities) && !derived.acceptsStaleCapabilities(task, receipt)) fail("capabilities changed during assignment; reconcile before accepting results");
  if (ctx.state.receipts.some(r => r.attempt_id === receipt.attempt_id)) fail("attempt receipt already recorded");
  const refusal = derived.liveRecordRefusal(ctx, task, receipt); if (refusal) fail(`cannot record: ${refusal}`);
  ctx.state.receipts.push(receipt); current.status = receipt.result; current.assignment = null;
  current.reason = receipt.result === "blocked" ? receipt.summary : null;
  const requeued = derived.applyRequeue(task, receipt, ctx.state.tasks, ctx.state.receipts, derived.entries(ctx));
  return { task_id: task.id, result: receipt.result, ...(requeued ? { requeued } : {}), continue: true };
}
function transitionRelease(ctx, options) {
  const task = taskById(ctx, required(options, "task")), current = ctx.state.tasks[task.id];
  text(options.reason, "--reason"); identifier(options["reconciled-by"], "--reconciled-by");
  if (!["active", "blocked"].includes(current.status)) fail("only active or blocked work can be reconciled");
  if (task.policy.on_failure !== "retry") fail("task policy does not authorize retry");
  if (current.attempts >= task.policy.max_attempts) fail("attempt budget exhausted; revise the roadmap explicitly");
  const frozen = derived.liveReleaseRefusal(ctx, task.id); if (frozen) fail(`cannot release ${task.id}: ${frozen}`);
  if (require("./roster-recovery.cjs").inspectBoard(ctx, task.id).reframe_needed) fail("three consecutive failures require a diagnosed reframe before requeueing");
  current.status = "queued"; current.assignment = null; current.reason = options.reason;
  return { task_id: task.id, reconciled: true, by: options["reconciled-by"], reason: options.reason };
}
function transitionComplete(ctx, options) {
  const { state, contract } = ctx;
  if (!completionReady(ctx)) fail("global completion requires every contract task done and no derived mission queued or active");
  const receipt = readJSON(required(options, "receipt"));
  keys(receipt, ["contract_digest", "state_revision", "summary", "evidence", "checks"], "global receipt");
  if (receipt.contract_digest !== hash(contract)) fail("global receipt contract mismatch");
  if (receipt.state_revision !== state.revision) fail("global receipt is stale: state_revision must match current execution revision");
  text(receipt.summary, "global receipt.summary"); strings(receipt.evidence, "global receipt.evidence", true);
  checkResults(receipt.checks, contract.global_checks, true); state.global_receipt = receipt;
  return { complete: true, summary: receipt.summary };
}
const TRANSITIONS = { accept: transitionAccept, claim: transitionClaim, record: transitionRecord, release: transitionRelease, complete: transitionComplete, derive: derived.transitionDerive, "withdraw-derived": derived.transitionWithdraw };
function persistTransition(ctx, command, options, result) {
  const { state, board } = ctx;
  state.revision++;
  const event = { revision: state.revision, action: command, coordinator: options.coordinator, task_id: options.task || result?.task_id || null, reason: options.reason || null, reconciled_by: options["reconciled-by"] || null, at: new Date().toISOString() };
  Object.assign(event, derived.eventPayload(ctx, command, result), result.routing_decision && { routing_decision: result.routing_decision });
  state.events.push(event);
  validateState(state); requireAccepted(ctx); atomicWrite(path.join(board, "state.json"), state);
  return { ...result, revision: state.revision };
}
function mutate(board, command, options) {
  identifier(options.coordinator, "--coordinator");
  if (!/^\d+$/.test(options.revision || "")) fail("--revision must be a nonnegative integer");
  const expectedRevision = Number(options.revision); integer(expectedRevision, "--revision");
  safeAncestors(board);
  const lock = path.join(board, ".lock"); safeAncestors(lock);
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (err) { fail(`board lock unavailable (${err.code}); inspect the owning process before explicit lock recovery`); }
  try {
    const ctx = load(board), { state } = ctx;
    if (state.revision !== expectedRevision) fail(`stale revision: expected ${expectedRevision}, current ${state.revision}`);
    if (state.coordinator && state.coordinator !== options.coordinator) fail("foreign coordinator; explicit coordination transfer is not supported, use the designated coordinator");
    if (command !== "accept") requireAccepted(ctx);
    if (state.global_receipt) fail("roadmap is already complete");
    const result = TRANSITIONS[command](ctx, options);
    return persistTransition(ctx, command, options, result);
  } finally { fs.rmdirSync(lock); }
}
function required(options, key) { text(options[key], `--${key}`); return options[key]; }
function init(board, options) {
  const id = required(options, "id"); identifier(id, "--id"); safeAncestors(board);
  if (fs.existsSync(board)) fail("init refuses an existing board directory");
  fs.mkdirSync(path.dirname(board), { recursive: true, mode: 0o700 });
  // Exclusive leaf creation also prevents two initializers overwriting each other.
  fs.mkdirSync(board, { mode: 0o700 });
  fs.mkdirSync(path.join(board, "notes")); fs.mkdirSync(path.join(board, "receipts"));
  atomicWrite(path.join(board, "roadmap.json"), { schema_version: 1, id, goal: "", success: [], global_checks: [], execution: { max_active: 1 }, tasks: [] });
  atomicWrite(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: Object.fromEntries(RUNTIMES.map(name => [name, { available: false, evidence: [], capabilities: {} }])) });
  atomicWrite(path.join(board, "state.json"), { schema_version: 1, board_id: id, revision: 0, coordinator: null, acceptance: null, tasks: {}, receipts: [], events: [], global_receipt: null });
  atomicWrite(path.join(board, "goal.md"), `# ${id}\n\nDraft the owner outcome, observations with sources, assumptions, recommendations, decisions and unresolved questions here.\n\nroadmap.json is the execution contract; state.json is the execution authority. Keep long research in notes/. Receipts are local assertions, not authentication or a sandbox.\n`);
  return { initialized: true, board_id: id, revision: 0, next_action: "Prefill goal.md and roadmap.json with evidence-backed recommendations; observe capabilities; resolve consequential questions; lint, then record explicit acceptance." };
}
function main(argv) {
  if (argv.length === 1 && ["--help", "help"].includes(argv[0])) return { usage: "roster-roadmap.cjs <command> <board-dir> [options]", commands: COMMANDS, assurance: "Artifact coordination only; no agent/check execution. Source reference: schema/roadmap-schema.md; installed reference: .harness/roadmap/schema.md." };
  const [command, boardArg, ...args] = argv;
  if (!Object.hasOwn(COMMANDS, command) || !boardArg || boardArg.startsWith("--")) fail("usage: roster-roadmap.cjs <init|lint|accept|status|view|progress|estimate|request-open|request-answer|request-withdraw|request-journal|next|prompt|claim|record|release|derive|withdraw-derived|complete> <board-dir> [options]");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || args[i + 1] === undefined) fail("options require --name value pairs");
    const key = args[i].slice(2);
    if (!COMMANDS[command].includes(key) || Object.hasOwn(options, key)) fail(`unknown or duplicate option --${key}`);
    options[key] = args[i + 1];
  }
  const board = path.resolve(boardArg);
  if (command === "init") return init(board, options);
  if (command === "progress") return require("./roster-roadmap-view.cjs").update(board, options);
  if (command === "estimate") return require("./roster-roadmap-estimates.cjs").update(board, options);
  if (command.startsWith("request-")) return require("./roster-roadmap-requests.cjs").command(board, command, options);
  if (["accept", "claim", "record", "release", "derive", "withdraw-derived", "complete"].includes(command)) return mutate(board, command, options);
  const ctx = load(board, !["status", "view"].includes(command));
  if (command === "lint") return { valid: true, contract_digest: hash(ctx.contract), capability_digest: hash(ctx.capabilities), note: "Structural coherence only; semantic contradictions still require agent review." };
  if (command === "view") return require("./roster-roadmap-view.cjs").snapshot(ctx, options);
  if (command === "status") {
    if (options.format === "text") { const view = require("./roster-roadmap-view.cjs"); return view.format(view.snapshot(ctx, options)); }
    if (options.format !== undefined && options.format !== "json" || options.task || options.events) fail("status supports --format json or text; use view for JSON filtering");
    return status(ctx);
  }
  if (command === "next") return next(ctx);
  return require("./roster-roadmap-prompt.cjs").prompt(ctx, options);
}

function readBoard(board, draft = false) {
  const ctx = load(path.resolve(board), !draft);
  if (ctx.state.acceptance) requireAccepted(ctx);
  return ctx;
}
module.exports = { main, validateContract, validateCapabilities, hash, readBoard, canClaimBasic, claimOptions, taskById, viewSupport: { status, next, routeFor, routeAvailable, taskProgress }, io: { readJSON, atomicWrite, safeAncestors } };
if (require.main === module) {
  try { const result = main(process.argv.slice(2)); process.stdout.write((typeof result === "string" ? result : JSON.stringify(result, null, 2)) + "\n"); }
  catch (err) { process.stdout.write(JSON.stringify({ status: "error", error: err.message }) + "\n"); process.exitCode = 1; }
}
