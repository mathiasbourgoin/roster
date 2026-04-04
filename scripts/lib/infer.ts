import type { ComponentType } from "./types.js";

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
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

export function inferDomainBySource(sourceId: string, filePath: string): string[] {
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

export function inferCompatible(sourceId: string, filePath: string): string[] {
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

export function inferCompatibleFromText(sourceId: string, text: string): string[] {
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

export function inferCatalogCompatible(sourceId: string, text: string): string[] {
  return inferCompatibleFromText(sourceId, text);
}

export function inferCatalogComponentType(sourceId: string): ComponentType {
  if (sourceId.includes("skills")) {
    return "skill";
  }
  if (sourceId.includes("agents") || sourceId.includes("subagents")) {
    return "agent";
  }
  return "other";
}
