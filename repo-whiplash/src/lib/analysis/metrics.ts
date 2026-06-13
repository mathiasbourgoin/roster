import type { MetricDef, Slice } from "./types";
import {
  dayKey,
  distinct,
  mean,
  median,
  percent,
  ratio,
  sum,
  toHours,
} from "./stats";

// ---- shared slice helpers -------------------------------------------------

const mergedPRs = (s: Slice) => s.prs.filter((p) => p.state === "merged");
const reviewedPRs = (s: Slice) => s.prs.filter((p) => p.firstReviewAt);

function activeDevCount(s: Slice): number {
  const fromCommits = distinct(s.commits, (c) => c.authorLogin);
  if (fromCommits > 0) return fromCommits;
  return distinct(s.prs, (p) => p.authorLogin);
}

function allDates(s: Slice): Date[] {
  return [
    ...s.commits.map((c) => c.authoredAt),
    ...s.prs.map((p) => p.createdAt),
    ...s.issues.map((i) => i.createdAt),
    ...s.deployments.map((d) => d.createdAt),
  ];
}

function spanDays(s: Slice): number {
  const dates = allDates(s).map((d) => d.getTime());
  if (dates.length === 0) return 0;
  const span = (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
  return Math.max(span, 1);
}

const spanWeeks = (s: Slice) => spanDays(s) / 7;
const spanMonths = (s: Slice) => spanDays(s) / 30.44;

// Average per-author "contexts per active day" — a proxy for thrashing.
function contextsPerActiveDay(items: { author: string | null }[], s: Slice): number | null {
  const byAuthorCount = new Map<string, number>();
  for (const it of items) {
    if (!it.author) continue;
    byAuthorCount.set(it.author, (byAuthorCount.get(it.author) ?? 0) + 1);
  }
  const activeDaysByAuthor = new Map<string, Set<string>>();
  for (const c of s.commits) {
    if (!c.authorLogin) continue;
    const set = activeDaysByAuthor.get(c.authorLogin) ?? new Set<string>();
    set.add(dayKey(c.authoredAt));
    activeDaysByAuthor.set(c.authorLogin, set);
  }
  const perAuthor: number[] = [];
  for (const [author, count] of byAuthorCount) {
    const days = activeDaysByAuthor.get(author)?.size ?? 0;
    if (days > 0) perAuthor.push(count / days);
  }
  return mean(perAuthor);
}

// ---- metric registry ------------------------------------------------------

export const METRICS: MetricDef[] = [
  // FINDING 1 — ADOPTION (levels, shown as % of population)
  {
    id: "ai_pr_share",
    finding: "Adoption",
    findingNum: 1,
    label: "PRs that are AI-assisted",
    unit: "%",
    direction: "neutral",
    provenance: "proxy",
    description:
      "Share of PRs whose title/body carry an AI tool trailer. Proxy for the report's AI-authorship/acceptance figures.",
    compute: (s) => percent(s.prs.filter((p) => p.aiAssisted).length, s.prs.length),
  },
  {
    id: "ai_commit_share",
    finding: "Adoption",
    findingNum: 1,
    label: "Commits that are AI-assisted",
    unit: "%",
    direction: "neutral",
    provenance: "proxy",
    description: "Share of commits with an AI co-author/generation trailer.",
    compute: (s) => percent(s.commits.filter((c) => c.aiAssisted).length, s.commits.length),
  },
  {
    id: "ai_dev_share",
    finding: "Adoption",
    findingNum: 1,
    label: "Developers using AI",
    unit: "%",
    direction: "neutral",
    provenance: "proxy",
    description: "Share of active commit authors with at least one AI-assisted commit.",
    compute: (s) => {
      const authors = new Set<string>();
      const aiAuthors = new Set<string>();
      for (const c of s.commits) {
        if (!c.authorLogin) continue;
        authors.add(c.authorLogin);
        if (c.aiAssisted) aiAuthors.add(c.authorLogin);
      }
      return percent(aiAuthors.size, authors.size);
    },
  },

  // FINDING 2 — COGNITIVE LOAD
  {
    id: "daily_pr_contexts",
    finding: "Cognitive load",
    findingNum: 2,
    label: "Daily PR contexts per dev",
    unit: "PRs/dev/day",
    direction: "down-good",
    provenance: "proxy",
    description: "Avg distinct PRs an author opens per active day. Proxy for PR context-switching.",
    compute: (s) => contextsPerActiveDay(s.prs.map((p) => ({ author: p.authorLogin })), s),
  },
  {
    id: "daily_task_contexts",
    finding: "Cognitive load",
    findingNum: 2,
    label: "Daily task contexts per dev",
    unit: "issues/dev/day",
    direction: "down-good",
    provenance: "proxy",
    description: "Avg distinct issues an author opens per active day. Proxy (issues ≠ Jira tasks).",
    compute: (s) => contextsPerActiveDay(s.issues.map((i) => ({ author: i.authorLogin ?? null })), s),
  },

  // FINDING 3 — THROUGHPUT
  {
    id: "task_throughput",
    finding: "Throughput",
    findingNum: 3,
    label: "Tasks completed per dev",
    unit: "issues/dev",
    direction: "up-good",
    provenance: "proxy",
    description: "Closed issues per active dev. Proxy for task throughput.",
    compute: (s) => ratio(s.issues.filter((i) => i.state === "closed").length, activeDevCount(s)),
  },
  {
    id: "pr_merge_rate",
    finding: "Throughput",
    findingNum: 3,
    label: "PR merge rate per dev",
    unit: "merged PRs/dev",
    direction: "up-good",
    provenance: "direct",
    description: "Merged PRs per active dev.",
    compute: (s) => ratio(mergedPRs(s).length, activeDevCount(s)),
  },
  {
    id: "tasks_with_pr",
    finding: "Throughput",
    findingNum: 3,
    label: "Merged PRs (with code)",
    unit: "merged PRs",
    direction: "up-good",
    provenance: "direct",
    description: "Count of merged PRs — code-bearing completed work.",
    compute: (s) => mergedPRs(s).length,
  },
  {
    id: "deployments_per_week",
    finding: "Throughput",
    findingNum: 3,
    label: "Deployments per week",
    unit: "deploys/wk",
    direction: "up-good",
    provenance: "direct",
    description: "Deployment events per week (requires the repo to use Deployments/Environments).",
    compute: (s) => (s.deployments.length === 0 ? null : ratio(s.deployments.length, spanWeeks(s))),
  },
  {
    id: "code_churn",
    finding: "Throughput",
    findingNum: 3,
    label: "Code churn (deletions ÷ additions)",
    unit: "ratio",
    direction: "down-good",
    provenance: "direct",
    description: "Lines deleted ÷ lines added across commits — the report's churn signal.",
    compute: (s) => ratio(sum(s.commits.map((c) => c.deletions)), sum(s.commits.map((c) => c.additions))),
  },

  // FINDING 4 — COMPLEXITY
  {
    id: "pr_size",
    finding: "Complexity",
    findingNum: 4,
    label: "Average PR size",
    unit: "lines",
    direction: "down-good",
    provenance: "direct",
    description: "Avg (additions + deletions) per PR.",
    compute: (s) => mean(s.prs.map((p) => p.additions + p.deletions)),
  },
  {
    id: "files_per_pr",
    finding: "Complexity",
    findingNum: 4,
    label: "Files edited per PR",
    unit: "files",
    direction: "down-good",
    provenance: "direct",
    description: "Avg changed files per PR.",
    compute: (s) => mean(s.prs.map((p) => p.changedFiles)),
  },
  {
    id: "files_per_dev_month",
    finding: "Complexity",
    findingNum: 4,
    label: "Files touched per dev / month",
    unit: "files",
    direction: "down-good",
    provenance: "proxy",
    description: "Sum of changed files in commits ÷ devs ÷ months. Proxy (counts edits, not distinct files).",
    compute: (s) => {
      const devs = activeDevCount(s);
      const months = spanMonths(s);
      if (devs === 0 || months === 0) return null;
      return sum(s.commits.map((c) => c.changedFiles)) / devs / months;
    },
  },
  {
    id: "repos_per_dev_month",
    finding: "Complexity",
    findingNum: 4,
    label: "Repos touched per dev / month",
    unit: "repos",
    direction: "neutral",
    provenance: "direct",
    description: "Avg distinct repos an author commits to per month.",
    compute: (s) => {
      const byAuthor = new Map<string, Set<string>>();
      for (const c of s.commits) {
        if (!c.authorLogin) continue;
        const set = byAuthor.get(c.authorLogin) ?? new Set<string>();
        set.add(c.repoId);
        byAuthor.set(c.authorLogin, set);
      }
      const months = spanMonths(s);
      const perAuthor = [...byAuthor.values()].map((set) => set.size / months);
      return mean(perAuthor);
    },
  },

  // FINDING 5 — PRE-MERGE QUALITY
  {
    id: "review_comments_per_pr",
    finding: "Pre-merge quality",
    findingNum: 5,
    label: "Review comments per PR",
    unit: "comments",
    direction: "neutral",
    provenance: "direct",
    description: "Avg review comments per PR.",
    compute: (s) => mean(s.prs.map((p) => p.reviewCommentCount)),
  },
  {
    id: "review_comment_length",
    finding: "Pre-merge quality",
    findingNum: 5,
    label: "Review comment length",
    unit: "chars",
    direction: "neutral",
    provenance: "direct",
    description: "Avg characters per review comment.",
    compute: (s) => {
      const chars = sum(s.prs.map((p) => p.reviewCommentChars));
      const count = sum(s.prs.map((p) => p.reviewCommentCount));
      return ratio(chars, count);
    },
  },
  {
    id: "merged_without_review",
    finding: "Pre-merge quality",
    findingNum: 5,
    label: "PRs merged without any review",
    unit: "%",
    direction: "down-good",
    provenance: "direct",
    description: "Share of merged PRs with zero reviewers — the report's most urgent pre-merge signal.",
    compute: (s) => {
      const merged = mergedPRs(s);
      return percent(merged.filter((p) => p.reviewerCount === 0).length, merged.length);
    },
  },

  // FINDING 6 — FLOW & EFFICIENCY
  {
    id: "time_to_first_review",
    finding: "Flow & efficiency",
    findingNum: 6,
    label: "Median time to first review",
    unit: "hours",
    direction: "down-good",
    provenance: "direct",
    description: "Median hours from PR open to first review.",
    compute: (s) =>
      median(
        reviewedPRs(s).map((p) => toHours(p.firstReviewAt!.getTime() - p.createdAt.getTime())),
      ),
  },
  {
    id: "time_in_review_avg",
    finding: "Flow & efficiency",
    findingNum: 6,
    label: "Average time in review",
    unit: "hours",
    direction: "down-good",
    provenance: "direct",
    description: "Mean hours from first review to merge/close.",
    compute: (s) =>
      mean(
        reviewedPRs(s)
          .map((p) => {
            const end = p.mergedAt ?? p.closedAt;
            return end ? toHours(end.getTime() - p.firstReviewAt!.getTime()) : null;
          })
          .filter((x): x is number => x !== null && x >= 0),
      ),
  },
  {
    id: "time_in_review_median",
    finding: "Flow & efficiency",
    findingNum: 6,
    label: "Median time in review",
    unit: "hours",
    direction: "down-good",
    provenance: "direct",
    description: "Median hours from first review to merge/close.",
    compute: (s) =>
      median(
        reviewedPRs(s)
          .map((p) => {
            const end = p.mergedAt ?? p.closedAt;
            return end ? toHours(end.getTime() - p.firstReviewAt!.getTime()) : null;
          })
          .filter((x): x is number => x !== null && x >= 0),
      ),
  },
  {
    id: "lead_time",
    finding: "Flow & efficiency",
    findingNum: 6,
    label: "Lead time (commit → deploy)",
    unit: "hours",
    direction: "down-good",
    provenance: "direct",
    description: "Median hours from commit to deployment (requires Deployments data).",
    compute: (s) => {
      const xs = s.deployments
        .map((d) => d.leadTimeMs)
        .filter((x): x is number => x !== null && x >= 0)
        .map(toHours);
      return median(xs);
    },
  },

  // FINDING 7 — PRODUCTION QUALITY
  {
    id: "incidents_per_pr",
    finding: "Production quality",
    findingNum: 7,
    label: "Incidents per merged PR",
    unit: "ratio",
    direction: "down-good",
    provenance: "proxy",
    description: "Incident-labeled issues ÷ merged PRs. Proxy for the incidents-to-PR ratio.",
    compute: (s) => ratio(s.issues.filter((i) => i.kind === "incident").length, mergedPRs(s).length),
  },
  {
    id: "monthly_incidents",
    finding: "Production quality",
    findingNum: 7,
    label: "Incidents per month",
    unit: "incidents/mo",
    direction: "down-good",
    provenance: "proxy",
    description: "Incident-labeled issues per month.",
    compute: (s) => ratio(s.issues.filter((i) => i.kind === "incident").length, spanMonths(s)),
  },
  {
    id: "bugs_per_dev",
    finding: "Production quality",
    findingNum: 7,
    label: "Bugs per dev",
    unit: "bugs/dev",
    direction: "down-good",
    provenance: "proxy",
    description: "Bug-labeled issues ÷ active devs.",
    compute: (s) => ratio(s.issues.filter((i) => i.kind === "bug").length, activeDevCount(s)),
  },
  {
    id: "bugs_per_pr",
    finding: "Production quality",
    findingNum: 7,
    label: "Bugs per merged PR",
    unit: "ratio",
    direction: "down-good",
    provenance: "proxy",
    description: "Bug-labeled issues ÷ merged PRs.",
    compute: (s) => ratio(s.issues.filter((i) => i.kind === "bug").length, mergedPRs(s).length),
  },
];

export const METRICS_BY_FINDING = METRICS.reduce<Record<number, MetricDef[]>>((acc, m) => {
  (acc[m.findingNum] ??= []).push(m);
  return acc;
}, {});

export const FINDING_TITLES: Record<number, string> = {
  1: "Adoption",
  2: "Cognitive load",
  3: "Throughput",
  4: "Code complexity",
  5: "Pre-merge code quality",
  6: "Flow & efficiency",
  7: "Production code quality",
};

// Report metrics we cannot derive from VCS data — surfaced as labeled gaps.
export const UNAVAILABLE_METRICS: { finding: string; label: string; needs: string }[] = [
  { finding: "Adoption", label: "% of PRs reviewed by AI agents", needs: "AI review-bot attribution" },
  { finding: "Cognitive load", label: "Work restarts per dev", needs: "Jira/board state transitions" },
  { finding: "Cognitive load", label: "In-progress tasks stalled 7+ days", needs: "Jira/board status" },
  { finding: "Throughput", label: "Epics completed per dev", needs: "Jira epics" },
  { finding: "Flow & efficiency", label: "Time in progress / waiting / QA", needs: "Jira/board workflow times" },
  { finding: "Production quality", label: "% of reopened tickets", needs: "Issue reopen events / Jira" },
];
