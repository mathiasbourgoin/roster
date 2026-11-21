import { createHash } from "node:crypto";
import type { AnalysisInput } from "./types";
import type { analyze } from "./analyze";

/** Presentation only: decisions, exclusions and exit semantics stay owned by analyze(). */
export function compactAnalysis(input: AnalysisInput, analysis: ReturnType<typeof analyze>) {
  const resources = new Map(input.resources.map(r => [r.id, r]));
  const selected = analysis.recommended;
  const assignments = selected?.assignments.map(a => {
    const resource = resources.get(a.resource_id);
    const assessment = analysis.tasks.find(t => t.task_id === a.task_id)?.candidates.find(c => c.resource_id === a.resource_id && c.route === a.route);
    if (!resource || !assessment) throw new Error("analysis: inconsistent recommendation identity");
    const grouped = new Map<string, string[]>();
    for (const [metric, source] of Object.entries(assessment.metric_sources)) grouped.set(source, [...(grouped.get(source) ?? []), metric]);
    return { ...a, runtime: resource.runtime, model: resource.model, profile: resource.profile, session: resource.session,
      resource_expires_at: resource.expires_at, samples: assessment.samples, success_rate: assessment.success_rate,
      estimate_basis: assessment.metric_sources.success_rate === "matched_verified_attempts" ? "verified_history" : "explicit_prior",
      prior_metrics: Object.entries(assessment.metric_sources).filter(([, source]) => source.startsWith("prior:")).map(([metric]) => metric),
      evidence_sources: [...grouped].map(([source, metrics]) => ({ metrics, source: source.slice(0, 256), truncated: source.length > 256 })),
      warnings: assessment.warnings };
  }) ?? [];
  const allWarnings = analysis.tasks.flatMap(t => t.candidates.flatMap(c => c.warnings));
  const hasUnpriced = analysis.tasks.some(t => t.candidates.some(c => c.eligible && c.conditional_cost_to_success === null));
  return {
    schema_version: 1, kind: "roster-resource-recommendation",
    input_digest: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    as_of: analysis.as_of, currency: analysis.currency, objective: analysis.objective, policy: input.policy,
    status: analysis.status, method: analysis.method,
    search: { assignments_evaluated: analysis.assignments_evaluated,
      combination_count: "combination_count" in analysis ? analysis.combination_count : null,
      limit: "limit" in analysis ? analysis.limit : null },
    recommended: selected ? { incremental_cost: selected.incremental_cost, elapsed_seconds: selected.elapsed_seconds,
      estimated_attempts: selected.estimated_attempts, assignments } : null,
    alternatives: Object.fromEntries(Object.entries(analysis.proposals).map(([key, plan]) => [key,
      plan ? { incremental_cost: plan.incremental_cost, elapsed_seconds: plan.elapsed_seconds } : null])),
    task_coverage: analysis.tasks.map(t => ({ task_id: t.task_id,
      eligible_options: t.candidates.filter(c => c.eligible).length,
      unpriced_options: t.candidates.filter(c => c.eligible && c.conditional_cost_to_success === null).length,
      exclusions: [...new Set(t.candidates.flatMap(c => c.reasons))] })),
    warnings: [...new Set([...allWarnings, ...(hasUnpriced ? ["unpriced_options_excluded_from_cost_comparison"] : []),
      ...(analysis.status === "ok" ? [] : [analysis.status])])],
    limitations: [...analysis.assumptions, "Advisory only: retain accepted topology, owner constraints, authorization and independent quality gates."],
  };
}
