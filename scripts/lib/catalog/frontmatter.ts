export function parseInlineArray(raw: string): string[] {
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

export function parseScalar(raw: string): string {
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
