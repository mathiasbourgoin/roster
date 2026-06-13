import { db } from "@/lib/db";
import { getProviderToken, makeClient, type Provider } from "@/lib/providers";

export const DEFAULT_LOOKBACK_MONTHS = 24; // matches the report's ~2-year window

export function lookbackSince(months = DEFAULT_LOOKBACK_MONTHS): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

export interface SyncResult {
  repo: string;
  provider: Provider;
  prs: number;
  commits: number;
  issues: number;
  deployments: number;
}

// Fetch a single repo's window of data and replace its cache rows.
export async function syncRepo(
  userId: string,
  provider: Provider,
  fullName: string,
  opts: { months?: number; maxPages?: number } = {},
): Promise<SyncResult> {
  const token = await getProviderToken(userId, provider);
  if (!token) throw new Error(`No ${provider} token for user`);

  const client = makeClient(provider, token);
  const since = lookbackSince(opts.months);
  const data = await client.fetchRepoData(fullName, { since, maxPages: opts.maxPages });

  const repo = await db.repo.upsert({
    where: { userId_provider_fullName: { userId, provider, fullName } },
    create: { userId, provider, fullName, externalId: fullName, selected: true },
    update: {},
  });
  const repoId = repo.id;
  const key = `${provider}:${fullName}`;

  await db.$transaction([
    db.pullRequest.deleteMany({ where: { repoId } }),
    db.commit.deleteMany({ where: { repoId } }),
    db.issueRecord.deleteMany({ where: { repoId } }),
    db.deployment.deleteMany({ where: { repoId } }),
    db.pullRequest.createMany({
      data: data.pullRequests.map((pr) => ({
        id: `${key}#${pr.number}`,
        repoId,
        number: pr.number,
        authorLogin: pr.authorLogin,
        state: pr.state,
        createdAt: new Date(pr.createdAt),
        mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
        closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
        firstReviewAt: pr.firstReviewAt ? new Date(pr.firstReviewAt) : null,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        reviewCommentCount: pr.reviewCommentCount,
        reviewCommentChars: pr.reviewCommentChars,
        reviewerCount: pr.reviewerCount,
        mergedWithoutReview: pr.mergedWithoutReview,
        aiAssisted: pr.aiAssisted,
        aiTool: pr.aiTool ?? null,
      })),
    }),
    db.commit.createMany({
      data: data.commits.map((c) => ({
        id: `${key}@${c.sha}`,
        repoId,
        sha: c.sha,
        authorLogin: c.authorLogin,
        authoredAt: new Date(c.authoredAt),
        additions: c.additions,
        deletions: c.deletions,
        changedFiles: c.changedFiles,
        aiAssisted: c.aiAssisted,
        aiTool: c.aiTool ?? null,
      })),
    }),
    db.issueRecord.createMany({
      data: data.issues.map((it) => ({
        id: `${key}!${it.number}`,
        repoId,
        number: it.number,
        kind: it.kind,
        state: it.state,
        createdAt: new Date(it.createdAt),
        closedAt: it.closedAt ? new Date(it.closedAt) : null,
        reopened: it.reopened,
        labelsJson: JSON.stringify(it.labels),
        authorLogin: it.authorLogin,
      })),
    }),
    db.deployment.createMany({
      data: data.deployments.map((d) => ({
        id: `${key}:deploy:${d.externalId}`,
        repoId,
        externalId: d.externalId,
        environment: d.environment,
        sha: d.sha,
        createdAt: new Date(d.createdAt),
        leadTimeMs: d.leadTimeMs,
      })),
    }),
    db.repo.update({ where: { id: repoId }, data: { lastSyncedAt: new Date() } }),
  ]);

  return {
    repo: fullName,
    provider,
    prs: data.pullRequests.length,
    commits: data.commits.length,
    issues: data.issues.length,
    deployments: data.deployments.length,
  };
}
