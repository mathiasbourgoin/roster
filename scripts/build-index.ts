import { promises as fs } from "node:fs";
import path from "node:path";

export type { ComponentType, IndexEntry, SourceCache } from "./lib/types.js";
export { parseFrontmatter, parseLooseMetadata } from "./lib/frontmatter.js";
export { inferComponentType, inferComplexity } from "./lib/infer.js";
export { normalizeEntry, enrichRemoteEntry, fallbackRemoteEntry } from "./lib/normalize.js";
export { chooseBestSourceEntries } from "./lib/cache.js";
export { sortEntries } from "./lib/remote.js";

import type { IndexEntry, RemoteSource, SourceCache } from "./lib/types.js";
import { parseFrontmatter, parseLooseMetadata } from "./lib/frontmatter.js";
import { normalizeEntry, enrichRemoteEntry, fallbackRemoteEntry } from "./lib/normalize.js";
import {
  collectRemoteCandidates,
  collectCatalogEntries,
  sortEntries,
  toRawUrl,
  fetchText,
} from "./lib/remote.js";
import {
  readSourceCacheRecord,
  writeSourceCache,
  fingerprintParts,
  fingerprintCandidates,
  chooseBestSourceEntries,
} from "./lib/cache.js";

type SourceConfig = {
  local: {
    enabled: boolean;
    repo: string;
  };
  remotes: RemoteSource[];
};

type BuildStats = {
  local_count: number;
  remote_count: number;
  failed_sources: string[];
};

type CliArgs = {
  output: string;
  sources: string;
  quiet: boolean;
  cacheDir: string;
  refreshRemotes: boolean;
};

const DEFAULT_OUTPUT = "index.json";
const DEFAULT_SOURCES = "index-sources.json";
const DEFAULT_CACHE_DIR = ".cache/indexer";

function parseArgs(argv: string[]): CliArgs {
  let output = DEFAULT_OUTPUT;
  let sources = DEFAULT_SOURCES;
  let quiet = false;
  let cacheDir = DEFAULT_CACHE_DIR;
  let refreshRemotes = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output" && argv[i + 1]) {
      output = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--sources" && argv[i + 1]) {
      sources = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--quiet") {
      quiet = true;
      continue;
    }
    if (arg === "--cache-dir" && argv[i + 1]) {
      cacheDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--refresh-remotes") {
      refreshRemotes = true;
      continue;
    }
  }

  return { output, sources, quiet, cacheDir, refreshRemotes };
}

export async function collectLocalMarkdownFiles(repoRoot: string): Promise<string[]> {
  const roots = ["agents", "skills", "rules", "hooks", "kb", "recruiter", "governor"];
  const files: string[] = [];

  async function walk(absPath: string, relRoot: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absChild = path.join(absPath, entry.name);
      const relChild = path.join(relRoot, entry.name);
      if (entry.isDirectory()) {
        await walk(absChild, relChild);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(relChild.replace(/\\/g, "/"));
      }
    }
  }

  for (const root of roots) {
    await walk(path.join(repoRoot, root), root);
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      out[current] = await mapper(items[current], current);
    }
  }

  const concurrency = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: concurrency }, async () => worker());
  await Promise.all(workers);
  return out;
}

function appendRemoteEntries(allEntries: IndexEntry[], stats: BuildStats, sourceEntries: IndexEntry[]): void {
  for (const item of sourceEntries) {
    allEntries.push(item);
    stats.remote_count += 1;
  }
}

export async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const outputPath = path.resolve(repoRoot, args.output);
  const sourcePath = path.resolve(repoRoot, args.sources);
  const cacheDir = path.resolve(repoRoot, args.cacheDir);

  const sourceConfigRaw = await fs.readFile(sourcePath, "utf8");
  const sourceConfig = JSON.parse(sourceConfigRaw) as SourceConfig;

  const entries: IndexEntry[] = [];
  const stats: BuildStats = {
    local_count: 0,
    remote_count: 0,
    failed_sources: [],
  };

  if (sourceConfig.local?.enabled) {
    const localFiles = await collectLocalMarkdownFiles(repoRoot);
    for (const localFile of localFiles) {
      const absolute = path.join(repoRoot, localFile);
      const content = await fs.readFile(absolute, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm) {
        continue;
      }
      const entry = normalizeEntry(fm, localFile, "local", "local", sourceConfig.local.repo);
      if (!entry) {
        continue;
      }
      entries.push(entry);
      stats.local_count += 1;
    }
  }

  for (const remote of sourceConfig.remotes ?? []) {
    const branch = remote.branch ?? "main";
    const cached = await readSourceCacheRecord(cacheDir, remote.id);
    if (!args.refreshRemotes && cached && cached.entries.length > 0) {
      appendRemoteEntries(entries, stats, cached.entries);
      continue;
    }
    try {
      const candidates = await collectRemoteCandidates(remote);
      const sourceEntries: IndexEntry[] = [];
      if (candidates.length === 0) {
        const catalogEntries = await collectCatalogEntries(remote);
        const catalogFingerprint = fingerprintParts([remote.id, branch, ...catalogEntries.map((entry) => entry.path).sort()]);
        if (cached && cached.entries.length > 0 && cached.source_fingerprint === catalogFingerprint) {
          appendRemoteEntries(entries, stats, cached.entries);
          continue;
        }
        for (const item of catalogEntries) {
          sourceEntries.push(item);
        }
        const sortedSourceEntries = sortEntries(sourceEntries);
        const chosenEntries = chooseBestSourceEntries(cached, sortedSourceEntries);
        appendRemoteEntries(entries, stats, chosenEntries);
        await writeSourceCache(cacheDir, remote.id, remote.repo, catalogFingerprint, chosenEntries);
        continue;
      }
      const sourceFingerprint = fingerprintCandidates(remote.id, branch, candidates);
      if (cached && cached.entries.length > 0 && cached.source_fingerprint === sourceFingerprint) {
        appendRemoteEntries(entries, stats, cached.entries);
        continue;
      }
      const parsedEntries = await mapLimit(candidates, 16, async (filePath) => {
        const url = toRawUrl(remote.repo, branch, filePath);
        const content = await fetchText(url);
        const fm = parseFrontmatter(content) ?? parseLooseMetadata(content);
        if (fm) {
          const entry = normalizeEntry(fm, filePath, "remote", remote.id, remote.repo);
          if (entry) {
            return enrichRemoteEntry(entry, content);
          }
        }
        return fallbackRemoteEntry(content, filePath, remote.id, remote.repo);
      });
      for (const item of parsedEntries) {
        sourceEntries.push(item);
      }
      const sortedSourceEntries = sortEntries(sourceEntries);
      const chosenEntries = chooseBestSourceEntries(cached, sortedSourceEntries);
      appendRemoteEntries(entries, stats, chosenEntries);
      await writeSourceCache(cacheDir, remote.id, remote.repo, sourceFingerprint, chosenEntries);
    } catch (error) {
      if (cached && cached.entries.length > 0) {
        appendRemoteEntries(entries, stats, cached.entries);
        if (!args.quiet) {
          console.error(
            `warning: source ${remote.id} failed live fetch, used cache (${cached.entries.length} entries): ${(error as Error).message}`,
          );
        }
      } else {
        stats.failed_sources.push(remote.id);
        if (!args.quiet) {
          console.error(`warning: failed source ${remote.id}: ${(error as Error).message}`);
        }
      }
    }
  }

  if (entries.length === 0) {
    throw new Error("no index entries produced");
  }

  const sorted = sortEntries(entries);
  await fs.writeFile(outputPath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");

  if (!args.quiet) {
    console.error(
      `index written: ${path.relative(repoRoot, outputPath)} (${sorted.length} entries, local=${stats.local_count}, remote=${stats.remote_count})`,
    );
    if (stats.failed_sources.length > 0) {
      console.error(`warning: ${stats.failed_sources.length} source(s) failed: ${stats.failed_sources.join(", ")}`);
    }
  }
}

void run().catch((error: Error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
