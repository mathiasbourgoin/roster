import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseFrontmatter,
  parseLooseMetadata,
  inferComponentType,
  normalizeEntry,
  chooseBestSourceEntries,
  enrichRemoteEntry,
  inferComplexity,
  type IndexEntry,
  type SourceCache,
} from "./build-index.js";

function makeEntry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    name: "test-agent",
    display_name: "Test Agent",
    description: "A test agent",
    domain: [],
    tags: [],
    model: "",
    complexity: "",
    compatible_with: [],
    version: "1.0.0",
    path: "agents/test-agent.md",
    source: "remote",
    source_id: "owner/repo",
    source_repo: "owner/repo",
    component_type: "agent",
    ...overrides,
  };
}

function makeCache(entries: IndexEntry[]): SourceCache {
  return {
    source_id: "owner/repo",
    source_repo: "owner/repo",
    built_at: new Date().toISOString(),
    entries,
  };
}

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("valid frontmatter returns correct record", () => {
    const content = `---\nname: my-agent\ndescription: Does stuff\n---\n# Body\n`;
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.equal(result["name"], "my-agent");
    assert.equal(result["description"], "Does stuff");
  });

  it("missing closing --- returns null", () => {
    const content = `---\nname: my-agent\ndescription: Does stuff\n`;
    const result = parseFrontmatter(content);
    assert.equal(result, null);
  });

  it("inline arrays parsed correctly", () => {
    const content = `---\nname: my-agent\ntags: [alpha, beta, gamma]\n---\n`;
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.deepEqual(result["tags"], ["alpha", "beta", "gamma"]);
  });

  it("scalar values are stripped of surrounding quotes", () => {
    const content = `---\nname: "quoted-name"\ndescription: 'single-quoted'\n---\n`;
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.equal(result["name"], "quoted-name");
    assert.equal(result["description"], "single-quoted");
  });

  it("empty body between markers returns empty record (not null)", () => {
    const content = `---\n---\n`;
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.deepEqual(result, {});
  });

  it("content not starting with --- returns null", () => {
    const content = `name: my-agent\n---\n`;
    const result = parseFrontmatter(content);
    assert.equal(result, null);
  });

  it("indented continuation lines are silently dropped, rest parses correctly", () => {
    // Block scalar / nested key: the indented line is dropped; the key above it
    // retains its inline value (empty string here since 'description:' has no inline value).
    const content = `---\nname: my-agent\ndescription:\n  This indented line is dropped\ntags: [x]\n---\n`;
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.equal(result["name"], "my-agent");
    assert.equal(result["description"], "");
    assert.deepEqual(result["tags"], ["x"]);
  });

  it("CRLF line endings parse the same as LF", () => {
    const content = "---\r\nname: crlf-agent\r\ndescription: Windows lines\r\n---\r\n";
    const result = parseFrontmatter(content);
    assert.ok(result !== null);
    assert.equal(result["name"], "crlf-agent");
    assert.equal(result["description"], "Windows lines");
  });
});

// ---------------------------------------------------------------------------
// parseLooseMetadata
// ---------------------------------------------------------------------------

describe("parseLooseMetadata", () => {
  it("file with no --- markers but known keys returns record", () => {
    const content = `# My Agent\nname: loose-agent\ndescription: Works loosely\n`;
    const result = parseLooseMetadata(content);
    assert.ok(result !== null);
    assert.equal(result["name"], "loose-agent");
    assert.equal(result["description"], "Works loosely");
  });

  it("missing name field returns null", () => {
    const content = `# My Agent\ndescription: No name here\n`;
    const result = parseLooseMetadata(content);
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// inferComponentType
// ---------------------------------------------------------------------------

describe("inferComponentType", () => {
  it("agents/foo.md -> agent", () => {
    assert.equal(inferComponentType("agents/foo.md"), "agent");
  });

  it("skills/bar.md -> skill", () => {
    assert.equal(inferComponentType("skills/bar.md"), "skill");
  });

  it("rules/x.md -> rule", () => {
    assert.equal(inferComponentType("rules/x.md"), "rule");
  });

  it("hooks/y.md -> hook", () => {
    assert.equal(inferComponentType("hooks/y.md"), "hook");
  });

  it("kb/z.md -> kb", () => {
    assert.equal(inferComponentType("kb/z.md"), "kb");
  });

  it("other/a.md -> other", () => {
    assert.equal(inferComponentType("other/a.md"), "other");
  });
});

// ---------------------------------------------------------------------------
// normalizeEntry
// ---------------------------------------------------------------------------

describe("normalizeEntry", () => {
  it("valid frontmatter with name returns entry", () => {
    const fm = { name: "my-agent", description: "Test", version: "2.0.0", domain: ["ai"], tags: ["x"] };
    const result = normalizeEntry(fm, "agents/my-agent.md", "local", "local", "owner/repo");
    assert.ok(result !== null);
    assert.equal(result.name, "my-agent");
    assert.equal(result.version, "2.0.0");
  });

  it("missing name returns null", () => {
    const fm = { description: "No name" };
    const result = normalizeEntry(fm, "agents/unnamed.md", "local", "local", "owner/repo");
    assert.equal(result, null);
  });

  it("missing version defaults to 1.0.0", () => {
    const fm = { name: "no-version" };
    const result = normalizeEntry(fm, "agents/no-version.md", "local", "local", "owner/repo");
    assert.ok(result !== null);
    assert.equal(result.version, "1.0.0");
  });

  it("missing domain and tags default to empty arrays", () => {
    const fm = { name: "minimal" };
    const result = normalizeEntry(fm, "agents/minimal.md", "local", "local", "owner/repo");
    assert.ok(result !== null);
    assert.deepEqual(result.domain, []);
    assert.deepEqual(result.tags, []);
    assert.deepEqual(result.compatible_with, []);
  });
});

// ---------------------------------------------------------------------------
// chooseBestSourceEntries
// ---------------------------------------------------------------------------

describe("chooseBestSourceEntries", () => {
  it("null cache and empty refreshed returns empty array", () => {
    const result = chooseBestSourceEntries(null, []);
    assert.deepEqual(result, []);
  });

  it("no cache returns refreshed", () => {
    const refreshed = [makeEntry()!];
    const result = chooseBestSourceEntries(null, refreshed);
    assert.equal(result, refreshed);
  });

  it("empty refreshed returns cached entries", () => {
    const cached = makeCache([makeEntry()!]);
    const result = chooseBestSourceEntries(cached, []);
    assert.equal(result, cached.entries);
  });

  it("refreshed < 95% of cached count returns cached", () => {
    const cachedEntries = Array.from({ length: 100 }, (_, i) => makeEntry({ name: `agent-${i}` })!);
    const cached = makeCache(cachedEntries);
    // 94 < floor(100 * 0.95) = 95, should fall back to cache
    const refreshed = Array.from({ length: 94 }, (_, i) => makeEntry({ name: `new-${i}` })!);
    const result = chooseBestSourceEntries(cached, refreshed);
    assert.equal(result, cached.entries);
  });

  it("refreshed >= 95% of cached count returns refreshed", () => {
    const cachedEntries = Array.from({ length: 100 }, (_, i) => makeEntry({ name: `agent-${i}` })!);
    const cached = makeCache(cachedEntries);
    // 95 >= floor(100 * 0.95) = 95, should use refreshed
    const refreshed = Array.from({ length: 95 }, (_, i) => makeEntry({ name: `new-${i}` })!);
    const result = chooseBestSourceEntries(cached, refreshed);
    assert.equal(result, refreshed);
  });
});

// ---------------------------------------------------------------------------
// inferComplexity
// ---------------------------------------------------------------------------

describe("inferComplexity", () => {
  it("content with < 120 lines -> low", () => {
    const content = Array.from({ length: 119 }, (_, i) => `line ${i}`).join("\n");
    assert.equal(inferComplexity(content), "low");
  });

  it("content with 120-279 lines -> medium", () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    assert.equal(inferComplexity(content), "medium");
  });

  it("content with >= 280 lines -> high", () => {
    const content = Array.from({ length: 280 }, (_, i) => `line ${i}`).join("\n");
    assert.equal(inferComplexity(content), "high");
  });
});

// ---------------------------------------------------------------------------
// enrichRemoteEntry
// ---------------------------------------------------------------------------

describe("enrichRemoteEntry", () => {
  it("display_name falls back to heading when empty", () => {
    const entry = makeEntry({ display_name: "", name: "raw-name" })!;
    const content = `# My Nice Heading\n\nSome description here.\n`;
    const result = enrichRemoteEntry(entry, content);
    assert.equal(result.display_name, "My Nice Heading");
  });

  it("description falls back to first non-heading line when empty", () => {
    const entry = makeEntry({ description: "" })!;
    const content = `# Heading\n\nThis is the first description line.\n`;
    const result = enrichRemoteEntry(entry, content);
    assert.equal(result.description, "This is the first description line.");
  });

  it("complexity is inferred when not set", () => {
    const entry = makeEntry({ complexity: "" })!;
    const shortContent = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const result = enrichRemoteEntry(entry, shortContent);
    assert.equal(result.complexity, "low");
  });

  it("existing display_name is not overwritten", () => {
    const entry = makeEntry({ display_name: "Keep This" })!;
    const content = `# Different Heading\n\nBody.\n`;
    const result = enrichRemoteEntry(entry, content);
    assert.equal(result.display_name, "Keep This");
  });
});
