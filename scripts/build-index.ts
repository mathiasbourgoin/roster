import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type ComponentType = "agent" | "skill" | "rule" | "hook" | "kb" | "other";

export type IndexEntry = {
  name: string;
  display_name: string;
  description: string;
  domain: string[];
  tags: string[];
  model: string;
  complexity: string;
  compatible_with: string[];
  version: string;
  path: string;
  source: "local" | "remote";
  source_id: string;
  source_repo: string;
  component_type: ComponentType;
};

type SourceConfig = {
  local: {
    enabled: boolean;
    repo: string;
  };
  remotes: RemoteSource[];
};

type RemoteSource = {
  id: string;
  repo: string;
  branch?: string;
  seed_files: string[];
  include_patterns: string[];
  exclude_patterns?: string[];
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

function parseInlineArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return inner
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseScalar(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, "");
}

export function parseFrontmatter(content: string): Record<string, string | string[]> | null {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  const fm: Record<string, string | string[]> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") {
      return fm;
    }

    // Indented lines (block scalars, nested YAML keys, continuation lines) are intentionally
    // skipped. This parser only handles flat key: value pairs. Multi-line YAML values are
    // silently dropped — the preceding scalar key retains its inline value (or empty string).
    if (!line || line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }

    const sep = line.indexOf(":");
    if (sep <= 0) {
      continue;
    }

    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) {
      continue;
    }

    if (value.startsWith("[") && value.endsWith("]")) {
      fm[key] = parseInlineArray(value);
    } else {
      fm[key] = parseScalar(value);
    }
  }

  return null;
}

export function parseLooseMetadata(content: string): Record<string, string | string[]> | null {
  const lines = content.split(/\r?\n/).slice(0, 160);
  const meta: Record<string, string | string[]> = {};
  const keys = new Set([
    "name",
    "display_name",
    "description",
    "domain",
    "tags",
    "model",
    "complexity",
    "compatible_with",
    "version",
  ]);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("```")) {
      continue;
    }
    const sep = line.indexOf(":");
    if (sep <= 0) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    if (!keys.has(key)) {
      continue;
    }
    const value = line.slice(sep + 1).trim();
    if (!value) {
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = parseInlineArray(value);
    } else {
      meta[key] = parseScalar(value);
    }
  }

  if (typeof meta.name === "string" && meta.name) {
    return meta;
  }
  return null;
}

export function inferComponentType(filePath: string): ComponentType {
  const normalized = filePath.replace(/\\/g, "/");
  if (
    normalized.startsWith("agents/") ||
    normalized.startsWith("recruiter/") ||
    normalized.startsWith("governor/") ||
    normalized.includes("/agents/")
  ) {
    return "agent";
  }
  if (normalized.startsWith("skills/") || normalized.includes("/skills/") || normalized.endsWith("/SKILL.md")) {
    return "skill";
  }
  if (normalized.startsWith("rules/") || normalized.includes("/rules/")) {
    return "rule";
  }
  if (normalized.startsWith("hooks/") || normalized.includes("/hooks/")) {
    return "hook";
  }
  if (normalized.startsWith("kb/")) {
    return "kb";
  }
  return "other";
}

export function normalizeEntry(
  frontmatter: Record<string, string | string[]>,
  filePath: string,
  source: "local" | "remote",
  sourceId: string,
  sourceRepo: string,
): IndexEntry | null {
  const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
  if (!name) {
    return null;
  }

  const displayName =
    typeof frontmatter.display_name === "string" && frontmatter.display_name
      ? frontmatter.display_name
      : name;

  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  const model = typeof frontmatter.model === "string" ? frontmatter.model : "";
  const complexity = typeof frontmatter.complexity === "string" ? frontmatter.complexity : "";
  const version = typeof frontmatter.version === "string" && frontmatter.version ? frontmatter.version : "1.0.0";

  const domain = Array.isArray(frontmatter.domain) ? frontmatter.domain : [];
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
  const compatible = Array.isArray(frontmatter.compatible_with) ? frontmatter.compatible_with : [];

  return {
    name,
    display_name: displayName,
    description,
    domain,
    tags,
    model,
    complexity,
    compatible_with: compatible,
    version,
    path: filePath.replace(/\\/g, "/"),
    source,
    source_id: sourceId,
    source_repo: sourceRepo,
    component_type: inferComponentType(filePath),
  };
}

async function collectLocalMarkdownFiles(repoRoot: string): Promise<string[]> {
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

async function fetchText(url: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    "user-agent": "agent-roster-indexer",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    "user-agent": "agent-roster-indexer",
    accept: "application/vnd.github+json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

function toRawUrl(repo: string, branch: string, filePath: string): string {
  const normalized = filePath.replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${normalized}`;
}

function resolveCandidatePath(seedPath: string, rawLink: string, repo: string): string | null {
  const link = rawLink.trim();
  if (!link || link.startsWith("#") || link.startsWith("mailto:")) {
    return null;
  }

  if (link.startsWith("http://") || link.startsWith("https://")) {
    const rawPrefix = `https://raw.githubusercontent.com/${repo}/`;
    if (link.startsWith(rawPrefix)) {
      const parts = link.slice(rawPrefix.length).split("/");
      if (parts.length < 2) {
        return null;
      }
      return parts.slice(1).join("/");
    }

    const blobPrefix = `https://github.com/${repo}/blob/`;
    if (link.startsWith(blobPrefix)) {
      const parts = link.slice(blobPrefix.length).split("/");
      if (parts.length < 2) {
        return null;
      }
      return parts.slice(1).join("/");
    }

    return null;
  }

  const noQuery = link.split("#")[0]?.split("?")[0] ?? "";
  if (!noQuery) {
    return null;
  }

  if (noQuery.startsWith("/")) {
    return noQuery.slice(1);
  }

  const baseDir = path.posix.dirname(seedPath);
  return path.posix.normalize(path.posix.join(baseDir, noQuery));
}

function parseMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const target = match[1]?.trim();
    if (target) {
      links.push(target);
    }
  }
  return links;
}

type MarkdownLink = {
  label: string;
  url: string;
};

function parseMarkdownLinkPairs(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const label = (match[1] ?? "").trim();
    const url = (match[2] ?? "").trim();
    if (!label || !url) {
      continue;
    }
    links.push({ label, url });
  }
  return links;
}


function matchesPatterns(filePath: string, includePatterns: string[], excludePatterns: string[]): boolean {
  const included = includePatterns.length === 0 || includePatterns.some((pattern) => new RegExp(pattern).test(filePath));
  if (!included) {
    return false;
  }
  return !excludePatterns.some((pattern) => new RegExp(pattern).test(filePath));
}

async function collectRemoteCandidates(source: RemoteSource): Promise<string[]> {
  const branch = source.branch ?? "main";
  const include = source.include_patterns ?? [];
  const exclude = source.exclude_patterns ?? [];
  const candidates = new Set<string>();

  for (const seedFile of source.seed_files) {
    const seedUrl = toRawUrl(source.repo, branch, seedFile);
    const markdown = await fetchText(seedUrl);
    const links = parseMarkdownLinks(markdown);
    for (const link of links) {
      const resolved = resolveCandidatePath(seedFile, link, source.repo);
      if (!resolved || !resolved.endsWith(".md")) {
        continue;
      }
      if (matchesPatterns(resolved, include, exclude)) {
        candidates.add(resolved);
      }
    }
  }

  const treeUrl = `https://api.github.com/repos/${source.repo}/git/trees/${branch}?recursive=1`;
  try {
    type GitTreeResponse = {
      tree?: Array<{ path?: string; type?: string }>;
    };
    const tree = await fetchJson<GitTreeResponse>(treeUrl);
    for (const node of tree.tree ?? []) {
      const filePath = node.path ?? "";
      if (node.type !== "blob" || !filePath.endsWith(".md")) {
        continue;
      }
      if (matchesPatterns(filePath, include, exclude)) {
        candidates.add(filePath);
      }
    }
  } catch {
    // Seed-file link extraction remains a deterministic fallback if tree API is unavailable.
  }

  return Array.from(candidates).sort((a, b) => a.localeCompare(b));
}

function firstMarkdownHeading(content: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = /^#\s+(.+?)\s*$/.exec(line.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function firstDescriptionLine(content: string): string {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#") || line.startsWith("---") || line.startsWith("```")) {
      continue;
    }
    return line.slice(0, 240);
  }
  return "";
}

function deriveDomainFromPath(filePath: string): string[] {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const ignored = new Set([
    "agents",
    "skills",
    "rules",
    "hooks",
    "kb",
    "categories",
    "integrations",
    "claude-code",
    "AGENTS",
    "AGENCY-SOURCE",
  ]);

  for (const part of parts) {
    if (!ignored.has(part)) {
      return [part.toLowerCase()];
    }
  }
  return [];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferDomainBySource(sourceId: string, filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  if (sourceId === "VoltAgent/awesome-claude-code-subagents") {
    const category = parts[1] ?? "";
    const match = /^\d+-([a-z0-9_-]+)$/i.exec(category);
    if (match?.[1]) {
      return tokenize(match[1]);
    }
  }

  if (sourceId === "wshobson/agents") {
    const pluginIdx = parts.indexOf("plugins");
    if (pluginIdx >= 0 && parts[pluginIdx + 1]) {
      return tokenize(parts[pluginIdx + 1]);
    }
  }

  if (sourceId === "msitarzewski/agency-agents") {
    if (parts[0] === "integrations" && parts[1]) {
      return tokenize(parts[1]);
    }
    if (parts[0]) {
      return tokenize(parts[0]);
    }
  }

  if (sourceId === "mk-knight23/AGENTS-COLLECTION") {
    const sourceIdx = parts.indexOf("AGENCY-SOURCE");
    if (sourceIdx >= 0 && parts[sourceIdx + 1]) {
      return tokenize(parts[sourceIdx + 1]);
    }
  }

  return deriveDomainFromPath(filePath);
}

function inferCompatible(sourceId: string, filePath: string): string[] {
  const normalized = filePath.toLowerCase();
  if (normalized.includes("codex")) {
    return ["codex"];
  }
  if (normalized.includes("claude")) {
    return ["claude-code"];
  }
  if (sourceId === "VoltAgent/awesome-claude-code-subagents" || sourceId === "wshobson/agents") {
    return ["claude-code"];
  }
  return [];
}

function inferCompatibleFromText(sourceId: string, text: string): string[] {
  const blob = `${sourceId} ${text}`.toLowerCase();
  const out: string[] = [];
  if (blob.includes("claude")) {
    out.push("claude-code");
  }
  if (blob.includes("codex") || blob.includes("openai")) {
    out.push("codex");
  }
  if (sourceId.includes("awesome-agent-skills")) {
    out.push("claude-code", "codex");
  } else if (sourceId.includes("agency-agents") || sourceId.includes("AGENTS-COLLECTION")) {
    out.push("claude-code");
  }
  return unique(out);
}

function inferCatalogCompatible(sourceId: string, text: string): string[] {
  return inferCompatibleFromText(sourceId, text);
}

export function inferComplexity(content: string): string {
  const lines = content.split(/\r?\n/).length;
  if (lines < 120) {
    return "low";
  }
  if (lines < 280) {
    return "medium";
  }
  return "high";
}

export function enrichRemoteEntry(entry: IndexEntry, content: string): IndexEntry {
  const inferredDomain = inferDomainBySource(entry.source_id, entry.path);
  const fileNameTokens = tokenize(path.basename(entry.path, ".md"));
  const pathTokens = tokenize(path.dirname(entry.path));
  const tags = unique([...entry.tags, ...inferredDomain, ...fileNameTokens, ...pathTokens, entry.component_type]);

  const inferredCompatible = inferCompatibleFromText(entry.source_id, `${entry.path}\n${content.slice(0, 4000)}`);

  return {
    ...entry,
    display_name: entry.display_name || firstMarkdownHeading(content) || entry.name,
    description: entry.description || firstDescriptionLine(content),
    domain: entry.domain.length > 0 ? entry.domain : inferredDomain,
    tags,
    model: entry.model || "unspecified",
    complexity: entry.complexity || inferComplexity(content),
    compatible_with:
      entry.compatible_with.length > 0
        ? entry.compatible_with
        : (inferredCompatible.length > 0 ? inferredCompatible : inferCompatible(entry.source_id, entry.path)),
  };
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function inferCatalogComponentType(sourceId: string): ComponentType {
  if (sourceId.includes("skills")) {
    return "skill";
  }
  if (sourceId.includes("agents") || sourceId.includes("subagents")) {
    return "agent";
  }
  return "other";
}

async function collectCatalogEntries(source: RemoteSource): Promise<IndexEntry[]> {
  const branch = source.branch ?? "main";
  const entries: IndexEntry[] = [];
  const seen = new Set<string>();

  for (const seedFile of source.seed_files) {
    const seedUrl = toRawUrl(source.repo, branch, seedFile);
    const markdown = await fetchText(seedUrl);
    const links = parseMarkdownLinkPairs(markdown);
    for (const link of links) {
      const url = link.url.split("#")[0]?.split("?")[0] ?? "";
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/i.test(url)) {
        continue;
      }
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);

      const fallbackLabel = url.split("/").pop() ?? "catalog-item";
      const name = sanitizeName(link.label || fallbackLabel);
      const compatible = inferCatalogCompatible(source.id, `${link.label} ${url}`);
      const domain = tokenize(source.id.split("/").pop() ?? "");
      const tags = unique([...tokenize(link.label), ...tokenize(url), "catalog", "external"]);

      entries.push({
        name: name || "catalog-item",
        display_name: link.label || name || "catalog-item",
        description: `Catalog reference from ${source.id}`,
        domain: domain.length > 0 ? domain : ["catalog"],
        tags,
        model: "unspecified",
        complexity: "low",
        compatible_with: compatible.length > 0 ? compatible : ["claude-code", "codex"],
        version: "1.0.0-catalog",
        path: url,
        source: "remote",
        source_id: source.id,
        source_repo: source.repo,
        component_type: inferCatalogComponentType(source.id),
      });
    }
  }

  return sortEntries(entries);
}


function fallbackRemoteEntry(
  content: string,
  filePath: string,
  sourceId: string,
  sourceRepo: string,
): IndexEntry {
  const baseName = path.basename(filePath, ".md").toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const heading = firstMarkdownHeading(content);
  const description = firstDescriptionLine(content);
  const compatible = /claude/i.test(filePath) ? ["claude-code"] : inferCompatible(sourceId, filePath);

  return {
    name: baseName || "unknown",
    display_name: heading || baseName || "unknown",
    description,
    domain: inferDomainBySource(sourceId, filePath),
    tags: unique([...tokenize(baseName), ...tokenize(path.dirname(filePath))]),
    model: "unspecified",
    complexity: inferComplexity(content),
    compatible_with: compatible,
    version: "1.0.0-external",
    path: filePath.replace(/\\/g, "/"),
    source: "remote",
    source_id: sourceId,
    source_repo: sourceRepo,
    component_type: inferComponentType(filePath),
  };
}

function sortEntries(entries: IndexEntry[]): IndexEntry[] {
  return entries.sort((a, b) => {
    const bySource = `${a.source_id}/${a.component_type}`.localeCompare(`${b.source_id}/${b.component_type}`);
    if (bySource !== 0) {
      return bySource;
    }
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }
    return a.path.localeCompare(b.path);
  });
}

async function mapLimit<T, R>(
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

export type SourceCache = {
  source_id: string;
  source_repo: string;
  built_at: string;
  source_fingerprint?: string;
  entries: IndexEntry[];
};

function sourceCacheFile(cacheDir: string, sourceId: string): string {
  const key = sourceId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return path.join(cacheDir, `${key}.json`);
}

async function readSourceCacheRecord(cacheDir: string, sourceId: string): Promise<SourceCache | null> {
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

async function writeSourceCache(
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

function fingerprintParts(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

function fingerprintCandidates(sourceId: string, branch: string, candidates: string[]): string {
  return fingerprintParts([sourceId, branch, ...candidates]);
}

function appendRemoteEntries(allEntries: IndexEntry[], stats: BuildStats, sourceEntries: IndexEntry[]): void {
  for (const item of sourceEntries) {
    allEntries.push(item);
    stats.remote_count += 1;
  }
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

async function run(): Promise<void> {
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
