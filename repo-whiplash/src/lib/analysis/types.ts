// Lightweight row shapes the analysis works on (subset of the Prisma models,
// with Date fields). Loaded once, sliced many times.

export interface PRRow {
  repoId: string;
  number: number;
  authorLogin: string | null;
  state: string;
  createdAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  firstReviewAt: Date | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewCommentCount: number;
  reviewCommentChars: number;
  reviewerCount: number;
  mergedWithoutReview: boolean;
  aiAssisted: boolean;
}

export interface CommitRow {
  repoId: string;
  sha: string;
  authorLogin: string | null;
  authoredAt: Date;
  additions: number;
  deletions: number;
  changedFiles: number;
  aiAssisted: boolean;
}

export interface IssueRow {
  repoId: string;
  number: number;
  kind: string;
  state: string;
  createdAt: Date;
  closedAt: Date | null;
  reopened: boolean;
  authorLogin: string | null;
}

export interface DeploymentRow {
  repoId: string;
  createdAt: Date;
  leadTimeMs: number | null;
}

export interface Slice {
  prs: PRRow[];
  commits: CommitRow[];
  issues: IssueRow[];
  deployments: DeploymentRow[];
}

export type Direction = "up-good" | "down-good" | "neutral";
export type Provenance = "direct" | "proxy" | "unavailable";

export interface MetricDef {
  id: string;
  finding: string;
  findingNum: number;
  label: string;
  unit: string;
  direction: Direction;
  provenance: Provenance;
  description: string;
  // Returns the metric value for a slice, or null when there is no data.
  compute: (s: Slice) => number | null;
}
