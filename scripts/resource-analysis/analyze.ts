import { AnalysisInput, Assessment, Candidate, Estimate, Observation, Plan, Resource, Task, Objective } from "./types";
import { LIMITS, validateInput } from "./validate";

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
function mean(values: number[]): number { return values.reduce((a, b) => a + b, 0) / values.length; }
function finite(value: number | null): number | null { return value !== null && Number.isFinite(value) ? value : null; }
function assess(input: AnalysisInput, task: Task, candidate: Candidate, resource: Resource): Assessment {
  const now = Date.parse(input.as_of), reasons: string[] = [], warnings: string[] = [];
  if (!resource.available) reasons.push("resource_unavailable");
  if (Date.parse(resource.observed_at) > now) reasons.push("resource_observation_in_future");
  if (Date.parse(resource.expires_at) <= now) reasons.push("resource_snapshot_expired");
  if (!resource.routes.includes(candidate.route)) reasons.push("route_unsupported");
  if (!task.requires.every(x => resource.capabilities.includes(x))) reasons.push("capability_missing");
  const samples = input.memory.filter(o => o.verified && ["success", "failure"].includes(o.outcome)
    && o.resource_id === resource.id && o.runtime === resource.runtime && o.model === resource.model && o.profile === resource.profile
    && o.cost_mode === resource.cost_mode && o.route === candidate.route && o.project === task.project
    && sameSet(o.languages, task.languages) && sameSet(o.task_types, task.task_types)
    && Date.parse(o.at) <= now && now - Date.parse(o.at) <= input.policy.history_max_age_days * 86400000);
  const sources: Record<string, string> = {};
  function metric(key: keyof Pick<Estimate, "input_tokens" | "cached_input_tokens" | "output_tokens" | "duration_seconds">): number | null {
    if (samples.length && samples.every(o => o[key] !== null)) {
      sources[key] = "matched_verified_attempts";
      return mean(samples.map(o => o[key]!));
    }
    sources[key] = candidate.estimate[key] === null ? "unknown" : `prior: ${candidate.estimate.source}`;
    return candidate.estimate[key];
  }
  const inputTokens = metric("input_tokens"), cacheTokens = metric("cached_input_tokens"), outputTokens = metric("output_tokens");
  // Never combine a cached-token mean with an incompatible input prior or mean.
  const cacheConsistent = inputTokens !== null && cacheTokens !== null && cacheTokens <= inputTokens;
  let duration = metric("duration_seconds");
  if (duration !== null) duration += candidate.overhead.duration_seconds;
  const rate = samples.length ? samples.filter(o => o.outcome === "success").length / samples.length : candidate.estimate.success_rate;
  sources.success_rate = samples.length ? "matched_verified_attempts" : rate === null ? "unknown" : `prior: ${candidate.estimate.source}`;
  if (!samples.length) warnings.push("no_matched_verified_history");
  else warnings.push("empirical_rate_is_not_a_calibrated_probability");
  if (resource.currency !== input.currency) reasons.push("currency_mismatch_no_conversion");
  let cost: number | null = null;
  if (resource.cost_mode === "api") {
    const prices = resource.rates;
    if (prices && cacheConsistent && outputTokens !== null && (cacheTokens === 0 || prices.cache_read !== null)) {
      cost = ((inputTokens! - cacheTokens! + candidate.overhead.input_tokens) * prices.input
        + cacheTokens! * (prices.cache_read ?? 0) + outputTokens * prices.output) / 1e6;
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
  return { task_id: task.id, resource_id: resource.id, route: candidate.route, eligible: reasons.length === 0, reasons, warnings,
    samples: samples.length, metric_sources: sources, cost_per_attempt: cost, duration_per_attempt_seconds: duration, success_rate: rate,
    conditional_cost_to_success: expectedCost, conditional_duration_to_success_seconds: expectedDuration, expected_attempts: attempts };
}
function orderTasks(tasks: Task[]): Task[] {
  const result: Task[] = [], done = new Set<string>();
  while (result.length < tasks.length) {
    // Stable input order, not an optimal scheduling algorithm.
    const next = tasks.find(t => !done.has(t.id) && t.depends_on.every(id => done.has(id)));
    if (!next) throw new Error("analysis: dependency cycle");
    result.push(next); done.add(next.id);
  }
  return result;
}
export function analyze(value: unknown) {
  validateInput(value);
  const input = value;
  const resources = new Map(input.resources.map(r => [r.id, r]));
  const ordered = orderTasks(input.tasks);
  const tasks = input.tasks.map(task => ({ task_id: task.id, candidates: task.candidates.map(c => assess(input, task, c, resources.get(c.resource_id)!)) }));
  const assessments = new Map(tasks.map(t => [t.task_id, t.candidates.filter(c => c.eligible)]));
  const choices = ordered.map(t => assessments.get(t.id)!);
  const combinationCount = choices.reduce((n, c) => n * c.length, 1);
  const base = {
    schema_version: 1, as_of: input.as_of, currency: input.currency, objective: input.policy.objective,
    method: "bounded_assignment_enumeration_fixed_order_schedule", tasks,
    assumptions: ["Catalog and priors are caller observations, not authenticated availability or permission.",
      "Cost/duration to success use mean attempt / success rate, assuming identical independent retries; no retry is authorized.",
      "One active task per execution_pool; input-stable dependency order, not globally optimal scheduling.",
      "Quota capacity is caller-estimated attempt equivalents; unknown quotas are not checked.",
      "No automatic cross-project/language/type transfer; measured history can contain selection bias."],
  };
  const empty = { recommended: null as Plan | null, proposals: { cost: null as Plan | null, duration: null as Plan | null, balanced: null as Plan | null }, pareto: [] as Plan[] };
  if (!ordered.length || choices.some(c => !c.length)) return { ...base, status: "insufficient_data_or_resources", assignments_evaluated: 0, ...empty };
  if (combinationCount > LIMITS.assignments) return { ...base, status: "search_limit", assignments_evaluated: 0, combination_count: combinationCount, limit: LIMITS.assignments, ...empty };
  let evaluated = 0;
  const plans: Plan[] = [];
  function visit(index: number, selected: Assessment[]): void {
    if (index < choices.length) { for (const c of choices[index]) visit(index + 1, [...selected, c]); return; }
    evaluated++;
    const ends = new Map<string, number>(), pools = new Map<string, number>(), quotas = new Map<string, number>();
    const plan: Plan = { assignments: [], incremental_cost: 0, elapsed_seconds: 0, estimated_attempts: Object.create(null) };
    for (let i = 0; i < ordered.length; i++) {
      const task = ordered[i], c = selected[i], r = resources.get(c.resource_id)!;
      const used = (quotas.get(r.quota_pool) ?? 0) + c.expected_attempts!;
      if (r.quota_remaining_attempts !== null && used > r.quota_remaining_attempts + 1e-9) return;
      quotas.set(r.quota_pool, used);
      plan.estimated_attempts[r.quota_pool] = used;
      const start = Math.max(pools.get(r.execution_pool) ?? 0, ...task.depends_on.map(id => ends.get(id)!));
      const end = start + c.conditional_duration_to_success_seconds!;
      if (!Number.isFinite(end)) return;
      ends.set(task.id, end); pools.set(r.execution_pool, end);
      plan.elapsed_seconds = Math.max(plan.elapsed_seconds, end);
      plan.incremental_cost = plan.incremental_cost === null || c.conditional_cost_to_success === null ? null : plan.incremental_cost + c.conditional_cost_to_success;
      if (plan.incremental_cost !== null && !Number.isFinite(plan.incremental_cost)) return;
      plan.assignments.push({ task_id: task.id, resource_id: r.id, route: c.route, start_seconds: start, end_seconds: end });
    }
    if (input.policy.max_incremental_cost !== undefined && input.policy.max_incremental_cost !== null
      && (plan.incremental_cost === null || plan.incremental_cost > input.policy.max_incremental_cost)) return;
    plans.push(plan);
  }
  visit(0, []);
  const priced = plans.filter(p => p.incremental_cost !== null);
  const minCost = Math.min(...priced.map(p => p.incremental_cost!)), maxCost = Math.max(...priced.map(p => p.incremental_cost!));
  const minTime = Math.min(...priced.map(p => p.elapsed_seconds)), maxTime = Math.max(...priced.map(p => p.elapsed_seconds));
  const norm = (n: number, min: number, max: number) => max > min ? (n - min) / (max - min) : 0;
  function best(objective: Objective): Plan | null {
    const candidates = objective === "duration" ? plans : priced;
    let winner: Plan | null = null, score = Infinity;
    for (const plan of candidates) {
      const s = objective === "cost" ? plan.incremental_cost! : objective === "duration" ? plan.elapsed_seconds
        : input.policy.cost_weight * norm(plan.incremental_cost!, minCost, maxCost) + (1 - input.policy.cost_weight) * norm(plan.elapsed_seconds, minTime, maxTime);
      if (s < score || s === score && winner && (objective === "cost" ? plan.elapsed_seconds < winner.elapsed_seconds : plan.incremental_cost !== null && (winner.incremental_cost === null || plan.incremental_cost < winner.incremental_cost))) { score = s; winner = plan; }
    }
    return winner;
  }
  // Sort then sweep: avoid an O(plans²) Pareto comparison at the search limit.
  const sorted = [...priced].sort((a, b) => a.incremental_cost! - b.incremental_cost! || a.elapsed_seconds - b.elapsed_seconds);
  const frontier: Plan[] = []; let fastest = Infinity;
  for (const p of sorted) if (p.elapsed_seconds < fastest) { frontier.push(p); fastest = p.elapsed_seconds; }
  const proposals = { cost: best("cost"), duration: best("duration"), balanced: best("balanced") };
  const recommended = proposals[input.policy.objective];
  return { ...base, status: recommended ? "ok" : plans.length ? "insufficient_cost_data" : "infeasible_capacity", assignments_evaluated: evaluated,
    feasible_assignments: plans.length, recommended, proposals, pareto: frontier.slice(0, 20), pareto_omitted: Math.max(0, frontier.length - 20) };
}
