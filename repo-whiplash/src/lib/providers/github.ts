import { detectAi } from "@/lib/ai-detection";
import { getJson, parseNextLink, mapLimit } from "./http";
import {
  classifyIssue,
  type FetchOptions,
  type NormalizedCommit,
  type NormalizedDeployment,
  type NormalizedIssue,
  type NormalizedPR,
  type ProviderClient,
  type RepoData,
  type RepoSummary,
} from "./types";

const API = "https://api.github.com";
const PR_DETAIL_CONCURRENCY = 6;
const COMMIT_DETAIL_CAP = 800; // cap per-commit stat lookups to bound cost

export class GitHubClient implements ProviderClient {
  private headers: Record<string, string>;

  constructor(token: string) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "repo-whiplash",
    };
  }

  private async paginate<T>(startUrl: string, maxPages: number): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = startUrl;
    let pages = 0;
    while (url && pages < maxPages) {
      const { data, res } = await getJson<T[]>(url, this.headers);
      out.push(...data);
      url = parseNextLink(res.headers.get("link"));
      pages++;
    }
    return out;
  }

  async listRepos(): Promise<RepoSummary[]> {
    const repos = await this.paginate<any>(
      `${API}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member`,
      10,
    );
    return repos.map((r) => ({
      provider: "github" as const,
      externalId: String(r.id),
      fullName: r.full_name,
      defaultBranch: r.default_branch ?? null,
      private: !!r.private,
      pushedAt: r.pushed_at ?? null,
    }));
  }

  async fetchRepoData(fullName: string, opts: FetchOptions): Promise<RepoData> {
    const maxPages = opts.maxPages ?? 10;
    const since = opts.since;
    const [pullRequests, commits, issues, deployments] = await Promise.all([
      this.fetchPRs(fullName, since, maxPages),
      this.fetchCommits(fullName, since, maxPages),
      this.fetchIssues(fullName, since, maxPages),
      this.fetchDeployments(fullName, maxPages),
    ]);
    // Resolve deployment lead time from cached commit times where possible.
    const commitTime = new Map(commits.map((c) => [c.sha, c.authoredAt]));
    for (const d of deployments) {
      if (d.sha && commitTime.has(d.sha)) {
        d.leadTimeMs = new Date(d.createdAt).getTime() - new Date(commitTime.get(d.sha)!).getTime();
      }
    }
    return { pullRequests, commits, issues, deployments };
  }

  private async fetchPRs(fullName: string, since: string, maxPages: number): Promise<NormalizedPR[]> {
    const list = await this.paginate<any>(
      `${API}/repos/${fullName}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
      maxPages,
    );
    const inWindow = list.filter((pr) => (pr.created_at ?? pr.updated_at) >= since);

    return mapLimit(inWindow, PR_DETAIL_CONCURRENCY, async (pr) => {
      const detail = await getJson<any>(`${API}/repos/${fullName}/pulls/${pr.number}`, this.headers)
        .then((r) => r.data)
        .catch(() => pr);
      const reviews = await this.paginate<any>(
        `${API}/repos/${fullName}/pulls/${pr.number}/reviews?per_page=100`,
        2,
      ).catch(() => []);
      const reviewComments = await this.paginate<any>(
        `${API}/repos/${fullName}/pulls/${pr.number}/comments?per_page=100`,
        2,
      ).catch(() => []);

      const reviewers = new Set<string>();
      let firstReviewAt: string | null = null;
      for (const rv of reviews) {
        if (rv.user?.login) reviewers.add(rv.user.login);
        const t = rv.submitted_at;
        if (t && (!firstReviewAt || t < firstReviewAt)) firstReviewAt = t;
      }
      const reviewCommentChars =
        reviews.reduce((n: number, r: any) => n + (r.body?.length ?? 0), 0) +
        reviewComments.reduce((n: number, c: any) => n + (c.body?.length ?? 0), 0);
      const reviewCommentCount = reviews.filter((r: any) => r.body).length + reviewComments.length;

      const state: NormalizedPR["state"] = pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open";
      const ai = detectAi({
        message: `${pr.title ?? ""}\n${detail.body ?? pr.body ?? ""}`,
        authorName: pr.user?.login,
      });
      const mergedWithoutReview = state === "merged" && reviewers.size === 0;

      return {
        number: pr.number,
        authorLogin: pr.user?.login ?? null,
        state,
        createdAt: pr.created_at,
        mergedAt: pr.merged_at ?? null,
        closedAt: pr.closed_at ?? null,
        firstReviewAt,
        additions: detail.additions ?? 0,
        deletions: detail.deletions ?? 0,
        changedFiles: detail.changed_files ?? 0,
        reviewCommentCount,
        reviewCommentChars,
        reviewerCount: reviewers.size,
        mergedWithoutReview,
        aiAssisted: ai.isAi,
        aiTool: ai.tool,
      } satisfies NormalizedPR;
    });
  }

  private async fetchCommits(fullName: string, since: string, maxPages: number): Promise<NormalizedCommit[]> {
    const list = await this.paginate<any>(
      `${API}/repos/${fullName}/commits?since=${encodeURIComponent(since)}&per_page=100`,
      maxPages,
    ).catch(() => []);

    const capped = list.slice(0, COMMIT_DETAIL_CAP);
    return mapLimit(capped, PR_DETAIL_CONCURRENCY, async (c) => {
      const message = c.commit?.message ?? "";
      const authorName = c.commit?.author?.name ?? null;
      const authorEmail = c.commit?.author?.email ?? null;
      const ai = detectAi({ message, authorName, authorEmail });
      // Per-commit stats require the detail endpoint.
      const detail = await getJson<any>(`${API}/repos/${fullName}/commits/${c.sha}`, this.headers)
        .then((r) => r.data)
        .catch(() => null);
      return {
        sha: c.sha,
        authorLogin: c.author?.login ?? authorName,
        authoredAt: c.commit?.author?.date ?? c.commit?.committer?.date,
        additions: detail?.stats?.additions ?? 0,
        deletions: detail?.stats?.deletions ?? 0,
        changedFiles: detail?.files?.length ?? 0,
        aiAssisted: ai.isAi,
        aiTool: ai.tool,
      } satisfies NormalizedCommit;
    });
  }

  private async fetchIssues(fullName: string, since: string, maxPages: number): Promise<NormalizedIssue[]> {
    const list = await this.paginate<any>(
      `${API}/repos/${fullName}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100`,
      maxPages,
    ).catch(() => []);
    return list
      .filter((it) => !it.pull_request) // exclude PRs (the issues API returns both)
      .map((it) => {
        const labels = (it.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name));
        return {
          number: it.number,
          kind: classifyIssue(labels),
          state: it.state === "closed" ? "closed" : "open",
          createdAt: it.created_at,
          closedAt: it.closed_at ?? null,
          reopened: false, // requires timeline events; left for a deeper sync
          labels,
          authorLogin: it.user?.login ?? null,
        } satisfies NormalizedIssue;
      });
  }

  private async fetchDeployments(fullName: string, maxPages: number): Promise<NormalizedDeployment[]> {
    const list = await this.paginate<any>(
      `${API}/repos/${fullName}/deployments?per_page=100`,
      maxPages,
    ).catch(() => []);
    return list.map((d) => ({
      externalId: String(d.id),
      environment: d.environment ?? null,
      sha: d.sha ?? null,
      createdAt: d.created_at,
      leadTimeMs: null,
    }));
  }
}
