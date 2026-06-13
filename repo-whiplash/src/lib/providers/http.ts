// Small fetch helpers: JSON with auth, Link-header pagination, bounded
// concurrency, and basic rate-limit backoff. Shared by both provider clients.

export interface PagedResult<T> {
  items: T[];
  nextUrl: string | null;
}

export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
): Promise<{ data: T; res: Response }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 403 || res.status === 429) {
      // Rate limited — honor Retry-After / reset, then retry.
      const retryAfter = Number(res.headers.get("retry-after"));
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      let waitMs = 0;
      if (!Number.isNaN(retryAfter) && retryAfter > 0) waitMs = retryAfter * 1000;
      else if (!Number.isNaN(reset) && reset > 0) waitMs = Math.max(0, reset * 1000 - Date.now());
      if (waitMs > 0 && waitMs < 60_000) {
        await sleep(waitMs + 500);
        continue;
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as T;
    return { data, res };
  }
  throw new Error(`Exhausted retries for ${url}`);
}

// Follow GitHub-style `Link: <...>; rel="next"` pagination.
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const [urlPart, relPart] = part.split(";");
    if (relPart && /rel="next"/.test(relPart)) {
      const match = urlPart.match(/<([^>]+)>/);
      if (match) return match[1];
    }
  }
  return null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run `worker` over `items` with at most `limit` in flight.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
