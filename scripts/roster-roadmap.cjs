#!/usr/bin/env node
"use strict";

// Portable artifact coordinator. This file deliberately uses only Node built-ins.
// It does not launch agents, execute checks, authenticate identities or sandbox writes.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RUNTIMES = ["codex", "claude", "opencode", "pi"];
const ROUTES = ["sequential", "subagent", "parallel", "multisession", "workflow"];
const CAPABILITIES = ROUTES.filter(x => x !== "sequential");
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const COMMANDS = {
  init: ["id"], lint: [], status: [], next: [],
  prompt: ["task", "max-chars"],
  accept: ["coordinator", "revision", "decision"],
  claim: ["coordinator", "revision", "task", "assignee"],
  record: ["coordinator", "revision", "receipt"],
  release: ["coordinator", "revision", "task", "reason", "reconciled-by"],
  complete: ["coordinator", "revision", "receipt"],
};

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}
function keys(value, allowed, label) {
  object(value, label);
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`${label}: unknown field ${name}`);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a nonempty string`);
}
function identifier(value, label) { text(value, label); if (!ID.test(value)) fail(`${label} must be a safe identifier`); }
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an integer in ${min}..${max}`);
}
function array(value, label, nonempty = false) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) fail(`${label} must be ${nonempty ? "a nonempty" : "an"} array`);
}
function strings(value, label, nonempty = false) {
  array(value, label, nonempty); value.forEach((x, i) => text(x, `${label}[${i}]`));
  if (new Set(value).size !== value.length) fail(`${label} contains duplicates`);
}
function oneOf(value, values, label) { if (!values.includes(value)) fail(`${label} must be one of ${values.join(", ")}`); }
function digestString(value, label) { if (typeof value !== "string" || !DIGEST.test(value)) fail(`${label} must be a SHA-256 digest`); }
function relative(value, label, directory = true) {
  text(value, label);
  if (value.includes("\\") || /[\x00-\x1f]/.test(value) || path.posix.isAbsolute(value)) fail(`${label} must be a portable relative path`);
  const parts = value.replace(/\/$/, "").split("/");
  if (parts.some(x => !x || x === "." || x === ".." || /[*?\[\]]/.test(x))) fail(`${label} must be an exact path or directory prefix`);
  if (!directory && value.endsWith("/")) fail(`${label} must name a file`);
}
function paths(value, label) { strings(value, label); value.forEach(p => relative(p, label)); }
function checks(value, label) {
  array(value, label, true);
  const ids = new Set();
  for (const check of value) {
    keys(check, ["id", "description", "command"], label);
    identifier(check.id, `${label}.id`); text(check.description, `${label}.description`);
    if (check.command !== undefined) text(check.command, `${label}.command`);
    if (ids.has(check.id)) fail(`${label}: duplicate check ${check.id}`); ids.add(check.id);
  }
}
function validateContract(contract) {
  keys(contract, ["schema_version", "id", "goal", "success", "global_checks", "execution", "tasks"], "roadmap");
  if (contract.schema_version !== 1) fail("unsupported roadmap schema_version");
  identifier(contract.id, "roadmap.id"); text(contract.goal, "roadmap.goal");
  strings(contract.success, "roadmap.success", true); checks(contract.global_checks, "global_checks");
  keys(contract.execution, ["max_active"], "execution"); integer(contract.execution.max_active, "execution.max_active", 1, 64);
  array(contract.tasks, "tasks", true);
  const ids = new Set();
  for (const task of contract.tasks) {
    keys(task, ["id", "intake", "objective", "depends_on", "inputs", "outputs", "allowed_files", "dod", "success", "checks", "topology", "policy", "workflow"], "task");
    identifier(task.id, "task.id"); if (ids.has(task.id)) fail(`duplicate task ${task.id}`); ids.add(task.id);
    relative(task.intake, "task.intake", false); text(task.objective, "task.objective");
    strings(task.depends_on, "task.depends_on"); task.depends_on.forEach(x => identifier(x, "dependency"));
    paths(task.inputs, "task.inputs"); paths(task.outputs, "task.outputs"); paths(task.allowed_files, "task.allowed_files");
    strings(task.dod, "task.dod", true); strings(task.success, "task.success", true); checks(task.checks, "task.checks");
    keys(task.topology, ["runtime", "role", "persona", "model", "route", "fallbacks"], "topology");
    oneOf(task.topology.runtime, RUNTIMES, "topology.runtime");
    for (const name of ["role", "persona", "model"]) text(task.topology[name], `topology.${name}`);
    oneOf(task.topology.route, ROUTES, "topology.route"); strings(task.topology.fallbacks, "topology.fallbacks");
    task.topology.fallbacks.forEach(x => oneOf(x, ROUTES, "topology fallback"));
    if (task.topology.fallbacks.includes(task.topology.route)) fail("fallback repeats preferred route");
    keys(task.policy, ["max_attempts", "on_failure", "stop_if", "recovery", "failure"], "policy");
    integer(task.policy.max_attempts, "policy.max_attempts", 1, 100); oneOf(task.policy.on_failure, ["retry", "block"], "policy.on_failure");
    strings(task.policy.stop_if, "policy.stop_if", true); strings(task.policy.recovery, "policy.recovery", true); text(task.policy.failure, "policy.failure");
    keys(task.workflow, ["recommendation", "reason", "steps"], "workflow");
    oneOf(task.workflow.recommendation, ["none", "proposed", "accepted"], "workflow.recommendation");
    text(task.workflow.reason, "workflow.reason"); strings(task.workflow.steps, "workflow.steps");
    if (task.topology.route === "workflow" && (task.workflow.recommendation !== "accepted" || !task.workflow.steps.length)) fail("workflow route needs accepted nonempty workflow steps");
  }
  for (const task of contract.tasks) for (const dependency of task.depends_on) if (!ids.has(dependency)) fail(`unknown dependency ${dependency} in ${task.id}`);
  const visiting = new Set(), visited = new Set(), tasks = new Map(contract.tasks.map(t => [t.id, t]));
  function visit(id) {
    if (visiting.has(id)) fail(`dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id); tasks.get(id).depends_on.forEach(visit); visiting.delete(id); visited.add(id);
  }
  contract.tasks.forEach(t => visit(t.id));
  return contract;
}
function validateCapabilities(profile) {
  keys(profile, ["schema_version", "runtimes"], "capabilities");
  if (profile.schema_version !== 1) fail("unsupported capabilities schema_version");
  keys(profile.runtimes, RUNTIMES, "capabilities.runtimes");
  for (const [name, runtime] of Object.entries(profile.runtimes)) {
    keys(runtime, ["available", "evidence", "capabilities"], `runtime ${name}`);
    if (typeof runtime.available !== "boolean") fail("runtime.available must be boolean");
    strings(runtime.evidence, "runtime.evidence", runtime.available);
    keys(runtime.capabilities, CAPABILITIES, "runtime.capabilities");
    for (const cap of Object.values(runtime.capabilities)) {
      keys(cap, ["supported", "authorized", "evidence"], "capability");
      if (typeof cap.supported !== "boolean" || typeof cap.authorized !== "boolean") fail("capability flags must be booleans");
      strings(cap.evidence, "capability.evidence", cap.supported || cap.authorized);
    }
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function safeAncestors(target) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail(`unsafe symlink at ${current}`); }
    catch (err) { if (err.code !== "ENOENT") throw err; }
  }
}
function readJSON(file) {
  safeAncestors(file);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) fail(`expected regular file ${file}`);
    if (stat.size > 16 * 1024 * 1024) fail(`oversized JSON file ${file}`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) { fail(`cannot read ${file}: ${err.message}`); }
}
function atomicWrite(file, value) {
  safeAncestors(file);
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
  }
}
function validateState(state) {
  keys(state, ["schema_version", "board_id", "revision", "coordinator", "acceptance", "tasks", "receipts", "events", "global_receipt"], "state");
  if (state.schema_version !== 1) fail("unsupported state schema_version");
  identifier(state.board_id, "state.board_id"); integer(state.revision, "state.revision");
  if (state.coordinator !== null) identifier(state.coordinator, "state.coordinator");
  if (state.acceptance !== null) {
    keys(state.acceptance, ["contract_digest", "decision"], "state.acceptance");
    digestString(state.acceptance.contract_digest, "acceptance.contract_digest");
    validateDecision(state.acceptance.decision);
    if (state.acceptance.decision.contract_digest !== state.acceptance.contract_digest) fail("acceptance decision digest mismatch");
    if (state.coordinator === null) fail("accepted board needs coordinator");
  }
  object(state.tasks, "state.tasks"); array(state.receipts, "state.receipts"); array(state.events, "state.events");
  if (state.events.length !== state.revision) fail("state revision/event history mismatch");
  state.events.forEach((event, index) => {
    keys(event, ["revision", "action", "coordinator", "task_id", "reason", "reconciled_by"], "state event");
    if (event.revision !== index + 1) fail("state event revisions are not contiguous");
    oneOf(event.action, ["accept", "claim", "record", "release", "complete"], "state event action");
    identifier(event.coordinator, "state event coordinator");
    if (event.task_id !== null) identifier(event.task_id, "state event task");
    if (event.reason !== null) text(event.reason, "state event reason");
    if (event.reconciled_by !== null) identifier(event.reconciled_by, "state event reconciliation actor");
  });
  for (const [id, task] of Object.entries(state.tasks)) {
    identifier(id, "state task id");
    keys(task, ["status", "attempts", "assignment", "reason"], "task state");
    oneOf(task.status, ["queued", "active", "blocked", "done"], "task state status"); integer(task.attempts, "task attempts");
    if (task.reason !== null) text(task.reason, "task reason");
    if (task.assignment !== null) {
      keys(task.assignment, ["id", "assignee", "contract_digest", "capabilities_digest", "route", "runtime"], "assignment");
      text(task.assignment.id, "attempt id"); identifier(task.assignment.assignee, "assignment assignee");
      digestString(task.assignment.contract_digest, "assignment contract digest"); digestString(task.assignment.capabilities_digest, "assignment capabilities digest");
      oneOf(task.assignment.route, ROUTES, "assignment route"); oneOf(task.assignment.runtime, RUNTIMES, "assignment runtime");
    }
    if ((task.status === "active") !== (task.assignment !== null)) fail(`assignment/status mismatch for ${id}`);
    if (task.status !== "queued" && task.attempts === 0) fail(`missing attempt for ${id}`);
  }
  if (state.global_receipt !== null) object(state.global_receipt, "global receipt");
}
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
  const expected = ctx.contract.tasks.map(t => t.id).sort().join("\n"), actual = Object.keys(ctx.state.tasks).sort().join("\n");
  if (actual !== expected) fail("state task set differs from accepted contract");
  for (const task of ctx.contract.tasks) {
    const current = ctx.state.tasks[task.id];
    if (current.attempts > task.policy.max_attempts) fail(`attempt budget corrupted for ${task.id}`);
    if (current.assignment && (current.assignment.contract_digest !== ctx.state.acceptance.contract_digest || current.assignment.runtime !== task.topology.runtime || ![task.topology.route, ...task.topology.fallbacks].includes(current.assignment.route))) fail(`assignment contract/topology mismatch for ${task.id}`);
    if (current.status === "done" && !ctx.state.receipts.some(r => r.task_id === task.id && r.result === "done" && r.contract_digest === ctx.state.acceptance.contract_digest)) fail(`done task ${task.id} has no receipt`);
  }
  const attempts = new Set();
  for (const receipt of ctx.state.receipts) {
    keys(receipt, ["task_id", "attempt_id", "assignee", "contract_digest", "result", "summary", "evidence", "changed_files", "checks"], "stored receipt");
    const task = taskById(ctx, receipt.task_id);
    text(receipt.attempt_id, "stored receipt attempt"); identifier(receipt.assignee, "stored receipt assignee");
    if (attempts.has(receipt.attempt_id)) fail("duplicate stored attempt receipt"); attempts.add(receipt.attempt_id);
    if (receipt.contract_digest !== ctx.state.acceptance.contract_digest) fail("stored receipt contract mismatch");
    oneOf(receipt.result, ["done", "blocked"], "stored receipt result"); text(receipt.summary, "stored receipt summary");
    strings(receipt.evidence, "stored receipt evidence", true); paths(receipt.changed_files, "stored receipt writes");
    for (const file of receipt.changed_files) if (!task.allowed_files.some(scope => scope === file || scope.endsWith("/") && file.startsWith(scope))) fail("stored receipt contains out-of-scope write");
    checkResults(receipt.checks, task.checks, receipt.result === "done");
  }
  if (ctx.state.global_receipt !== null) {
    const receipt = ctx.state.global_receipt;
    keys(receipt, ["contract_digest", "state_revision", "summary", "evidence", "checks"], "stored global receipt");
    if (receipt.contract_digest !== ctx.state.acceptance.contract_digest || receipt.state_revision !== ctx.state.revision - 1) fail("stored global receipt is stale or mismatched");
    if (!ctx.contract.tasks.every(t => ctx.state.tasks[t.id].status === "done")) fail("stored global receipt has unfinished tasks");
    text(receipt.summary, "stored global summary"); strings(receipt.evidence, "stored global evidence", true);
    checkResults(receipt.checks, ctx.contract.global_checks, true);
  }
}
function capability(ctx, runtimeName, name) {
  const runtime = ctx.capabilities.runtimes[runtimeName];
  const item = runtime?.capabilities[name];
  return runtime?.available === true && item?.supported === true && item?.authorized === true;
}
function routeFor(ctx, task) {
  if (!ctx.capabilities.runtimes[task.topology.runtime]?.available) return null;
  return [task.topology.route, ...task.topology.fallbacks].find(route =>
    (route === "sequential" || capability(ctx, task.topology.runtime, route)) &&
    (route !== "workflow" || task.workflow.recommendation === "accepted" && task.workflow.steps.length > 0)
  ) || null;
}
function overlaps(a, b) {
  return a === b || a.endsWith("/") && b.startsWith(a) || b.endsWith("/") && a.startsWith(b);
}
function canClaim(ctx, task) {
  const state = ctx.state.tasks[task.id], active = ctx.contract.tasks.filter(t => ctx.state.tasks[t.id].status === "active");
  if (state.status !== "queued") return `task is ${state.status}`;
  if (state.attempts >= task.policy.max_attempts) return "attempt budget exhausted";
  const unmet = task.depends_on.filter(id => ctx.state.tasks[id].status !== "done");
  if (unmet.length) return `waiting for dependencies: ${unmet.join(", ")}`;
  if (!routeFor(ctx, task)) return "requested route unsupported or unauthorized; no permitted fallback";
  if (active.length >= ctx.contract.execution.max_active) return "active mission limit reached";
  if (active.length) {
    if (!capability(ctx, task.topology.runtime, "parallel") || active.some(t => !capability(ctx, t.topology.runtime, "parallel"))) return "concurrent claims require authorized parallel capability on all involved runtimes";
    if (active.some(t => task.allowed_files.some(a => t.allowed_files.some(b => overlaps(a, b))))) return "write scope overlaps active mission";
  }
  return null;
}
function next(ctx) {
  requireAccepted(ctx);
  if (ctx.state.global_receipt) return { status: "complete", next_action: "Report the globally verified outcome; do not create more work." };
  const active = ctx.contract.tasks.filter(t => ctx.state.tasks[t.id].status === "active").map(t => ({ id: t.id, ...ctx.state.tasks[t.id].assignment }));
  const task = ctx.contract.tasks.find(t => !canClaim(ctx, t));
  if (task) return { status: "ready", task, route: routeFor(ctx, task), active, next_action: `Claim ${task.id}, execute using authorized native tools, verify and record its receipt, then continue.` };
  if (active.length) return { status: "active", active, next_action: "Continue or collect the active missions. Reconcile interrupted work explicitly before reassignment." };
  if (ctx.contract.tasks.every(t => ctx.state.tasks[t.id].status === "done")) return { status: "global-verification-needed", next_action: "Verify the original global success criteria on the integrated result, record a fresh global receipt, then complete." };
  return { status: "blocked", blocked: ctx.contract.tasks.filter(t => ctx.state.tasks[t.id].status !== "done").map(t => ({ id: t.id, reason: ctx.state.tasks[t.id].reason || canClaim(ctx, t) })), next_action: "Apply only specified recovery/retry policies; escalate a precise blocking decision if no authorized progress remains." };
}
function status(ctx) {
  const counts = { queued: 0, active: 0, blocked: 0, done: 0 };
  for (const task of Object.values(ctx.state.tasks)) counts[task.status]++;
  const current = ctx.state.acceptance?.contract_digest === hash(ctx.contract);
  if (ctx.state.acceptance) requireAccepted(ctx);
  return { board_id: ctx.state.board_id, revision: ctx.state.revision, coordinator: ctx.state.coordinator, accepted: Boolean(ctx.state.acceptance), acceptance_current: current, contract_digest: hash(ctx.contract), counts, complete: current && ctx.state.global_receipt !== null, assurance: "Local recorded assertions; no authentication, command execution or sandbox enforcement." };
}
function validateDecision(decision) {
  keys(decision, ["by", "basis", "contract_digest"], "decision"); text(decision.by, "decision.by"); text(decision.basis, "decision.basis"); digestString(decision.contract_digest, "decision.contract_digest");
}
function checkResults(results, declared, done) {
  array(results, "receipt.checks");
  const ids = new Set(), expected = new Set(declared.map(x => x.id));
  for (const result of results) {
    keys(result, ["id", "status", "evidence"], "check result");
    identifier(result.id, "check result id"); oneOf(result.status, ["pass", "fail"], "check result status"); strings(result.evidence, "check result evidence", true);
    if (!expected.has(result.id) || ids.has(result.id)) fail(`unknown or duplicate check result ${result.id}`);
    ids.add(result.id);
    if (done && result.status !== "pass") fail("done receipt cannot contain failing checks");
  }
  if (done && ids.size !== expected.size) fail("done receipt must cover every declared check");
}
function taskById(ctx, id) {
  identifier(id, "task"); const task = ctx.contract.tasks.find(t => t.id === id);
  if (!task) fail(`unknown task ${id}`); return task;
}
function mutate(board, command, options) {
  identifier(options.coordinator, "--coordinator");
  if (!/^\d+$/.test(options.revision || "")) fail("--revision must be a nonnegative integer");
  const expectedRevision = Number(options.revision); integer(expectedRevision, "--revision");
  safeAncestors(board);
  const lock = path.join(board, ".lock"); safeAncestors(lock);
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (err) { fail(`board lock unavailable (${err.code}); inspect the owning process before explicit lock recovery`); }
  try {
    const ctx = load(board), { state, contract } = ctx;
    if (state.revision !== expectedRevision) fail(`stale revision: expected ${expectedRevision}, current ${state.revision}`);
    if (state.coordinator && state.coordinator !== options.coordinator) fail("foreign coordinator; explicit coordination transfer is not supported, use the designated coordinator");
    if (command !== "accept") requireAccepted(ctx);
    if (state.global_receipt) fail("roadmap is already complete");
    let result;
    if (command === "accept") {
      if (state.acceptance) fail("roadmap is already accepted; changed contracts require a revised board");
      const decision = readJSON(required(options, "decision")); validateDecision(decision);
      if (decision.contract_digest !== hash(contract)) fail("decision contract_digest does not match the current roadmap");
      state.coordinator = options.coordinator; state.acceptance = { contract_digest: hash(contract), decision };
      state.tasks = Object.fromEntries(contract.tasks.map(t => [t.id, { status: "queued", attempts: 0, assignment: null, reason: null }]));
      result = { accepted: true, contract_digest: hash(contract) };
    } else if (command === "claim") {
      const task = taskById(ctx, required(options, "task")); identifier(options.assignee, "--assignee");
      const reason = canClaim(ctx, task); if (reason) fail(`cannot claim ${task.id}: ${reason}`);
      const current = state.tasks[task.id]; current.status = "active"; current.attempts++; current.reason = null;
      current.assignment = { id: crypto.randomUUID(), assignee: options.assignee, contract_digest: hash(contract), capabilities_digest: hash(ctx.capabilities), route: routeFor(ctx, task), runtime: task.topology.runtime };
      result = { task_id: task.id, assignment: current.assignment };
    } else if (command === "record") {
      const receipt = readJSON(required(options, "receipt"));
      keys(receipt, ["task_id", "attempt_id", "assignee", "contract_digest", "result", "summary", "evidence", "changed_files", "checks"], "receipt");
      const task = taskById(ctx, receipt.task_id), current = state.tasks[task.id], assignment = current.assignment;
      if (current.status !== "active" || !assignment) fail("receipt task has no active assignment");
      if (receipt.attempt_id !== assignment.id || receipt.assignee !== assignment.assignee || receipt.contract_digest !== assignment.contract_digest) fail("receipt assignment, assignee or contract mismatch");
      if (assignment.capabilities_digest !== hash(ctx.capabilities)) fail("capabilities changed during assignment; reconcile before accepting results");
      oneOf(receipt.result, ["done", "blocked"], "receipt.result"); text(receipt.summary, "receipt.summary"); strings(receipt.evidence, "receipt.evidence", true);
      paths(receipt.changed_files, "receipt.changed_files");
      for (const file of receipt.changed_files) {
        relative(file, "changed file", false);
        if (!task.allowed_files.some(scope => scope === file || scope.endsWith("/") && file.startsWith(scope))) fail(`reported write outside allowed_files: ${file}`);
      }
      checkResults(receipt.checks, task.checks, receipt.result === "done");
      if (state.receipts.some(r => r.attempt_id === receipt.attempt_id)) fail("attempt receipt already recorded");
      state.receipts.push(receipt); current.status = receipt.result; current.assignment = null;
      current.reason = receipt.result === "blocked" ? receipt.summary : null;
      result = { task_id: task.id, result: receipt.result, continue: true };
    } else if (command === "release") {
      const task = taskById(ctx, required(options, "task")), current = state.tasks[task.id];
      text(options.reason, "--reason"); identifier(options["reconciled-by"], "--reconciled-by");
      if (!["active", "blocked"].includes(current.status)) fail("only active or blocked work can be reconciled");
      if (task.policy.on_failure !== "retry") fail("task policy does not authorize retry");
      if (current.attempts >= task.policy.max_attempts) fail("attempt budget exhausted; revise the roadmap explicitly");
      current.status = "queued"; current.assignment = null; current.reason = options.reason;
      result = { task_id: task.id, reconciled: true, by: options["reconciled-by"], reason: options.reason };
    } else if (command === "complete") {
      if (!contract.tasks.every(t => state.tasks[t.id].status === "done")) fail("global completion requires every task done");
      const receipt = readJSON(required(options, "receipt"));
      keys(receipt, ["contract_digest", "state_revision", "summary", "evidence", "checks"], "global receipt");
      if (receipt.contract_digest !== hash(contract)) fail("global receipt contract mismatch");
      if (receipt.state_revision !== state.revision) fail("global receipt is stale: state_revision must match current execution revision");
      text(receipt.summary, "global receipt.summary"); strings(receipt.evidence, "global receipt.evidence", true);
      checkResults(receipt.checks, contract.global_checks, true); state.global_receipt = receipt;
      result = { complete: true, summary: receipt.summary };
    }
    state.revision++;
    state.events.push({ revision: state.revision, action: command, coordinator: options.coordinator, task_id: options.task || result?.task_id || null, reason: options.reason || null, reconciled_by: options["reconciled-by"] || null });
    validateState(state); atomicWrite(path.join(board, "state.json"), state);
    return { ...result, revision: state.revision };
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
function prompt(ctx, options) {
  const nextAction = next(ctx);
  const task = options.task ? taskById(ctx, options.task) : nextAction.task;
  const active = ctx.contract.tasks.filter(t => ctx.state.tasks[t.id].status === "active").map(t => ({ id: t.id, assignee: ctx.state.tasks[t.id].assignment.assignee, route: ctx.state.tasks[t.id].assignment.route }));
  const view = {
    goal: ctx.contract.goal, global_success: ctx.contract.success,
    current_state: { revision: ctx.state.revision, status: nextAction.status, counts: status(ctx).counts, active },
    mission: task ? {
      id: task.id, objective: task.objective, intake: task.intake, inputs: task.inputs, outputs: task.outputs,
      dependencies: task.depends_on.map(id => ({ id, status: ctx.state.tasks[id].status })), allowed_files: task.allowed_files,
      dod: task.dod, success: task.success, checks: task.checks, topology: task.topology,
      selected_route: ctx.state.tasks[task.id].assignment?.route || routeFor(ctx, task), assignment: ctx.state.tasks[task.id].assignment,
      policy: task.policy, workflow: task.workflow,
    } : null,
    next_action: nextAction.next_action,
    references: { contract: "roadmap.json", capabilities: "capabilities.json", state: "state.json", notes: "notes/", candidates: "receipts/" },
    continuation: "Local task completion is not global completion. Use authorized native runtime tools; respect child Roster gates. Verify, record the structured receipt, refresh next/prompt and continue while authorized progress exists. If blocked, work another admissible branch or apply a declared recovery; stop only for global verification, explicit pause or an unresolved blocking decision. An ended process needs explicit runtime-supported resume; this tool does not keep it alive.",
    assurance: "Identity labels, evidence references and reported writes are local assertions; no authentication, shell execution or filesystem sandbox is provided.",
  };
  const output = JSON.stringify(view, null, 2);
  const limit = options["max-chars"] === undefined ? 12000 : Number(options["max-chars"]);
  integer(limit, "--max-chars", 1, 1000000);
  if (output.length > limit) fail(`mandatory context overflow: ${output.length} characters exceeds ${limit}; narrow the mission or explicitly increase the limit, never silently drop constraints`);
  return { prompt: output, characters: output.length, max_chars: limit };
}
function main(argv) {
  if (argv.length === 1 && ["--help", "help"].includes(argv[0])) return { usage: "roster-roadmap.cjs <command> <board-dir> [options]", commands: COMMANDS, assurance: "Artifact coordination only; no agent/check execution. See schema/roadmap-schema.md." };
  const [command, boardArg, ...args] = argv;
  if (!Object.hasOwn(COMMANDS, command) || !boardArg || boardArg.startsWith("--")) fail("usage: roster-roadmap.cjs <init|lint|accept|status|next|prompt|claim|record|release|complete> <board-dir> [options]");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || args[i + 1] === undefined) fail("options require --name value pairs");
    const key = args[i].slice(2);
    if (!COMMANDS[command].includes(key) || Object.hasOwn(options, key)) fail(`unknown or duplicate option --${key}`);
    options[key] = args[i + 1];
  }
  const board = path.resolve(boardArg);
  if (command === "init") return init(board, options);
  if (["accept", "claim", "record", "release", "complete"].includes(command)) return mutate(board, command, options);
  const ctx = load(board, command !== "status");
  if (command === "lint") return { valid: true, contract_digest: hash(ctx.contract), capability_digest: hash(ctx.capabilities), note: "Structural coherence only; semantic contradictions still require agent review." };
  if (command === "status") return status(ctx);
  if (command === "next") return next(ctx);
  return prompt(ctx, options);
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + "\n"); }
  catch (err) { process.stdout.write(JSON.stringify({ status: "error", error: err.message }) + "\n"); process.exitCode = 1; }
}
module.exports = { main, validateContract, validateCapabilities, hash };
