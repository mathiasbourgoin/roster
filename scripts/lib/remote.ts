import path from "node:path";
import type { IndexEntry, RemoteSource } from "./types.js";
import { inferCatalogCompatible, inferCatalogComponentType, tokenize, unique } from "./infer.js";
import { sanitizeName } from "./normalize.js";

export async function fetchText(url: string): Promise<string> {
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

export async function fetchJson<T>(url: string): Promise<T> {
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

export function toRawUrl(repo: string, branch: string, filePath: string): string {
  const normalized = filePath.replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${repo}/${branch}/${normalized}`;
}

export function resolveCandidatePath(seedPath: string, rawLink: string, repo: string): string | null {
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

export function parseMarkdownLinks(markdown: string): string[] {
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

export function parseMarkdownLinkPairs(markdown: string): MarkdownLink[] {
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

export async function collectRemoteCandidates(source: RemoteSource): Promise<string[]> {
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

export function sortEntries(entries: IndexEntry[]): IndexEntry[] {
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

export async function collectCatalogEntries(source: RemoteSource): Promise<IndexEntry[]> {
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
