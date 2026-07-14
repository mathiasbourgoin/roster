import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IndexEntry, SourceCache } from "./types.js";

function sourceCacheFile(cacheDir: string, sourceId: string): string {
  const key = sourceId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return path.join(cacheDir, `${key}.json`);
}

export async function readSourceCacheRecord(cacheDir: string, sourceId: string): Promise<SourceCache | null> {
  const filePath = sourceCacheFile(cacheDir, sourceId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as SourceCache;
    if (!Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSourceCache(
  cacheDir: string,
  sourceId: string,
  sourceRepo: string,
  sourceFingerprint: string | undefined,
  sourceEntries: IndexEntry[],
): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const payload: SourceCache = {
    source_id: sourceId,
    source_repo: sourceRepo,
    built_at: new Date().toISOString(),
    source_fingerprint: sourceFingerprint,
    entries: sourceEntries,
  };
  await fs.writeFile(sourceCacheFile(cacheDir, sourceId), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function fingerprintParts(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

export function fingerprintCandidates(sourceId: string, branch: string, candidates: string[]): string {
  return fingerprintParts([sourceId, branch, ...candidates]);
}

export function chooseBestSourceEntries(cached: SourceCache | null, refreshed: IndexEntry[]): IndexEntry[] {
  if (!cached || cached.entries.length === 0) {
    return refreshed;
  }
  if (refreshed.length === 0) {
    return cached.entries;
  }
  if (refreshed.length < Math.floor(cached.entries.length * 0.95)) {
    return cached.entries;
  }
  return refreshed;
}
