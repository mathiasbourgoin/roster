import { db } from "@/lib/db";
import { GitHubClient } from "./github";
import { GitLabClient } from "./gitlab";
import type { Provider, ProviderClient } from "./types";

export * from "./types";

export function makeClient(provider: Provider, token: string): ProviderClient {
  return provider === "github" ? new GitHubClient(token) : new GitLabClient(token);
}

// Look up the stored OAuth access token for a user's linked provider account.
export async function getProviderToken(userId: string, provider: Provider): Promise<string | null> {
  const account = await db.account.findFirst({
    where: { userId, provider },
    select: { access_token: true },
  });
  return account?.access_token ?? null;
}

// Which providers has this user connected?
export async function connectedProviders(userId: string): Promise<Provider[]> {
  const accounts = await db.account.findMany({ where: { userId }, select: { provider: true } });
  return accounts
    .map((a) => a.provider)
    .filter((p): p is Provider => p === "github" || p === "gitlab");
}
