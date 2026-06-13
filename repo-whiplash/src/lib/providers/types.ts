// Normalized shapes that both GitHub and GitLab clients produce, so the
// analysis engine never has to know which provider data came from.

export type Provider = "github" | "gitlab";

export interface RepoSummary {
  provider: Provider;
  externalId: string;
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  pushedAt: string | null;
}

export interface NormalizedPR {
  number: number;
  authorLogin: string | null;
  state: "open" | "merged" | "closed";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  firstReviewAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewCommentCount: number;
  reviewCommentChars: number;
  reviewerCount: number;
  mergedWithoutReview: boolean;
  aiAssisted: boolean;
  aiTool?: string;
}

export interface NormalizedCommit {
  sha: string;
  authorLogin: string | null;
  authoredAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  aiAssisted: boolean;
  aiTool?: string;
}

export interface NormalizedIssue {
  number: number;
  kind: "bug" | "incident" | "other";
  state: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
  reopened: boolean;
  labels: string[];
  authorLogin: string | null;
}

export interface NormalizedDeployment {
  externalId: string;
  environment: string | null;
  sha: string | null;
  createdAt: string;
  leadTimeMs: number | null;
}

export interface RepoData {
  pullRequests: NormalizedPR[];
  commits: NormalizedCommit[];
  issues: NormalizedIssue[];
  deployments: NormalizedDeployment[];
}

export interface FetchOptions {
  // Only fetch entities updated/created on or after this ISO date (bounds cost).
  since: string;
  // Hard cap on pages per resource, to stay rate-limit friendly.
  maxPages?: number;
}

export interface ProviderClient {
  listRepos(): Promise<RepoSummary[]>;
  fetchRepoData(fullName: string, opts: FetchOptions): Promise<RepoData>;
}

// Classify an issue's "kind" from its labels (proxy for bug/incident feeds).
export function classifyIssue(labels: string[]): "bug" | "incident" | "other" {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.some((l) => /incident|outage|sev[-\s]?\d|pager|sre/.test(l))) return "incident";
  if (lower.some((l) => /\bbug\b|defect|regression|broken|crash/.test(l))) return "bug";
  return "other";
}
