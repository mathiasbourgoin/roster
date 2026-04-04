import path from "node:path";
import type { IndexEntry } from "./types.js";
import {
  inferComponentType,
  inferComplexity,
  inferDomainBySource,
  inferCompatible,
  inferCompatibleFromText,
  tokenize,
  unique,
} from "./infer.js";

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

export function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
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

export function fallbackRemoteEntry(
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
