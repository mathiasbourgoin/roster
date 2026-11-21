#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/roster-artifacts.cjs
var require_roster_artifacts = __commonJS({
  "scripts/roster-artifacts.cjs"(exports2, module2) {
    "use strict";
    var fs2 = require("node:fs");
    var path2 = require("node:path");
    var crypto = require("node:crypto");
    var MAX_JSON_BYTES = 16 * 1024 * 1024;
    function fail2(message) {
      throw new Error(message);
    }
    function safeAncestors2(target) {
      const absolute = path2.resolve(target), parsed = path2.parse(absolute);
      let current = parsed.root;
      for (const part of absolute.slice(parsed.root.length).split(path2.sep).filter(Boolean)) {
        current = path2.join(current, part);
        try {
          if (fs2.lstatSync(current).isSymbolicLink()) fail2(`unsafe symlink at ${current}`);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      }
    }
    function readJSON(file) {
      try {
        return JSON.parse(readBytes2(file).toString("utf8"));
      } catch (err) {
        fail2(`cannot read ${file}: ${err.message}`);
      }
    }
    function readBytes2(file, options = {}) {
      let fd, sawInitialStat = false;
      const reject = (reason, message) => {
        const error = new Error(message);
        error.reason = reason;
        throw error;
      };
      try {
        try {
          safeAncestors2(file);
        } catch (error) {
          reject("unsafe", error.message);
        }
        const stat = fs2.lstatSync(file);
        sawInitialStat = true;
        if (!stat.isFile() || options.strict && stat.nlink !== 1) reject("unsafe", `expected regular file ${file}`);
        if (stat.size > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
        fd = fs2.openSync(file, fs2.constants.O_RDONLY | (fs2.constants.O_NOFOLLOW || 0) | (fs2.constants.O_NONBLOCK || 0));
        const opened = fs2.fstatSync(fd);
        if (!opened.isFile() || options.strict && opened.nlink !== 1) reject("unsafe", `expected regular file ${file}`);
        const same = (a, b) => ["dev", "ino", "size", "mtimeMs", "ctimeMs", "nlink"].every((k) => a[k] === b[k]);
        if (options.strict && !same(stat, opened)) reject("changed", "source changed");
        if (opened.size > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
        const chunks = [];
        let total = 0;
        for (; ; ) {
          if (options.strict && total === opened.size) break;
          const nextSize = Math.min(65536, MAX_JSON_BYTES + 1 - total, options.strict ? opened.size - total : Infinity);
          if (options.beforeRead) options.beforeRead(nextSize);
          const chunk = Buffer.allocUnsafe(nextSize);
          const count = fs2.readSync(fd, chunk, 0, chunk.length, null);
          if (!count) break;
          if (options.onRead) options.onRead(count);
          total += count;
          if (total > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
          chunks.push(chunk.subarray(0, count));
        }
        if (!options.strict && fs2.fstatSync(fd).size > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
        if (options.strict) {
          const after = fs2.fstatSync(fd), current = fs2.lstatSync(file);
          if (!same(opened, after) || !same(after, current) || !current.isFile() || total !== after.size) reject("changed", "source changed");
        }
        return Buffer.concat(chunks, total);
      } catch (error) {
        if (!error.reason) error.reason = options.strict && sawInitialStat && ["ENOENT", "ENOTDIR"].includes(error.code) ? "changed" : error.code === "ELOOP" ? "unsafe" : "read";
        throw error;
      } finally {
        if (fd !== void 0) fs2.closeSync(fd);
      }
    }
    function atomicWrite2(file, value) {
      safeAncestors2(file);
      const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
      if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) fail2(`serialized artifact size exceeds ${MAX_JSON_BYTES} byte limit; keep long evidence in referenced files`);
      const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
      let fd;
      try {
        fd = fs2.openSync(tmp, "wx", 384);
        fs2.writeFileSync(fd, serialized);
        fs2.fsyncSync(fd);
        fs2.closeSync(fd);
        fd = void 0;
        fs2.renameSync(tmp, file);
      } finally {
        if (fd !== void 0) fs2.closeSync(fd);
        fs2.rmSync(tmp, { force: true });
      }
    }
    module2.exports = { readJSON, readBytes: readBytes2, atomicWrite: atomicWrite2, safeAncestors: safeAncestors2, MAX_JSON_BYTES };
  }
});

// scripts/roster-analyze.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_node_util = require("node:util");

// scripts/resource-analysis/types.ts
var RUNTIMES = ["codex", "claude", "opencode", "pi"];
var ROUTES = ["sequential", "subagent", "parallel", "multisession", "workflow"];
var TASK_TYPES = {
  framing: ["clarification", "intake", "specification", "acceptance_criteria", "coherence_check"],
  research: ["code_exploration", "documentation_research", "solution_comparison", "dependency_analysis"],
  design: ["architecture", "api_design", "data_modeling", "decomposition", "planning"],
  implementation: ["feature", "bugfix", "refactoring", "migration", "configuration", "automation"],
  diagnosis: ["reproduction", "root_cause_analysis", "build_failure", "test_failure", "ci_failure"],
  verification: ["test_authoring", "test_execution", "code_review", "spec_compliance", "security_audit", "formal_verification"],
  performance: ["profiling", "benchmarking", "runtime_optimization", "memory_optimization", "token_optimization", "cost_optimization"],
  documentation: ["documentation", "documentation_update", "example_authoring", "tutorial", "changelog", "translation"],
  delivery: ["commit_preparation", "pull_request", "conflict_resolution", "ci_review", "release", "deployment"],
  coordination: ["topology_selection", "delegation", "result_integration", "progress_tracking", "failure_recovery"]
};

// scripts/resource-analysis/validate.ts
var LIMITS = { resources: 128, tasks: 32, candidates: 16, observations: 1e4, assignments: 5e4, bytes: 16 * 1024 * 1024 };
function fail(message) {
  throw new Error(`analysis: ${message}`);
}
function object(v, fields, at, optional = []) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${at} must be an object`);
  for (const k of Object.keys(v)) if (!fields.includes(k)) fail(`${at}: unknown field ${k}`);
  for (const k of fields) if (!optional.includes(k) && !Object.hasOwn(v, k)) fail(`${at}: missing ${k}`);
}
function text(v, at) {
  if (typeof v !== "string" || !v.trim() || v.length > 2e3 || /[\x00-\x1f\x7f]/.test(v)) fail(`${at} must be bounded nonempty text without controls`);
}
function strings(v, at, max = 64) {
  if (!Array.isArray(v) || v.length > max) fail(`${at} must be an array (max ${max})`);
  v.forEach((x) => text(x, at));
  if (new Set(v).size !== v.length) fail(`${at} must be distinct`);
}
function number(v, at, max = 1e12) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) fail(`${at} must be finite in 0..${max}`);
}
function nullable(v, at, max = 1e12) {
  if (v !== null) number(v, at, max);
}
function one(v, values, at) {
  if (typeof v !== "string" || !values.includes(v)) fail(`${at} must be one of ${values.join(", ")}`);
}
function bool(v, at) {
  if (typeof v !== "boolean") fail(`${at} must be boolean`);
}
function instant(v, at) {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) fail(`${at} must be a valid UTC ISO timestamp`);
  return Date.parse(v);
}
function rows(v, at, max) {
  if (!Array.isArray(v) || v.length > max) fail(`${at} must be an array (max ${max})`);
}
function unique(v, key, at) {
  const keys = v.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail(`${at}: expected objects`);
    return row[key];
  });
  if (new Set(keys).size !== v.length) fail(`${at}: duplicate ${key}`);
}
function version(v) {
  if (v !== 1) fail("unsupported schema_version");
}
function tokens(v, at) {
  for (const k of ["input_tokens", "cached_input_tokens", "output_tokens"]) {
    nullable(v[k], `${at}.${k}`);
    if (v[k] !== null && !Number.isSafeInteger(v[k])) fail(`${at}.${k} must be an integer`);
  }
  if (typeof v.cached_input_tokens === "number" && typeof v.input_tokens === "number" && v.cached_input_tokens > v.input_tokens) fail(`${at}: cache exceeds input tokens`);
}
var METRICS = ["input_tokens", "cached_input_tokens", "output_tokens", "duration_seconds"];
function validateObservation(v) {
  object(v, ["schema_version", "id", "task_id", "project", "languages", "task_types", "resource_id", "runtime", "model", "profile", "route", "at", "source", "outcome", "verified", ...METRICS, "actual_cost", "currency", "cost_mode"], "observation");
  version(v.schema_version);
  for (const k of ["id", "task_id", "project", "resource_id", "model", "profile", "source", "currency"]) text(v[k], `observation.${k}`);
  strings(v.languages, "observation.languages");
  strings(v.task_types, "observation.task_types");
  one(v.runtime, RUNTIMES, "observation.runtime");
  one(v.route, ROUTES, "observation.route");
  one(v.cost_mode, ["api", "subscription", "local"], "observation.cost_mode");
  one(v.outcome, ["success", "failure", "cancelled", "unknown"], "observation.outcome");
  bool(v.verified, "observation.verified");
  instant(v.at, "observation.at");
  tokens(v, "observation");
  nullable(v.duration_seconds, "observation.duration_seconds");
  nullable(v.actual_cost, "observation.actual_cost");
}
function validateInput(v) {
  object(v, ["schema_version", "as_of", "currency", "policy", "resources", "tasks", "memory"], "input");
  version(v.schema_version);
  instant(v.as_of, "as_of");
  text(v.currency, "currency");
  object(v.policy, ["objective", "cost_weight", "min_success_rate", "history_max_age_days", "max_incremental_cost"], "policy", ["max_incremental_cost"]);
  if (Object.hasOwn(v.policy, "max_incremental_cost")) nullable(v.policy.max_incremental_cost, "max_incremental_cost");
  one(v.policy.objective, ["cost", "duration", "balanced"], "policy.objective");
  number(v.policy.cost_weight, "cost_weight", 1);
  number(v.policy.min_success_rate, "min_success_rate", 1);
  number(v.policy.history_max_age_days, "history_max_age_days", 36500);
  rows(v.resources, "resources", LIMITS.resources);
  rows(v.tasks, "tasks", LIMITS.tasks);
  rows(v.memory, "memory", LIMITS.observations);
  for (const r of v.resources) {
    object(r, ["id", "runtime", "model", "profile", "session", "execution_pool", "quota_pool", "routes", "capabilities", "available", "observed_at", "expires_at", "source", "cost_mode", "currency", "rates", "incremental_cost", "quota_remaining_attempts"], "resource");
    for (const k of ["id", "model", "profile", "execution_pool", "quota_pool", "source", "currency"]) text(r[k], `resource.${k}`);
    if (r.session !== null) text(r.session, "session");
    one(r.runtime, RUNTIMES, "runtime");
    strings(r.routes, "routes");
    r.routes.forEach((x) => one(x, ROUTES, "route"));
    strings(r.capabilities, "capabilities");
    bool(r.available, "available");
    if (instant(r.expires_at, "expires_at") <= instant(r.observed_at, "observed_at")) fail("expires_at must follow observed_at");
    one(r.cost_mode, ["api", "subscription", "local"], "cost_mode");
    nullable(r.incremental_cost, "incremental_cost");
    nullable(r.quota_remaining_attempts, "quota_remaining_attempts");
    if (r.rates !== null) {
      object(r.rates, ["input", "output", "cache_read"], "rates");
      number(r.rates.input, "rates.input");
      number(r.rates.output, "rates.output");
      nullable(r.rates.cache_read, "rates.cache_read");
    }
    if (r.cost_mode === "api" && r.incremental_cost !== null) fail("API uses rates, not incremental_cost");
    if (r.cost_mode !== "api" && r.rates !== null) fail("subscription/local use incremental_cost, not API rates");
  }
  unique(v.resources, "id", "resources");
  const resources = v.resources;
  const pools = /* @__PURE__ */ new Map(), sessions = /* @__PURE__ */ new Map();
  for (const r of resources) {
    if (r.session !== null) {
      const key = JSON.stringify([r.runtime, r.profile, r.session]);
      if (sessions.has(key) && sessions.get(key) !== r.execution_pool) fail("same session must share an execution_pool");
      sessions.set(key, r.execution_pool);
    }
    if (pools.has(r.quota_pool) && pools.get(r.quota_pool) !== r.quota_remaining_attempts) fail("shared quota_pool must have consistent remaining capacity");
    pools.set(r.quota_pool, r.quota_remaining_attempts);
  }
  const ids = new Set(resources.map((r) => r.id));
  for (const t of v.tasks) {
    object(t, ["id", "project", "languages", "task_types", "requires", "depends_on", "candidates"], "task");
    text(t.id, "task.id");
    text(t.project, "task.project");
    for (const k of ["languages", "task_types", "requires", "depends_on"]) strings(t[k], `task.${k}`);
    rows(t.candidates, "candidates", LIMITS.candidates);
    const seen = /* @__PURE__ */ new Set();
    for (const c of t.candidates) {
      object(c, ["resource_id", "route", "estimate", "overhead"], "candidate");
      text(c.resource_id, "resource_id");
      if (!ids.has(c.resource_id)) fail("candidate resource not in catalog");
      one(c.route, ROUTES, "candidate.route");
      const key = JSON.stringify([c.resource_id, c.route]);
      if (seen.has(key)) fail("duplicate candidate");
      seen.add(key);
      object(c.estimate, [...METRICS, "success_rate", "source"], "estimate");
      tokens(c.estimate, "estimate");
      nullable(c.estimate.duration_seconds, "estimate.duration_seconds");
      nullable(c.estimate.success_rate, "estimate.success_rate", 1);
      text(c.estimate.source, "estimate.source");
      object(c.overhead, ["input_tokens", "duration_seconds", "incremental_cost"], "overhead");
      for (const k of Object.keys(c.overhead)) number(c.overhead[k], `overhead.${k}`);
      if (!Number.isSafeInteger(c.overhead.input_tokens)) fail("overhead.input_tokens must be an integer");
    }
  }
  unique(v.tasks, "id", "tasks");
  const tasks = v.tasks;
  const taskIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) for (const dep of t.depends_on) if (!taskIds.has(dep)) fail("unknown dependency");
  v.memory.forEach(validateObservation);
  unique(v.memory, "id", "memory");
}

// scripts/resource-analysis/analyze.ts
var sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function finite(value) {
  return value !== null && Number.isFinite(value) ? value : null;
}
function assess(input, task, candidate, resource) {
  const now = Date.parse(input.as_of), reasons = [], warnings = [];
  if (!resource.available) reasons.push("resource_unavailable");
  if (Date.parse(resource.observed_at) > now) reasons.push("resource_observation_in_future");
  if (Date.parse(resource.expires_at) <= now) reasons.push("resource_snapshot_expired");
  if (!resource.routes.includes(candidate.route)) reasons.push("route_unsupported");
  if (!task.requires.every((x) => resource.capabilities.includes(x))) reasons.push("capability_missing");
  const samples = input.memory.filter((o) => o.verified && ["success", "failure"].includes(o.outcome) && o.resource_id === resource.id && o.runtime === resource.runtime && o.model === resource.model && o.profile === resource.profile && o.cost_mode === resource.cost_mode && o.route === candidate.route && o.project === task.project && sameSet(o.languages, task.languages) && sameSet(o.task_types, task.task_types) && Date.parse(o.at) <= now && now - Date.parse(o.at) <= input.policy.history_max_age_days * 864e5);
  const sources = {};
  function metric(key) {
    if (samples.length && samples.every((o) => o[key] !== null)) {
      sources[key] = "matched_verified_attempts";
      return mean(samples.map((o) => o[key]));
    }
    sources[key] = candidate.estimate[key] === null ? "unknown" : `prior: ${candidate.estimate.source}`;
    return candidate.estimate[key];
  }
  const inputTokens = metric("input_tokens"), cacheTokens = metric("cached_input_tokens"), outputTokens = metric("output_tokens");
  const cacheConsistent = inputTokens !== null && cacheTokens !== null && cacheTokens <= inputTokens;
  let duration = metric("duration_seconds");
  if (duration !== null) duration += candidate.overhead.duration_seconds;
  const rate = samples.length ? samples.filter((o) => o.outcome === "success").length / samples.length : candidate.estimate.success_rate;
  sources.success_rate = samples.length ? "matched_verified_attempts" : rate === null ? "unknown" : `prior: ${candidate.estimate.source}`;
  if (!samples.length) warnings.push("no_matched_verified_history");
  else warnings.push("empirical_rate_is_not_a_calibrated_probability");
  if (resource.currency !== input.currency) reasons.push("currency_mismatch_no_conversion");
  let cost = null;
  if (resource.cost_mode === "api") {
    const prices = resource.rates;
    if (prices && cacheConsistent && outputTokens !== null && (cacheTokens === 0 || prices.cache_read !== null)) {
      cost = ((inputTokens - cacheTokens + candidate.overhead.input_tokens) * prices.input + cacheTokens * (prices.cache_read ?? 0) + outputTokens * prices.output) / 1e6;
    }
  } else cost = resource.incremental_cost;
  if (cost !== null) cost += candidate.overhead.incremental_cost;
  sources.cost = resource.source;
  if (cost === null) warnings.push("incremental_cost_unknown");
  if (resource.quota_remaining_attempts === null) warnings.push("quota_capacity_unknown");
  if (rate === null) reasons.push("success_rate_unknown");
  else if (rate <= 0 || rate < input.policy.min_success_rate) reasons.push("success_rate_below_requirement");
  if (duration === null) reasons.push("duration_unknown");
  const attempts = rate !== null && rate > 0 ? finite(1 / rate) : null;
  const expectedCost = cost !== null && attempts !== null ? finite(cost * attempts) : null;
  const expectedDuration = duration !== null && attempts !== null ? finite(duration * attempts) : null;
  if (attempts === null && rate !== null && rate > 0 || duration !== null && attempts !== null && expectedDuration === null || cost !== null && attempts !== null && expectedCost === null) reasons.push("numeric_overflow");
  if (attempts !== null && resource.quota_remaining_attempts !== null && attempts > resource.quota_remaining_attempts) reasons.push("estimated_quota_insufficient");
  return {
    task_id: task.id,
    resource_id: resource.id,
    route: candidate.route,
    eligible: reasons.length === 0,
    reasons,
    warnings,
    samples: samples.length,
    metric_sources: sources,
    cost_per_attempt: cost,
    duration_per_attempt_seconds: duration,
    success_rate: rate,
    conditional_cost_to_success: expectedCost,
    conditional_duration_to_success_seconds: expectedDuration,
    expected_attempts: attempts
  };
}
function orderTasks(tasks) {
  const result = [], done = /* @__PURE__ */ new Set();
  while (result.length < tasks.length) {
    const next = tasks.find((t) => !done.has(t.id) && t.depends_on.every((id) => done.has(id)));
    if (!next) throw new Error("analysis: dependency cycle");
    result.push(next);
    done.add(next.id);
  }
  return result;
}
function analyze(value) {
  validateInput(value);
  const input = value;
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  const ordered = orderTasks(input.tasks);
  const tasks = input.tasks.map((task) => ({ task_id: task.id, candidates: task.candidates.map((c) => assess(input, task, c, resources.get(c.resource_id))) }));
  const assessments = new Map(tasks.map((t) => [t.task_id, t.candidates.filter((c) => c.eligible)]));
  const choices = ordered.map((t) => assessments.get(t.id));
  const combinationCount = choices.reduce((n, c) => n * c.length, 1);
  const base = {
    schema_version: 1,
    as_of: input.as_of,
    currency: input.currency,
    objective: input.policy.objective,
    method: "bounded_assignment_enumeration_fixed_order_schedule",
    tasks,
    assumptions: [
      "Catalog and priors are caller observations, not authenticated availability or permission.",
      "Cost/duration to success use mean attempt / success rate, assuming identical independent retries; no retry is authorized.",
      "One active task per execution_pool; input-stable dependency order, not globally optimal scheduling.",
      "Quota capacity is caller-estimated attempt equivalents; unknown quotas are not checked.",
      "No automatic cross-project/language/type transfer; measured history can contain selection bias."
    ]
  };
  const empty = { recommended: null, proposals: { cost: null, duration: null, balanced: null }, pareto: [] };
  if (!ordered.length || choices.some((c) => !c.length)) return { ...base, status: "insufficient_data_or_resources", assignments_evaluated: 0, ...empty };
  if (combinationCount > LIMITS.assignments) return { ...base, status: "search_limit", assignments_evaluated: 0, combination_count: combinationCount, limit: LIMITS.assignments, ...empty };
  let evaluated = 0;
  const plans = [];
  function visit(index, selected) {
    if (index < choices.length) {
      for (const c of choices[index]) visit(index + 1, [...selected, c]);
      return;
    }
    evaluated++;
    const ends = /* @__PURE__ */ new Map(), pools = /* @__PURE__ */ new Map(), quotas = /* @__PURE__ */ new Map();
    const plan = { assignments: [], incremental_cost: 0, elapsed_seconds: 0, estimated_attempts: /* @__PURE__ */ Object.create(null) };
    for (let i = 0; i < ordered.length; i++) {
      const task = ordered[i], c = selected[i], r = resources.get(c.resource_id);
      const used = (quotas.get(r.quota_pool) ?? 0) + c.expected_attempts;
      if (r.quota_remaining_attempts !== null && used > r.quota_remaining_attempts + 1e-9) return;
      quotas.set(r.quota_pool, used);
      plan.estimated_attempts[r.quota_pool] = used;
      const start = Math.max(pools.get(r.execution_pool) ?? 0, ...task.depends_on.map((id) => ends.get(id)));
      const end = start + c.conditional_duration_to_success_seconds;
      if (!Number.isFinite(end)) return;
      ends.set(task.id, end);
      pools.set(r.execution_pool, end);
      plan.elapsed_seconds = Math.max(plan.elapsed_seconds, end);
      plan.incremental_cost = plan.incremental_cost === null || c.conditional_cost_to_success === null ? null : plan.incremental_cost + c.conditional_cost_to_success;
      if (plan.incremental_cost !== null && !Number.isFinite(plan.incremental_cost)) return;
      plan.assignments.push({ task_id: task.id, resource_id: r.id, route: c.route, start_seconds: start, end_seconds: end });
    }
    if (input.policy.max_incremental_cost !== void 0 && input.policy.max_incremental_cost !== null && (plan.incremental_cost === null || plan.incremental_cost > input.policy.max_incremental_cost)) return;
    plans.push(plan);
  }
  visit(0, []);
  const priced = plans.filter((p) => p.incremental_cost !== null);
  const minCost = Math.min(...priced.map((p) => p.incremental_cost)), maxCost = Math.max(...priced.map((p) => p.incremental_cost));
  const minTime = Math.min(...priced.map((p) => p.elapsed_seconds)), maxTime = Math.max(...priced.map((p) => p.elapsed_seconds));
  const norm = (n, min, max) => max > min ? (n - min) / (max - min) : 0;
  function best(objective) {
    const candidates = objective === "duration" ? plans : priced;
    let winner = null, score = Infinity;
    for (const plan of candidates) {
      const s = objective === "cost" ? plan.incremental_cost : objective === "duration" ? plan.elapsed_seconds : input.policy.cost_weight * norm(plan.incremental_cost, minCost, maxCost) + (1 - input.policy.cost_weight) * norm(plan.elapsed_seconds, minTime, maxTime);
      if (s < score || s === score && winner && (objective === "cost" ? plan.elapsed_seconds < winner.elapsed_seconds : plan.incremental_cost !== null && (winner.incremental_cost === null || plan.incremental_cost < winner.incremental_cost))) {
        score = s;
        winner = plan;
      }
    }
    return winner;
  }
  const sorted = [...priced].sort((a, b) => a.incremental_cost - b.incremental_cost || a.elapsed_seconds - b.elapsed_seconds);
  const frontier = [];
  let fastest = Infinity;
  for (const p of sorted) if (p.elapsed_seconds < fastest) {
    frontier.push(p);
    fastest = p.elapsed_seconds;
  }
  const proposals = { cost: best("cost"), duration: best("duration"), balanced: best("balanced") };
  const recommended = proposals[input.policy.objective];
  return {
    ...base,
    status: recommended ? "ok" : plans.length ? "insufficient_cost_data" : "infeasible_capacity",
    assignments_evaluated: evaluated,
    feasible_assignments: plans.length,
    recommended,
    proposals,
    pareto: frontier.slice(0, 20),
    pareto_omitted: Math.max(0, frontier.length - 20)
  };
}

// scripts/resource-analysis/compact.ts
var import_node_crypto = require("node:crypto");
function compactAnalysis(input, analysis) {
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  const selected = analysis.recommended;
  const assignments = selected?.assignments.map((a) => {
    const resource = resources.get(a.resource_id);
    const assessment = analysis.tasks.find((t) => t.task_id === a.task_id)?.candidates.find((c) => c.resource_id === a.resource_id && c.route === a.route);
    if (!resource || !assessment) throw new Error("analysis: inconsistent recommendation identity");
    const grouped = /* @__PURE__ */ new Map();
    for (const [metric, source] of Object.entries(assessment.metric_sources)) grouped.set(source, [...grouped.get(source) ?? [], metric]);
    return {
      ...a,
      runtime: resource.runtime,
      model: resource.model,
      profile: resource.profile,
      session: resource.session,
      resource_expires_at: resource.expires_at,
      samples: assessment.samples,
      success_rate: assessment.success_rate,
      estimate_basis: assessment.metric_sources.success_rate === "matched_verified_attempts" ? "verified_history" : "explicit_prior",
      prior_metrics: Object.entries(assessment.metric_sources).filter(([, source]) => source.startsWith("prior:")).map(([metric]) => metric),
      evidence_sources: [...grouped].map(([source, metrics]) => ({ metrics, source: source.slice(0, 256), truncated: source.length > 256 })),
      warnings: assessment.warnings
    };
  }) ?? [];
  const allWarnings = analysis.tasks.flatMap((t) => t.candidates.flatMap((c) => c.warnings));
  const hasUnpriced = analysis.tasks.some((t) => t.candidates.some((c) => c.eligible && c.conditional_cost_to_success === null));
  return {
    schema_version: 1,
    kind: "roster-resource-recommendation",
    input_digest: (0, import_node_crypto.createHash)("sha256").update(JSON.stringify(input)).digest("hex"),
    as_of: analysis.as_of,
    currency: analysis.currency,
    objective: analysis.objective,
    policy: input.policy,
    status: analysis.status,
    method: analysis.method,
    search: {
      assignments_evaluated: analysis.assignments_evaluated,
      combination_count: "combination_count" in analysis ? analysis.combination_count : null,
      limit: "limit" in analysis ? analysis.limit : null
    },
    recommended: selected ? {
      incremental_cost: selected.incremental_cost,
      elapsed_seconds: selected.elapsed_seconds,
      estimated_attempts: selected.estimated_attempts,
      assignments
    } : null,
    alternatives: Object.fromEntries(Object.entries(analysis.proposals).map(([key, plan]) => [
      key,
      plan ? { incremental_cost: plan.incremental_cost, elapsed_seconds: plan.elapsed_seconds } : null
    ])),
    task_coverage: analysis.tasks.map((t) => ({
      task_id: t.task_id,
      eligible_options: t.candidates.filter((c) => c.eligible).length,
      unpriced_options: t.candidates.filter((c) => c.eligible && c.conditional_cost_to_success === null).length,
      exclusions: [...new Set(t.candidates.flatMap((c) => c.reasons))]
    })),
    warnings: [.../* @__PURE__ */ new Set([
      ...allWarnings,
      ...hasUnpriced ? ["unpriced_options_excluded_from_cost_comparison"] : [],
      ...analysis.status === "ok" ? [] : [analysis.status]
    ])],
    limitations: [...analysis.assumptions, "Advisory only: retain accepted topology, owner constraints, authorization and independent quality gates."]
  };
}

// scripts/roster-analyze.ts
var { readBytes, safeAncestors, atomicWrite } = require_roster_artifacts();
function decode(bytes) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
function readDocument(file) {
  return JSON.parse(decode(readBytes(file, { strict: true })));
}
function initialAbsence(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT" && !("reason" in error && error.reason === "changed");
}
function readMemory(file) {
  let bytes;
  try {
    bytes = readBytes(file, { strict: true });
  } catch (error) {
    if (initialAbsence(error)) throw new Error("memory missing; use record to create it, or omit --memory");
    throw error;
  }
  return parseMemory(bytes);
}
function parseMemory(bytes) {
  if (bytes.length && bytes.at(-1) !== 10) throw new Error("memory has an incomplete final line; reconcile before use");
  const lines = decode(bytes).split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > LIMITS.observations) throw new Error("memory exceeds observation limit");
  const rows2 = lines.map((line, i) => {
    if (!line.trim()) throw new Error(`empty memory record at line ${i + 1}`);
    const row = JSON.parse(line);
    validateObservation(row);
    return row;
  });
  if (new Set(rows2.map((r) => r.id)).size !== rows2.length) throw new Error("duplicate observation id in memory");
  return rows2;
}
function record(file, value) {
  validateObservation(value);
  safeAncestors(file);
  const lock = `${import_node_path.default.resolve(file)}.lock`;
  const fd = import_node_fs.default.openSync(lock, "wx", 384);
  try {
    let bytes = Buffer.alloc(0);
    try {
      bytes = readBytes(file, { strict: true });
    } catch (error) {
      if (!initialAbsence(error)) throw error;
    }
    const rows2 = parseMemory(bytes);
    const existing = rows2.find((r) => r.id === value.id);
    if (existing) {
      if (!(0, import_node_util.isDeepStrictEqual)(existing, value)) throw new Error("observation id already has different content");
      return { recorded: false, duplicate: true, id: value.id };
    }
    if (rows2.length >= LIMITS.observations) throw new Error("memory exceeds observation limit");
    const updated = decode(bytes) + JSON.stringify(value) + "\n";
    atomicWrite(file, updated);
    return { recorded: true, duplicate: false, id: value.id };
  } finally {
    import_node_fs.default.closeSync(fd);
    import_node_fs.default.unlinkSync(lock);
  }
}
function summarize(rows2) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows2) {
    const key = JSON.stringify([row.project, [...row.languages].sort(), [...row.task_types].sort(), row.resource_id, row.runtime, row.model, row.profile, row.route, row.cost_mode, row.currency]);
    groups.set(key, [...groups.get(key) ?? [], row]);
  }
  return { schema_version: 1, observations: rows2.length, groups: [...groups].map(([key, values]) => {
    const [project, languages, task_types, resource_id, runtime, model, profile, route, cost_mode, currency] = JSON.parse(key);
    const verified = values.filter((v) => v.verified && ["success", "failure"].includes(v.outcome));
    const metrics = Object.fromEntries(["input_tokens", "cached_input_tokens", "output_tokens", "duration_seconds", "actual_cost"].map((k) => {
      const known = values.map((v) => v[k]).filter((x) => typeof x === "number");
      return [k, { samples: known.length, total: known.length ? known.reduce((a, b) => a + b, 0) : null }];
    }));
    return {
      project,
      languages,
      task_types,
      resource_id,
      runtime,
      model,
      profile,
      route,
      cost_mode,
      currency,
      attempts: values.length,
      verified_attempts: verified.length,
      verified_successes: verified.filter((v) => v.outcome === "success").length,
      metrics
    };
  }) };
}
var commands = {
  analyze: ["input", "memory", "objective", "cost-weight", "format"],
  record: ["memory", "observation"],
  memory: ["memory"],
  taxonomy: []
};
function main(argv) {
  const [command, ...args] = argv;
  if (!Object.hasOwn(commands, command)) throw new Error("usage: roster-analyze.cjs analyze --input FILE [--memory FILE] [--objective cost|duration|balanced] [--cost-weight 0..1] [--format full|compact] | record --memory FILE --observation FILE | memory --memory FILE | taxonomy");
  const opts = /* @__PURE__ */ new Map();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flag.startsWith("--") || !commands[command].includes(flag.slice(2)) || opts.has(flag.slice(2)) || args[i + 1] === void 0 || args[i + 1].startsWith("--")) throw new Error(`invalid, duplicate or incomplete option: ${flag}`);
    opts.set(flag.slice(2), args[i + 1]);
  }
  const required = (key) => {
    const v = opts.get(key);
    if (!v) throw new Error(`missing --${key}`);
    return v;
  };
  let result;
  if (command === "taxonomy") result = { schema_version: 1, task_types: TASK_TYPES, extensible: true };
  else if (command === "record") result = record(required("memory"), readDocument(required("observation")));
  else if (command === "memory") result = summarize(readMemory(required("memory")));
  else {
    const format = opts.get("format") ?? "full";
    if (!["full", "compact"].includes(format)) throw new Error("--format must be full or compact");
    const input = readDocument(required("input"));
    validateInput(input);
    if (opts.has("memory")) input.memory = [...input.memory, ...readMemory(opts.get("memory"))];
    if (opts.has("objective")) input.policy.objective = opts.get("objective");
    if (opts.has("cost-weight")) {
      const weight = opts.get("cost-weight");
      if (!weight.trim()) throw new Error("invalid cost weight");
      input.policy.cost_weight = Number(weight);
    }
    const analysis = analyze(input);
    result = format === "compact" ? compactAnalysis(input, analysis) : analysis;
    if (analysis.status !== "ok") process.exitCode = 2;
  }
  const output = JSON.stringify(result, null, 2) + "\n";
  if (Buffer.byteLength(output) > LIMITS.bytes) throw new Error("output exceeds byte limit");
  process.stdout.write(output);
}
try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
}
