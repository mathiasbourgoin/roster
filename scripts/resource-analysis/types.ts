/** Offline advisory analysis. Availability and estimates are observations, never permissions. */
export const RUNTIMES = ["codex", "claude", "opencode", "pi"] as const;
export const ROUTES = ["sequential", "subagent", "parallel", "multisession", "workflow"] as const;
export type Runtime = typeof RUNTIMES[number];
export type Route = typeof ROUTES[number];
export type Objective = "cost" | "duration" | "balanced";
export const TASK_TYPES = {
  framing: ["clarification", "intake", "specification", "acceptance_criteria", "coherence_check"],
  research: ["code_exploration", "documentation_research", "solution_comparison", "dependency_analysis"],
  design: ["architecture", "api_design", "data_modeling", "decomposition", "planning"],
  implementation: ["feature", "bugfix", "refactoring", "migration", "configuration", "automation"],
  diagnosis: ["reproduction", "root_cause_analysis", "build_failure", "test_failure", "ci_failure"],
  verification: ["test_authoring", "test_execution", "code_review", "spec_compliance", "security_audit", "formal_verification"],
  performance: ["profiling", "benchmarking", "runtime_optimization", "memory_optimization", "token_optimization", "cost_optimization"],
  documentation: ["documentation", "documentation_update", "example_authoring", "tutorial", "changelog", "translation"],
  delivery: ["commit_preparation", "pull_request", "conflict_resolution", "ci_review", "release", "deployment"],
  coordination: ["topology_selection", "delegation", "result_integration", "progress_tracking", "failure_recovery"],
} as const;

export interface Resource {
  id: string;
  runtime: Runtime;
  model: string;
  profile: string;
  session: string | null;
  /** Shared bottleneck: same session, provider concurrency slot or local accelerator. */
  execution_pool: string;
  routes: Route[];
  capabilities: string[];
  available: boolean;
  observed_at: string;
  expires_at: string;
  source: string;
  cost_mode: "api" | "subscription" | "local";
  currency: string;
  /** Current rate snapshot. Cached input is a subset of input_tokens. */
  rates: { input: number; output: number; cache_read: number | null } | null;
  /** Explicit incremental per-attempt cost for subscription/local; null means unknown. */
  incremental_cost: number | null;
  quota_pool: string;
  /** Caller-estimated remaining attempt equivalents; no inference from provider percentages. */
  quota_remaining_attempts: number | null;
}
export interface Estimate {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  duration_seconds: number | null;
  success_rate: number | null;
  source: string;
}
export interface Candidate {
  resource_id: string;
  route: Route;
  estimate: Estimate;
  /** Added even when using historical attempt totals; zero must be explicit. */
  overhead: { input_tokens: number; duration_seconds: number; incremental_cost: number };
}
export interface Task {
  id: string;
  project: string;
  languages: string[];
  task_types: string[];
  requires: string[];
  depends_on: string[];
  candidates: Candidate[];
}
export interface Observation {
  schema_version: 1;
  id: string;
  task_id: string;
  project: string;
  languages: string[];
  task_types: string[];
  resource_id: string;
  runtime: Runtime;
  model: string;
  profile: string;
  route: Route;
  at: string;
  source: string;
  outcome: "success" | "failure" | "cancelled" | "unknown";
  verified: boolean;
  /** Usage billed to this resource/model; heterogeneous child usage must remain separate. */
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  duration_seconds: number | null;
  actual_cost: number | null;
  currency: string;
  cost_mode: Resource["cost_mode"];
}
export interface AnalysisInput {
  schema_version: 1;
  as_of: string;
  currency: string;
  policy: {
    objective: Objective;
    /** 1 favors cost; 0 favors elapsed time. Used only for balanced. */
    cost_weight: number;
    min_success_rate: number;
    history_max_age_days: number;
    /** Optional planning constraint, never a provider billing gate. */
    max_incremental_cost?: number | null;
  };
  resources: Resource[];
  tasks: Task[];
  memory: Observation[];
}
export interface Assessment {
  task_id: string;
  resource_id: string;
  route: Route;
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  samples: number;
  metric_sources: Record<string, string>;
  cost_per_attempt: number | null;
  duration_per_attempt_seconds: number | null;
  success_rate: number | null;
  conditional_cost_to_success: number | null;
  conditional_duration_to_success_seconds: number | null;
  expected_attempts: number | null;
}
export interface Plan {
  assignments: { task_id: string; resource_id: string; route: Route; start_seconds: number; end_seconds: number }[];
  incremental_cost: number | null;
  elapsed_seconds: number;
  estimated_attempts: Record<string, number>;
}
