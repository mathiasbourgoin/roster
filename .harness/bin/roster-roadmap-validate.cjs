"use strict";
// Leaf module: structural validation primitives and canonical digests for roadmap artifacts.
// It deliberately requires only Node built-ins and never the roadmap core.
const path = require("node:path");
const crypto = require("node:crypto");
const RUNTIMES = ["codex", "claude", "opencode", "pi"];
const ROUTES = ["sequential", "subagent", "parallel", "multisession", "workflow"];
const CAPABILITIES = ROUTES.filter(x => x !== "sequential");
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const DIGEST = /^[a-f0-9]{64}$/;
function fail(message) { throw new Error(message); }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`); }
function keys(value, allowed, label) {
  object(value, label);
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`${label}: unknown field ${name}`);
}
function text(value, label) { if (typeof value !== "string" || !value.trim()) fail(`${label} must be a nonempty string`); }
function identifier(value, label) { text(value, label); if (!ID.test(value)) fail(`${label} must be a safe identifier`); }
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an integer in ${min}..${max}`); }
function array(value, label, nonempty = false) { if (!Array.isArray(value) || (nonempty && value.length === 0)) fail(`${label} must be ${nonempty ? "a nonempty" : "an"} array`); }
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
function validateRoutes(topology, label) {
  oneOf(topology.route, ROUTES, `${label}.route`); strings(topology.fallbacks, `${label}.fallbacks`);
  topology.fallbacks.forEach(x => oneOf(x, ROUTES, `${label} fallback`));
  if (topology.fallbacks.includes(topology.route)) fail("fallback repeats preferred route");
}
function validateTopology(topology, label, allowEscalation = false) {
  const fields = ["runtime", "role", "persona", "model", "route", "fallbacks"];
  if (allowEscalation) fields.push("escalation");
  keys(topology, fields, label);
  oneOf(topology.runtime, RUNTIMES, `${label}.runtime`);
  for (const name of ["role", "persona", "model"]) text(topology[name], `${label}.${name}`);
  validateRoutes(topology, label);
}
function validateWorkflowRoute(topology, workflow, includeFallbacks = false) {
  const usesWorkflow = topology.route === "workflow" || (includeFallbacks && topology.fallbacks.includes("workflow"));
  if (usesWorkflow && (workflow.recommendation !== "accepted" || !workflow.steps.length)) fail("workflow route needs accepted nonempty workflow steps");
}
function validateEscalation(task) {
  const { escalation, model, role } = task.topology;
  keys(escalation, ["model_fallbacks", "specialists"], "topology.escalation");
  strings(escalation.model_fallbacks, "escalation.model_fallbacks");
  if (escalation.model_fallbacks.includes(model)) fail("model fallback repeats default model");
  array(escalation.specialists, "escalation.specialists");
  const roles = new Set([role]);
  let minimumAttempts = 1;
  for (const specialist of escalation.specialists) {
    keys(specialist, ["role", "persona", "models", "route", "fallbacks", "after"], "escalation specialist");
    text(specialist.role, "specialist.role"); text(specialist.persona, "specialist.persona");
    if (roles.has(specialist.role)) fail("escalation repeats a specialist role");
    roles.add(specialist.role);
    strings(specialist.models, "specialist.models", true);
    validateRoutes(specialist, "specialist"); validateWorkflowRoute(specialist, task.workflow, true);
    keys(specialist.after, ["blocked_attempts", "same_failure_attempts"], "specialist.after");
    const triggers = Object.keys(specialist.after);
    if (triggers.length !== 1) fail("specialist needs exactly one failure trigger");
    const [trigger] = triggers;
    integer(specialist.after[trigger], `specialist.after.${trigger}`, trigger === "blocked_attempts" ? 1 : 2, 99);
    minimumAttempts += specialist.after[trigger];
  }
  if (escalation.specialists.length && task.policy.on_failure !== "retry") fail("specialist escalation requires authorized retries");
  if (minimumAttempts > task.policy.max_attempts) fail("escalation ladder exceeds the task attempt budget");
}
function validateTask(task, ids) {
  keys(task, ["id", "intake", "objective", "depends_on", "inputs", "outputs", "allowed_files", "dod", "success", "checks", "topology", "policy", "workflow"], "task");
  identifier(task.id, "task.id"); if (ids.has(task.id)) fail(`duplicate task ${task.id}`); ids.add(task.id);
  relative(task.intake, "task.intake", false); text(task.objective, "task.objective");
  strings(task.depends_on, "task.depends_on"); task.depends_on.forEach(x => identifier(x, "dependency"));
  paths(task.inputs, "task.inputs"); paths(task.outputs, "task.outputs"); paths(task.allowed_files, "task.allowed_files");
  strings(task.dod, "task.dod", true); strings(task.success, "task.success", true); checks(task.checks, "task.checks");
  validateTopology(task.topology, "topology", true);
  keys(task.policy, ["max_attempts", "on_failure", "stop_if", "recovery", "failure"], "policy");
  integer(task.policy.max_attempts, "policy.max_attempts", 1, 100); oneOf(task.policy.on_failure, ["retry", "block"], "policy.on_failure");
  strings(task.policy.stop_if, "policy.stop_if", true); strings(task.policy.recovery, "policy.recovery", true); text(task.policy.failure, "policy.failure");
  keys(task.workflow, ["recommendation", "reason", "steps"], "workflow");
  oneOf(task.workflow.recommendation, ["none", "proposed", "accepted"], "workflow.recommendation");
  text(task.workflow.reason, "workflow.reason"); strings(task.workflow.steps, "workflow.steps");
  validateWorkflowRoute(task.topology, task.workflow);
  if (task.topology.escalation !== undefined) validateEscalation(task);
}
function validateDependencies(contract, ids) {
  for (const task of contract.tasks) for (const dependency of task.depends_on) if (!ids.has(dependency)) fail(`unknown dependency ${dependency} in ${task.id}`);
  const visiting = new Set(), visited = new Set(), tasks = new Map(contract.tasks.map(t => [t.id, t]));
  function visit(id) {
    if (visiting.has(id)) fail(`dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id); tasks.get(id).depends_on.forEach(visit); visiting.delete(id); visited.add(id);
  }
  contract.tasks.forEach(t => visit(t.id));
}
function validateContract(contract) {
  keys(contract, ["schema_version", "id", "goal", "success", "global_checks", "execution", "tasks"], "roadmap");
  if (contract.schema_version !== 1) fail("unsupported roadmap schema_version");
  identifier(contract.id, "roadmap.id"); text(contract.goal, "roadmap.goal");
  strings(contract.success, "roadmap.success", true); checks(contract.global_checks, "global_checks");
  keys(contract.execution, ["max_active"], "execution"); integer(contract.execution.max_active, "execution.max_active", 1, 64);
  array(contract.tasks, "tasks", true);
  const ids = new Set();
  for (const task of contract.tasks) validateTask(task, ids);
  validateDependencies(contract, ids);
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
function validateDecision(decision) {
  keys(decision, ["by", "basis", "contract_digest", "routing_review"], "decision");
  text(decision.by, "decision.by"); text(decision.basis, "decision.basis"); digestString(decision.contract_digest, "decision.contract_digest");
  if (decision.routing_review !== undefined) {
    keys(decision.routing_review, ["task_ids", "basis"], "decision.routing_review");
    strings(decision.routing_review.task_ids, "routing review task IDs", true);
    text(decision.routing_review.basis, "routing review basis");
  }
}
function validateRoutingReview(contract, decision) {
  const optedIn = new Set(contract.tasks.filter(task => task.topology.escalation).map(task => task.id));
  const reviewed = decision.routing_review?.task_ids || [];
  if (optedIn.size !== reviewed.length || reviewed.some(id => !optedIn.has(id))) fail("routing_review must explicitly cover every task with an escalation policy");
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
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
module.exports = {
  RUNTIMES, ROUTES, CAPABILITIES, ID, DIGEST,
  fail, object, keys, text, identifier, integer, array, strings, oneOf, digestString, relative, paths, checks,
  validateTopology, validateContract, validateCapabilities, validateDecision, validateRoutingReview, checkResults, canonical, hash,
};
