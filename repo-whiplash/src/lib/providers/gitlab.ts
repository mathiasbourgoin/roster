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

const MR_DETAIL_CONCURRENCY = 6;

// Count added/removed lines in a unified diff, ignoring file headers.
function countDiff(diff: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) add++;
    else if (line.startsWith("-")) del++;
  }
  return { add, del };
}

export class GitLabClient implements ProviderClient {
  private headers: Record<string, string>;
  private base: string;

  constructor(token: string, baseUrl = process.env.GITLAB_BASE_URL ?? "https://gitlab.com") {
    this.base = `${baseUrl.replace(/\/$/, "")}/api/v4`;
    this.headers = { Authorization: `Bearer ${token}`, "User-Agent": "repo-whiplash" };
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

  private pid(fullName: string): string {
    return encodeURIComponent(fullName);
  }

  async listRepos(): Promise<RepoSummary[]> {
    const projects = await this.paginate<any>(
      `${this.base}/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true`,
      10,
    );
    return projects.map((p) => ({
      provider: "gitlab" as const,
      externalId: String(p.id),
      fullName: p.path_with_namespace,
      defaultBranch: p.default_branch ?? null,
      private: p.visibility !== "public",
      pushedAt: p.last_activity_at ?? null,
    }));
  }

  async fetchRepoData(fullName: string, opts: FetchOptions): Promise<RepoData> {
    const maxPages = opts.maxPages ?? 10;
    const [pullRequests, commits, issues, deployments] = await Promise.all([
      this.fetchMRs(fullName, opts.since, maxPages),
      this.fetchCommits(fullName, opts.since, maxPages),
      this.fetchIssues(fullName, opts.since, maxPages),
      this.fetchDeployments(fullName, maxPages),
    ]);
    const commitTime = new Map(commits.map((c) => [c.sha, c.authoredAt]));
    for (const d of deployments) {
      if (d.sha && commitTime.has(d.sha)) {
        d.leadTimeMs = new Date(d.createdAt).getTime() - new Date(commitTime.get(d.sha)!).getTime();
      }
    }
    return { pullRequests, commits, issues, deployments };
  }

  private async fetchMRs(fullName: string, since: string, maxPages: number): Promise<NormalizedPR[]> {
    const pid = this.pid(fullName);
    const list = await this.paginate<any>(
      `${this.base}/projects/${pid}/merge_requests?state=all&per_page=100&order_by=updated_at&created_after=${encodeURIComponent(since)}`,
      maxPages,
    ).catch(() => []);

    return mapLimit(list, MR_DETAIL_CONCURRENCY, async (mr) => {
      const changes = await getJson<any>(
        `${this.base}/projects/${pid}/merge_requests/${mr.iid}/changes`,
        this.headers,
      )
        .then((r) => r.data)
        .catch(() => ({ changes: [] }));
      let additions = 0;
      let deletions = 0;
      for (const ch of changes.changes ?? []) {
        const c = countDiff(ch.diff ?? "");
        additions += c.add;
        deletions += c.del;
      }
      const notes = await this.paginate<any>(
        `${this.base}/projects/${pid}/merge_requests/${mr.iid}/notes?per_page=100&sort=asc`,
        2,
      ).catch(() => []);
      const humanNotes = notes.filter((n: any) => !n.system && n.author?.username !== mr.author?.username);
      const reviewers = new Set<string>(humanNotes.map((n: any) => n.author?.username).filter(Boolean));
      const firstReviewAt = humanNotes[0]?.created_at ?? null;
      const reviewCommentChars = humanNotes.reduce((s: number, n: any) => s + (n.body?.length ?? 0), 0);

      const state: NormalizedPR["state"] =
        mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : "open";
      const ai = detectAi({ message: `${mr.title ?? ""}\n${mr.description ?? ""}`, authorName: mr.author?.username });

      return {
        number: mr.iid,
        authorLogin: mr.author?.username ?? null,
        state,
        createdAt: mr.created_at,
        mergedAt: mr.merged_at ?? null,
        closedAt: mr.closed_at ?? null,
        firstReviewAt,
        additions,
        deletions,
        changedFiles: (changes.changes ?? []).length,
        reviewCommentCount: humanNotes.length,
        reviewCommentChars,
        reviewerCount: reviewers.size,
        mergedWithoutReview: state === "merged" && reviewers.size === 0,
        aiAssisted: ai.isAi,
        aiTool: ai.tool,
      } satisfies NormalizedPR;
    });
  }

  private async fetchCommits(fullName: string, since: string, maxPages: number): Promise<NormalizedCommit[]> {
    const list = await this.paginate<any>(
      `${this.base}/projects/${this.pid(fullName)}/repository/commits?since=${encodeURIComponent(since)}&per_page=100&with_stats=true`,
      maxPages,
    ).catch(() => []);
    return list.map((c) => {
      const ai = detectAi({ message: c.message ?? c.title, authorName: c.author_name, authorEmail: c.author_email });
      return {
        sha: c.id,
        authorLogin: c.author_name ?? null,
        authoredAt: c.authored_date ?? c.created_at,
        additions: c.stats?.additions ?? 0,
        deletions: c.stats?.deletions ?? 0,
        changedFiles: 0, // not in list payload; left 0 to avoid N detail calls
        aiAssisted: ai.isAi,
        aiTool: ai.tool,
      } satisfies NormalizedCommit;
    });
  }

  private async fetchIssues(fullName: string, since: string, maxPages: number): Promise<NormalizedIssue[]> {
    const list = await this.paginate<any>(
      `${this.base}/projects/${this.pid(fullName)}/issues?scope=all&per_page=100&updated_after=${encodeURIComponent(since)}`,
      maxPages,
    ).catch(() => []);
    return list.map((it) => {
      const labels: string[] = it.labels ?? [];
      return {
        number: it.iid,
        kind: classifyIssue(labels),
        state: it.state === "closed" ? "closed" : "open",
        createdAt: it.created_at,
        closedAt: it.closed_at ?? null,
        reopened: false,
        labels,
        authorLogin: it.author?.username ?? null,
      } satisfies NormalizedIssue;
    });
  }

  private async fetchDeployments(fullName: string, maxPages: number): Promise<NormalizedDeployment[]> {
    const list = await this.paginate<any>(
      `${this.base}/projects/${this.pid(fullName)}/deployments?per_page=100&order_by=created_at&sort=desc`,
      maxPages,
    ).catch(() => []);
    return list.map((d) => ({
      externalId: String(d.id),
      environment: d.environment?.name ?? null,
      sha: d.sha ?? d.deployable?.commit?.id ?? null,
      createdAt: d.created_at,
      leadTimeMs: null,
    }));
  }
}
