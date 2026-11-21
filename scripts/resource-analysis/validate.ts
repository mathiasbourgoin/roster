import { AnalysisInput, Observation, Resource, Task, RUNTIMES, ROUTES } from "./types";

export const LIMITS = { resources: 128, tasks: 32, candidates: 16, observations: 10000, assignments: 50000, bytes: 16 * 1024 * 1024 } as const;
function fail(message: string): never { throw new Error(`analysis: ${message}`); }
function object(v: unknown, fields: string[], at: string, optional: string[] = []): asserts v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${at} must be an object`);
  for (const k of Object.keys(v)) if (!fields.includes(k)) fail(`${at}: unknown field ${k}`);
  for (const k of fields) if (!optional.includes(k) && !Object.hasOwn(v, k)) fail(`${at}: missing ${k}`);
}
function text(v: unknown, at: string): asserts v is string {
  if (typeof v !== "string" || !v.trim() || v.length > 2000 || /[\x00-\x1f\x7f]/.test(v)) fail(`${at} must be bounded nonempty text without controls`);
}
function strings(v: unknown, at: string, max = 64): asserts v is string[] {
  if (!Array.isArray(v) || v.length > max) fail(`${at} must be an array (max ${max})`);
  v.forEach(x => text(x, at));
  if (new Set(v).size !== v.length) fail(`${at} must be distinct`);
}
function number(v: unknown, at: string, max = 1e12): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) fail(`${at} must be finite in 0..${max}`);
}
function nullable(v: unknown, at: string, max = 1e12): asserts v is number | null { if (v !== null) number(v, at, max); }
function one(v: unknown, values: readonly string[], at: string): void { if (typeof v !== "string" || !values.includes(v)) fail(`${at} must be one of ${values.join(", ")}`); }
function bool(v: unknown, at: string): void { if (typeof v !== "boolean") fail(`${at} must be boolean`); }
export function instant(v: unknown, at: string): number {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) fail(`${at} must be a valid UTC ISO timestamp`);
  return Date.parse(v);
}
function rows(v: unknown, at: string, max: number): asserts v is unknown[] { if (!Array.isArray(v) || v.length > max) fail(`${at} must be an array (max ${max})`); }
function unique(v: unknown[], key: string, at: string): void {
  const keys = v.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail(`${at}: expected objects`);
    return (row as Record<string, unknown>)[key];
  });
  if (new Set(keys).size !== v.length) fail(`${at}: duplicate ${key}`);
}
function version(v: unknown): void { if (v !== 1) fail("unsupported schema_version"); }
function tokens(v: Record<string, unknown>, at: string): void {
  for (const k of ["input_tokens", "cached_input_tokens", "output_tokens"]) {
    nullable(v[k], `${at}.${k}`);
    if (v[k] !== null && !Number.isSafeInteger(v[k])) fail(`${at}.${k} must be an integer`);
  }
  if (typeof v.cached_input_tokens === "number" && typeof v.input_tokens === "number" && v.cached_input_tokens > v.input_tokens) fail(`${at}: cache exceeds input tokens`);
}
const METRICS = ["input_tokens", "cached_input_tokens", "output_tokens", "duration_seconds"];
export function validateObservation(v: unknown): asserts v is Observation {
  object(v, ["schema_version", "id", "task_id", "project", "languages", "task_types", "resource_id", "runtime", "model", "profile", "route", "at", "source", "outcome", "verified", ...METRICS, "actual_cost", "currency", "cost_mode"], "observation");
  version(v.schema_version);
  for (const k of ["id", "task_id", "project", "resource_id", "model", "profile", "source", "currency"]) text(v[k], `observation.${k}`);
  strings(v.languages, "observation.languages"); strings(v.task_types, "observation.task_types");
  one(v.runtime, RUNTIMES, "observation.runtime"); one(v.route, ROUTES, "observation.route");
  one(v.cost_mode, ["api", "subscription", "local"], "observation.cost_mode");
  one(v.outcome, ["success", "failure", "cancelled", "unknown"], "observation.outcome");
  bool(v.verified, "observation.verified"); instant(v.at, "observation.at");
  tokens(v, "observation"); nullable(v.duration_seconds, "observation.duration_seconds"); nullable(v.actual_cost, "observation.actual_cost");
}
export function validateInput(v: unknown): asserts v is AnalysisInput {
  object(v, ["schema_version", "as_of", "currency", "policy", "resources", "tasks", "memory"], "input");
  version(v.schema_version); instant(v.as_of, "as_of"); text(v.currency, "currency");
  object(v.policy, ["objective", "cost_weight", "min_success_rate", "history_max_age_days", "max_incremental_cost"], "policy", ["max_incremental_cost"]);
  if (Object.hasOwn(v.policy, "max_incremental_cost")) nullable(v.policy.max_incremental_cost, "max_incremental_cost");
  one(v.policy.objective, ["cost", "duration", "balanced"], "policy.objective");
  number(v.policy.cost_weight, "cost_weight", 1); number(v.policy.min_success_rate, "min_success_rate", 1);
  number(v.policy.history_max_age_days, "history_max_age_days", 36500);
  rows(v.resources, "resources", LIMITS.resources); rows(v.tasks, "tasks", LIMITS.tasks); rows(v.memory, "memory", LIMITS.observations);
  for (const r of v.resources) {
    object(r, ["id", "runtime", "model", "profile", "session", "execution_pool", "quota_pool", "routes", "capabilities", "available", "observed_at", "expires_at", "source", "cost_mode", "currency", "rates", "incremental_cost", "quota_remaining_attempts"], "resource");
    for (const k of ["id", "model", "profile", "execution_pool", "quota_pool", "source", "currency"]) text(r[k], `resource.${k}`);
    if (r.session !== null) text(r.session, "session");
    one(r.runtime, RUNTIMES, "runtime"); strings(r.routes, "routes"); r.routes.forEach((x: string) => one(x, ROUTES, "route"));
    strings(r.capabilities, "capabilities"); bool(r.available, "available");
    if (instant(r.expires_at, "expires_at") <= instant(r.observed_at, "observed_at")) fail("expires_at must follow observed_at");
    one(r.cost_mode, ["api", "subscription", "local"], "cost_mode");
    nullable(r.incremental_cost, "incremental_cost"); nullable(r.quota_remaining_attempts, "quota_remaining_attempts");
    if (r.rates !== null) { object(r.rates, ["input", "output", "cache_read"], "rates"); number(r.rates.input, "rates.input"); number(r.rates.output, "rates.output"); nullable(r.rates.cache_read, "rates.cache_read"); }
    if (r.cost_mode === "api" && r.incremental_cost !== null) fail("API uses rates, not incremental_cost");
    if (r.cost_mode !== "api" && r.rates !== null) fail("subscription/local use incremental_cost, not API rates");
  }
  unique(v.resources, "id", "resources");
  // All fields were checked above; cross-record constraints now use the validated shape.
  const resources = v.resources as Resource[];
  const pools = new Map<string, number | null>(), sessions = new Map<string, string>();
  for (const r of resources) {
    if (r.session !== null) {
      const key = JSON.stringify([r.runtime, r.profile, r.session]);
      if (sessions.has(key) && sessions.get(key) !== r.execution_pool) fail("same session must share an execution_pool");
      sessions.set(key, r.execution_pool);
    }
    if (pools.has(r.quota_pool) && pools.get(r.quota_pool) !== r.quota_remaining_attempts) fail("shared quota_pool must have consistent remaining capacity");
    pools.set(r.quota_pool, r.quota_remaining_attempts);
  }
  const ids = new Set(resources.map(r => r.id));
  for (const t of v.tasks) {
    object(t, ["id", "project", "languages", "task_types", "requires", "depends_on", "candidates"], "task");
    text(t.id, "task.id"); text(t.project, "task.project");
    for (const k of ["languages", "task_types", "requires", "depends_on"]) strings(t[k], `task.${k}`);
    rows(t.candidates, "candidates", LIMITS.candidates);
    const seen = new Set<string>();
    for (const c of t.candidates) {
      object(c, ["resource_id", "route", "estimate", "overhead"], "candidate"); text(c.resource_id, "resource_id");
      if (!ids.has(c.resource_id)) fail("candidate resource not in catalog"); one(c.route, ROUTES, "candidate.route");
      const key = JSON.stringify([c.resource_id, c.route]); if (seen.has(key)) fail("duplicate candidate"); seen.add(key);
      object(c.estimate, [...METRICS, "success_rate", "source"], "estimate"); tokens(c.estimate, "estimate");
      nullable(c.estimate.duration_seconds, "estimate.duration_seconds"); nullable(c.estimate.success_rate, "estimate.success_rate", 1); text(c.estimate.source, "estimate.source");
      object(c.overhead, ["input_tokens", "duration_seconds", "incremental_cost"], "overhead");
      for (const k of Object.keys(c.overhead)) number(c.overhead[k], `overhead.${k}`);
      if (!Number.isSafeInteger(c.overhead.input_tokens)) fail("overhead.input_tokens must be an integer");
    }
  }
  unique(v.tasks, "id", "tasks");
  const tasks = v.tasks as Task[];
  const taskIds = new Set(tasks.map(t => t.id));
  for (const t of tasks) for (const dep of t.depends_on) if (!taskIds.has(dep)) fail("unknown dependency");
  v.memory.forEach(validateObservation); unique(v.memory, "id", "memory");
}
