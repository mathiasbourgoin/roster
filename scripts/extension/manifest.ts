// Manifest domain: extension types, shared fs/naming utilities, and manifest
// loading/inference. Moved verbatim from scripts/roster-extension.ts (S4 split).
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseFrontmatter } from "../lib/frontmatter.js";

const execFileAsync = promisify(execFile);

export type ExtensionType = "skill-pack" | "apparatus" | "profile-pack" | "workflow-pack";
export type RuntimeTarget = "codex" | "opencode";

export type Component = {
  name: string;
  path: string;
  version?: string;
  description?: string;
};

export type ExtensionManifest = {
  schema_version: "1.0";
  name: string;
  version: string;
  type: ExtensionType;
  description: string;
  runtime_targets: RuntimeTarget[];
  components: {
    skills: Component[];
    agents: Component[];
    hooks: Component[];
    profiles: Component[];
    templates: Component[];
    tools: Component[];
    workflows: Component[];
  };
};

export type InstalledFile = {
  source: string;
  target: string;
  sha256: string;
};

export type InstalledExtension = ExtensionManifest & {
  source: {
    path: string;
    git_commit: string | null;
  };
  runtime_roots: string[];
  installed_at: string;
  installed_files: InstalledFile[];
};

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/;

export function assertSafeName(name: string, label: string): void {
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    throw new Error(`${label} must be a safe lowercase name: ${name}`);
  }
}

export function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(filePath))) return null;
  return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
}

export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  await walk(root);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export async function gitCommit(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function componentFromSkill(root: string, skillFile: string): Component {
  const rel = path.relative(root, skillFile).replace(/\\/g, "/");
  const content = require("node:fs").readFileSync(skillFile, "utf8") as string;
  const fm = parseFrontmatter(content);
  const fallback = path.basename(path.dirname(skillFile));
  const name = typeof fm?.name === "string" && fm.name ? fm.name : fallback;
  assertSafeName(name, "skill name");
  return {
    name,
    path: rel,
    version: typeof fm?.version === "string" ? fm.version : undefined,
    description: typeof fm?.description === "string" ? fm.description : undefined,
  };
}

async function collectNamedFiles(root: string, dir: string, suffix: string): Promise<Component[]> {
  const base = path.join(root, dir);
  if (!(await exists(base))) return [];
  const files = await walkFiles(base);
  return files
    .filter((file) => file.endsWith(suffix))
    .map((file) => {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      const name = path.basename(file, suffix);
      return { name, path: rel };
    });
}

async function collectSkills(root: string): Promise<Component[]> {
  const base = path.join(root, "skills");
  if (!(await exists(base))) return [];
  const files = await walkFiles(base);
  const skills = files.filter((file) => path.basename(file) === "SKILL.md").map((file) => componentFromSkill(root, file));
  // A skills/ tree is a declaration: resolving it to zero SKILL.md files is a
  // layout error (typo'd structure), not a recorded-only pack.
  if (skills.length === 0) {
    throw new Error("skills directory is present but resolves to no installable skills (no SKILL.md found)");
  }
  return skills;
}

function inferType(components: ExtensionManifest["components"]): ExtensionType {
  if (components.profiles.length > 0 || components.templates.length > 0) return "apparatus";
  if (components.workflows.length > 0) return "workflow-pack";
  if (components.skills.length > 0) return "skill-pack";
  return "profile-pack";
}

function validateExplicitManifest(explicit: Record<string, unknown> | null): void {
  if (!explicit) return;
  if (explicit.schema_version !== "1.0") {
    throw new Error(`unsupported roster-extension.json schema_version: ${String(explicit.schema_version)}`);
  }
  if (typeof explicit.name !== "string" || typeof explicit.version !== "string") {
    throw new Error("roster-extension.json requires string name and version fields");
  }
  if (explicit.runtime_targets !== undefined && !Array.isArray(explicit.runtime_targets)) {
    throw new Error("roster-extension.json runtime_targets must be an array");
  }
}

async function collectComponents(root: string): Promise<ExtensionManifest["components"]> {
  return {
    skills: await collectSkills(root),
    agents: await collectNamedFiles(root, "agents", ".md"),
    hooks: await collectNamedFiles(root, "hooks", ".md"),
    profiles: await collectNamedFiles(root, "profiles", ".md"),
    templates: await collectNamedFiles(root, "project-template", ".template"),
    tools: await collectNamedFiles(root, "tools", ""),
    workflows: await collectNamedFiles(root, "workflows", ".json"),
  };
}

function resolveRuntimeTargets(source: Record<string, unknown>): RuntimeTarget[] {
  const rawTargets = source.runtime_targets;
  if (rawTargets !== undefined && !Array.isArray(rawTargets)) {
    throw new Error("runtime_targets must be an array");
  }
  if (Array.isArray(rawTargets) && rawTargets.some((item) => typeof item !== "string")) {
    throw new Error("runtime_targets entries must be strings");
  }
  const requestedTargets = (rawTargets ?? []) as string[];
  const runtimeTargets = requestedTargets.filter((item): item is RuntimeTarget =>
    item === "codex" || item === "opencode",
  );
  if (requestedTargets.length !== runtimeTargets.length) {
    throw new Error(`unsupported runtime target in manifest: ${requestedTargets.join(", ")}`);
  }
  return runtimeTargets;
}

function resolveManifestType(source: Record<string, unknown>, components: ExtensionManifest["components"]): ExtensionType {
  const inferredType = inferType(components);
  const manifestType = source.type === undefined ? inferredType : String(source.type);
  if (!["skill-pack", "apparatus", "profile-pack", "workflow-pack"].includes(manifestType)) {
    throw new Error(`unsupported extension type: ${manifestType}`);
  }
  return manifestType as ExtensionType;
}

export async function loadManifest(root: string): Promise<ExtensionManifest> {
  const explicit = await readJson(path.join(root, "roster-extension.json"));
  const plugin = await readJson(path.join(root, ".claude-plugin/plugin.json"));
  const versionFile = (await exists(path.join(root, "VERSION"))) ? (await fs.readFile(path.join(root, "VERSION"), "utf8")).trim() : "";
  const source = explicit ?? plugin ?? {};
  validateExplicitManifest(explicit);

  const name = String(source.name ?? path.basename(root));
  assertSafeName(name, "extension name");

  const components = await collectComponents(root);
  const runtimeTargets = resolveRuntimeTargets(source);

  return {
    schema_version: "1.0",
    name,
    version: String(source.version ?? (versionFile || "0.0.0")),
    type: resolveManifestType(source, components),
    description: String(source.description ?? ""),
    runtime_targets: runtimeTargets.length > 0 ? runtimeTargets : ["codex"],
    components,
  };
}
