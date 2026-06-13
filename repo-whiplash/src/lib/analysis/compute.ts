import { db } from "@/lib/db";
import { METRICS, FINDING_TITLES, UNAVAILABLE_METRICS } from "./metrics";
import { monthKey, pctChange } from "./stats";
import type { Slice } from "./types";

export interface MetricSeriesPoint {
  month: string;
  value: number | null;
}

export interface MetricResult {
  timeseries: MetricSeriesPoint[];
  low: number | null;
  high: number | null;
  pctChange: number | null;
}

export interface ScopeResult {
  key: string;
  label: string;
  provider?: string;
  metrics: Record<string, MetricResult>;
}

export interface AnalysisResult {
  range: { from: string; to: string };
  cutoff: string;
  months: string[];
  repos: { id: string; fullName: string; provider: string }[];
  scopes: ScopeResult[];
  metricDefs: {
    id: string;
    finding: string;
    findingNum: number;
    label: string;
    unit: string;
    direction: string;
    provenance: string;
    description: string;
  }[];
  findingTitles: Record<number, string>;
  unavailable: typeof UNAVAILABLE_METRICS;
}

function subSlice(s: Slice, keep: (d: Date) => boolean): Slice {
  return {
    prs: s.prs.filter((p) => keep(p.createdAt)),
    commits: s.commits.filter((c) => keep(c.authoredAt)),
    issues: s.issues.filter((i) => keep(i.createdAt)),
    deployments: s.deployments.filter((d) => keep(d.createdAt)),
  };
}

function listMonths(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (d <= end) {
    out.push(monthKey(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// Pick a cutoff: first month where AI-commit share crosses the threshold,
// else the midpoint of the range.
function autoCutoff(slice: Slice, from: Date, to: Date, threshold = 25): Date {
  const months = listMonths(from, to);
  for (const m of months) {
    const inMonth = slice.commits.filter((c) => monthKey(c.authoredAt) === m);
    if (inMonth.length >= 5) {
      const share = (inMonth.filter((c) => c.aiAssisted).length / inMonth.length) * 100;
      if (share >= threshold) return new Date(`${m}-01T00:00:00Z`);
    }
  }
  return new Date((from.getTime() + to.getTime()) / 2);
}

function computeScope(label: string, key: string, slice: Slice, months: string[], cutoff: Date, from: Date, to: Date, provider?: string): ScopeResult {
  const metrics: Record<string, MetricResult> = {};
  const lowSlice = subSlice(slice, (d) => d >= from && d < cutoff);
  const highSlice = subSlice(slice, (d) => d >= cutoff && d <= to);

  for (const def of METRICS) {
    const timeseries = months.map((m) => ({
      month: m,
      value: def.compute(subSlice(slice, (d) => monthKey(d) === m)),
    }));
    const low = def.compute(lowSlice);
    const high = def.compute(highSlice);
    metrics[def.id] = { timeseries, low, high, pctChange: pctChange(low, high) };
  }
  return { key, label, provider, metrics };
}

export interface ComputeOptions {
  repoIds?: string[]; // restrict to these (default: all selected for user)
  from?: string;
  to?: string;
  cutoff?: string;
}

export async function computeAnalysis(userId: string, opts: ComputeOptions = {}): Promise<AnalysisResult> {
  const repos = await db.repo.findMany({
    where: { userId, selected: true, ...(opts.repoIds ? { id: { in: opts.repoIds } } : {}) },
    select: { id: true, fullName: true, provider: true },
  });
  const repoIds = repos.map((r) => r.id);

  const [prs, commits, issues, deployments] = await Promise.all([
    db.pullRequest.findMany({ where: { repoId: { in: repoIds } } }),
    db.commit.findMany({ where: { repoId: { in: repoIds } } }),
    db.issueRecord.findMany({ where: { repoId: { in: repoIds } } }),
    db.deployment.findMany({ where: { repoId: { in: repoIds } } }),
  ]);

  const slice: Slice = {
    prs: prs.map((p) => ({ ...p })),
    commits: commits.map((c) => ({ ...c })),
    issues: issues.map((i) => ({ ...i })),
    deployments: deployments.map((d) => ({ ...d })),
  };

  // Determine date range from data (or explicit opts).
  const allTs = [
    ...slice.prs.map((p) => p.createdAt.getTime()),
    ...slice.commits.map((c) => c.authoredAt.getTime()),
    ...slice.issues.map((i) => i.createdAt.getTime()),
  ];
  const from = opts.from ? new Date(opts.from) : new Date(allTs.length ? Math.min(...allTs) : Date.now());
  const to = opts.to ? new Date(opts.to) : new Date(allTs.length ? Math.max(...allTs) : Date.now());
  const cutoff = opts.cutoff ? new Date(opts.cutoff) : autoCutoff(slice, from, to);
  const months = listMonths(from, to);

  const scopes: ScopeResult[] = [];
  if (repos.length > 1) {
    scopes.push(computeScope("All repositories", "aggregate", slice, months, cutoff, from, to));
  }
  for (const r of repos) {
    const repoSlice: Slice = {
      prs: slice.prs.filter((p) => p.repoId === r.id),
      commits: slice.commits.filter((c) => c.repoId === r.id),
      issues: slice.issues.filter((i) => i.repoId === r.id),
      deployments: slice.deployments.filter((d) => d.repoId === r.id),
    };
    scopes.push(computeScope(r.fullName, r.id, repoSlice, months, cutoff, from, to, r.provider));
  }

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    cutoff: cutoff.toISOString(),
    months,
    repos,
    scopes,
    metricDefs: METRICS.map(({ compute, ...rest }) => rest),
    findingTitles: FINDING_TITLES,
    unavailable: UNAVAILABLE_METRICS,
  };
}
