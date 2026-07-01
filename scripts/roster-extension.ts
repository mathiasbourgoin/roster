#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseFrontmatter } from "./lib/frontmatter.js";

const execFileAsync = promisify(execFile);

type ExtensionType = "skill-pack" | "apparatus" | "profile-pack" | "workflow-pack";
type RuntimeTarget = "codex" | "opencode";

type Component = {
  name: string;
  path: string;
  version?: string;
  description?: string;
};

type ExtensionManifest = {
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

type InstalledFile = {
  source: string;
  target: string;
  sha256: string;
};

type InstalledExtension = ExtensionManifest & {
  source: {
    path: string;
    git_commit: string | null;
  };
  runtime_roots: string[];
  installed_at: string;
  installed_files: InstalledFile[];
};

type Registry = {
  schema_version: "1.0";
  extensions: InstalledExtension[];
};

type PlannedFile = InstalledFile & {
  content: Buffer;
};

type CliOptions = {
  target: string;
  dryRun: boolean;
};

const DEFAULT_TARGET = ".";
const REGISTRY_PATH = ".harness/extensions.json";
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/;

function usage(exitCode = 1): never {
  const text = [
    "Usage: roster-extension <command> [args]",
    "",
    "Commands:",
    "  info <extension-path>",
    "  install <extension-path> [--target <project-root>] [--dry-run]",
    "  remove <extension-name> [--target <project-root>] [--dry-run]",
    "  list [--target <project-root>]",
    "  converge [--target <project-root>] [--json]",
  ].join("\n");
  const out = exitCode === 0 ? console.log : console.error;
  out(text);
  process.exit(exitCode);
}

function cliParseError(message: string): never {
  console.error(`✗ roster-extension: ${message}`);
  usage(1);
}

function parseArgs(argv: string[]): { command: string; args: string[]; options: CliOptions; json: boolean } {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") usage(command ? 0 : 1);

  const args: string[] = [];
  let target = DEFAULT_TARGET;
  let dryRun = false;
  let json = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--target") {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) cliParseError("--target requires a value");
      target = value;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--")) cliParseError(`unknown option: ${arg}`);
    args.push(arg);
  }

  return { command, args, options: { target, dryRun }, json };
}

function assertSafeName(name: string, label: string): void {
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    throw new Error(`${label} must be a safe lowercase name: ${name}`);
  }
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(filePath))) return null;
  return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
}

async function walkFiles(root: string): Promise<string[]> {
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

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

function resolveManagedTarget(projectRoot: string, target: string, managedRoots: string[]): string {
  const abs = path.resolve(projectRoot, target);
  const rel = path.relative(projectRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing target outside project: ${target}`);
  }
  if (!managedRoots.some((root) => abs.startsWith(`${root}${path.sep}`))) {
    throw new Error(`refusing unmanaged extension target: ${target}`);
  }
  return abs;
}

function resolveExtensionSource(sourceRoot: string, source: string): string {
  const abs = path.resolve(sourceRoot, source);
  const rel = path.relative(sourceRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing source outside extension: ${source}`);
  }
  return abs;
}

async function assertNoSymlinkParents(projectRoot: string, targetFile: string): Promise<void> {
  const parentRel = path.relative(projectRoot, path.dirname(targetFile));
  let current = projectRoot;
  for (const segment of parentRel.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`refusing target beneath symlinked directory: ${path.relative(projectRoot, current)}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertNotSymlink(filePath: string, label: string): Promise<void> {
  try {
    if ((await fs.lstat(filePath)).isSymbolicLink()) {
      throw new Error(`refusing symlinked ${label}: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function gitCommit(repoPath: string): Promise<string | null> {
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

async function loadManifest(root: string): Promise<ExtensionManifest> {
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

function validateRegistryEntryShape(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== "object") throw new Error(`${REGISTRY_PATH} contains an invalid extension entry`);
  const item = entry as Record<string, unknown>;
  if (
    typeof item.name !== "string" ||
    typeof item.version !== "string" ||
    !Array.isArray(item.installed_files) ||
    !Array.isArray(item.runtime_roots) ||
    !Array.isArray(item.runtime_targets) ||
    !item.source ||
    typeof item.source !== "object"
  ) {
    throw new Error(`${REGISTRY_PATH} contains an invalid extension entry`);
  }
  const source = item.source as Record<string, unknown>;
  if (typeof source.path !== "string" || !(typeof source.git_commit === "string" || source.git_commit === null)) {
    throw new Error(`${REGISTRY_PATH} contains an invalid extension source`);
  }
  const runtimeTargets = asArray(item.runtime_targets).filter((target): target is RuntimeTarget =>
    target === "codex" || target === "opencode",
  );
  if (runtimeTargets.length !== (item.runtime_targets as unknown[]).length) {
    throw new Error(`${REGISTRY_PATH} contains an invalid runtime target`);
  }
  return item;
}

function validateRegistryInstalledFiles(
  projectRoot: string,
  item: Record<string, unknown>,
  managedRoots: string[],
  targets: Set<string>,
): void {
  for (const rawFile of item.installed_files as unknown[]) {
    if (!rawFile || typeof rawFile !== "object") throw new Error(`${REGISTRY_PATH} contains an invalid installed file`);
    const file = rawFile as Record<string, unknown>;
    if (
      typeof file.source !== "string" ||
      typeof file.target !== "string" ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error(`${REGISTRY_PATH} contains an invalid installed file`);
    }
    const canonicalTarget = resolveManagedTarget(projectRoot, file.target, managedRoots);
    if (targets.has(canonicalTarget)) {
      throw new Error(`${REGISTRY_PATH} contains duplicate owned target: ${file.target}`);
    }
    targets.add(canonicalTarget);
  }
}

async function validateRegistry(projectRoot: string, raw: Record<string, unknown>): Promise<Registry> {
  if (raw.schema_version !== "1.0" || !Array.isArray(raw.extensions)) {
    throw new Error(`${REGISTRY_PATH} is not a roster extension registry`);
  }
  const extensions = raw.extensions as unknown[];
  const names = new Set<string>();
  const targets = new Set<string>();
  for (const entry of extensions) {
    const item = validateRegistryEntryShape(entry);
    const managedRoots = asArray(item.runtime_roots).map((root) => resolveProjectEntrypoint(projectRoot, root));
    if (managedRoots.length !== (item.runtime_roots as unknown[]).length || managedRoots.length === 0) {
      throw new Error(`${REGISTRY_PATH} contains invalid runtime roots`);
    }
    assertSafeName(item.name as string, "registered extension name");
    if (names.has(item.name as string)) throw new Error(`${REGISTRY_PATH} contains duplicate extension name: ${item.name}`);
    names.add(item.name as string);
    validateRegistryInstalledFiles(projectRoot, item, managedRoots, targets);
  }
  return raw as Registry;
}

async function loadRegistry(projectRoot: string): Promise<Registry> {
  const registryPath = path.join(projectRoot, REGISTRY_PATH);
  const raw = await readJson(registryPath);
  if (!raw) return { schema_version: "1.0", extensions: [] };
  return validateRegistry(projectRoot, raw);
}

async function saveRegistry(projectRoot: string, registry: Registry, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await validateRegistry(projectRoot, registry as unknown as Record<string, unknown>);
  const registryPath = path.join(projectRoot, REGISTRY_PATH);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  const tempPath = `${registryPath}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, { flag: "wx" });
  await fs.rename(tempPath, registryPath);
}

function resolveProjectEntrypoint(projectRoot: string, entrypoint: string): string {
  if (entrypoint.startsWith("~") || path.isAbsolute(entrypoint)) {
    throw new Error(`extension runtime entrypoint must be project-local: ${entrypoint}`);
  }
  const resolved = path.resolve(projectRoot, entrypoint);
  const rel = path.relative(projectRoot, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`extension runtime entrypoint escapes project: ${entrypoint}`);
  }
  return resolved;
}

async function skillTargets(
  projectRoot: string,
  runtimeTargets: RuntimeTarget[],
): Promise<{ runtime: RuntimeTarget; root: string }[]> {
  const harness = await readJson(path.join(projectRoot, ".harness/harness.json"));
  const runtimes = Array.isArray(harness?.runtimes) ? harness.runtimes : null;
  const targets: { runtime: RuntimeTarget; root: string }[] = [];
  for (const runtime of runtimeTargets) {
    const fallback = runtime === "codex" ? ".agents/skills" : ".opencode";
    let entrypoint = fallback;
    if (runtimes) {
      const configured = runtimes.find(
        (item) => item && typeof item === "object" && (item as Record<string, unknown>).name === runtime,
      ) as Record<string, unknown> | undefined;
      if (!configured || configured.enabled !== true || typeof configured.entrypoint !== "string") {
        throw new Error(`requested extension runtime is not enabled in .harness/harness.json: ${runtime}`);
      }
      entrypoint = configured.entrypoint;
    }
    let root = resolveProjectEntrypoint(projectRoot, entrypoint);
    if (runtime === "opencode" && path.basename(root) !== "skills") root = path.join(root, "skills");
    targets.push({ runtime, root });
  }
  return targets;
}

// Shared overwrite guard for every planned target (regular files and the
// .roster-extension marker). Message strings are byte-identical to the
// pre-refactor inline blocks (see S1 characterization inventory).
async function guardPlannedTarget(
  projectRoot: string,
  targetFile: string,
  targetRel: string,
  managedRoots: string[],
  label: string,
  previousTargets: Map<string, InstalledFile>,
): Promise<void> {
  resolveManagedTarget(projectRoot, targetRel, managedRoots);
  await assertNoSymlinkParents(projectRoot, targetFile);
  await assertNotSymlink(targetFile, label);
  if (await exists(targetFile)) {
    const prior = previousTargets.get(targetRel);
    if (!prior) throw new Error(`refusing to overwrite unowned target: ${targetRel}`);
    if ((await sha256(targetFile)) !== prior.sha256) {
      throw new Error(`refusing to overwrite locally modified installed file: ${targetRel}`);
    }
  }
}

function plannedFile(source: string, target: string, content: Buffer): PlannedFile {
  return {
    source,
    target,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    content,
  };
}

async function planSkillIntoRuntime(
  sourceRoot: string,
  projectRoot: string,
  extensionName: string,
  skillName: string,
  sourceSkillDir: string,
  sourceFiles: string[],
  runtimeRoot: string,
  managedRoots: string[],
  previousTargets: Map<string, InstalledFile>,
): Promise<PlannedFile[]> {
  const installed: PlannedFile[] = [];
  const targetSkillDir = path.join(runtimeRoot, skillName);
  for (const sourceFile of sourceFiles) {
    const rel = path.relative(sourceSkillDir, sourceFile).replace(/\\/g, "/");
    const targetFile = path.join(targetSkillDir, rel);
    const sourceRel = path.relative(sourceRoot, sourceFile).replace(/\\/g, "/");
    const targetRel = path.relative(projectRoot, targetFile).replace(/\\/g, "/");
    await guardPlannedTarget(projectRoot, targetFile, targetRel, managedRoots, "extension target", previousTargets);
    installed.push(plannedFile(sourceRel, targetRel, await fs.readFile(sourceFile)));
  }
  const marker = path.join(targetSkillDir, ".roster-extension");
  const markerRel = path.relative(projectRoot, marker).replace(/\\/g, "/");
  await guardPlannedTarget(projectRoot, marker, markerRel, managedRoots, "extension marker", previousTargets);
  installed.push(plannedFile("<generated>", markerRel, Buffer.from(`${extensionName}\n`)));
  return installed;
}

async function planSkillFiles(
  sourceRoot: string,
  projectRoot: string,
  manifest: ExtensionManifest,
  previous: InstalledExtension | undefined,
  targets: { runtime: RuntimeTarget; root: string }[],
): Promise<PlannedFile[]> {
  const installed: PlannedFile[] = [];
  const previousTargets = new Map(previous?.installed_files.map((file) => [file.target, file]) ?? []);
  const managedRoots = targets.map((target) => target.root);
  for (const skill of manifest.components.skills) {
    assertSafeName(skill.name, "skill name");
    const sourceSkillDir = path.dirname(path.join(sourceRoot, skill.path));
    const sourceFiles = await walkFiles(sourceSkillDir);
    if (sourceFiles.length === 0) {
      throw new Error(`declared skills resolved to no installable files: ${skill.name}`);
    }
    for (const targetRuntime of targets) {
      installed.push(
        ...(await planSkillIntoRuntime(
          sourceRoot,
          projectRoot,
          manifest.name,
          skill.name,
          sourceSkillDir,
          sourceFiles,
          targetRuntime.root,
          managedRoots,
          previousTargets,
        )),
      );
    }
  }
  return installed;
}

// Unified preflight for a file recorded in the registry: resolves + symlink-guards
// the target, then classifies its on-disk state. install/remove/converge all share
// this path and attach their own (byte-preserved) error messages.
async function verifyInstalledFile(
  projectRoot: string,
  file: InstalledFile,
  managedRoots: string[],
): Promise<"missing" | "clean" | "modified"> {
  const abs = resolveManagedTarget(projectRoot, file.target, managedRoots);
  await assertNoSymlinkParents(projectRoot, abs);
  await assertNotSymlink(abs, "extension target");
  if (!(await exists(abs))) return "missing";
  return (await sha256(abs)) === file.sha256 ? "clean" : "modified";
}

async function withRegistryLock<T>(projectRoot: string, action: () => Promise<T>): Promise<T> {
  const lockPath = path.join(projectRoot, ".harness/extensions.lock");
  const ownerPath = path.join(lockPath, "owner.json");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(ownerPath, JSON.stringify({ pid: process.pid, acquired_at: Date.now() }), { flag: "wx" });
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readJson(ownerPath).catch(() => null);
      const pid = typeof owner?.pid === "number" ? owner.pid : null;
      const acquiredAt = typeof owner?.acquired_at === "number" ? owner.acquired_at : 0;
      let ownerAlive = false;
      if (pid !== null) {
        try {
          process.kill(pid, 0);
          ownerAlive = true;
        } catch (killError) {
          if ((killError as NodeJS.ErrnoException).code !== "ESRCH") ownerAlive = true;
        }
      }
      if (!ownerAlive && Date.now() - acquiredAt > 5_000) {
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!acquired) throw new Error(`timed out waiting for extension registry lock: ${path.relative(projectRoot, lockPath)}`);
  try {
    return await action();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function applyInstallTransaction(
  projectRoot: string,
  files: PlannedFile[],
  staleFiles: InstalledFile[],
  managedRoots: string[],
  save: () => Promise<void>,
): Promise<void> {
  const transactionRoot = path.join(projectRoot, ".harness", `.extension-txn-${crypto.randomUUID()}`);
  const backups = path.join(transactionRoot, "backups");
  const staged = path.join(transactionRoot, "staged");
  const touched: { target: string; backup: string | null }[] = [];
  await fs.mkdir(backups, { recursive: true });
  await fs.mkdir(staged, { recursive: true });

  try {
    for (let i = 0; i < files.length; i += 1) {
      await fs.writeFile(path.join(staged, String(i)), files[i].content, { flag: "wx" });
    }
    const mutations = [
      ...files.map((file, index) => ({ target: file.target, stage: path.join(staged, String(index)) })),
      ...staleFiles.map((file) => ({ target: file.target, stage: null })),
    ];
    for (let i = 0; i < mutations.length; i += 1) {
      const mutation = mutations[i];
      const target = resolveManagedTarget(projectRoot, mutation.target, managedRoots);
      await assertNoSymlinkParents(projectRoot, target);
      await assertNotSymlink(target, "extension target");
      await fs.mkdir(path.dirname(target), { recursive: true });
      let backup: string | null = null;
      if (await exists(target)) {
        backup = path.join(backups, String(i));
        await fs.rename(target, backup);
      }
      touched.push({ target, backup });
      if (mutation.stage) await fs.rename(mutation.stage, target);
    }
    await save();
  } catch (error) {
    for (const item of touched.reverse()) {
      await fs.rm(item.target, { force: true });
      if (item.backup && (await exists(item.backup))) {
        await fs.mkdir(path.dirname(item.target), { recursive: true });
        await fs.rename(item.backup, item.target);
      }
    }
    throw error;
  } finally {
    await fs.rm(transactionRoot, { recursive: true, force: true });
  }
}

export async function info(extensionPath: string): Promise<ExtensionManifest> {
  return loadManifest(path.resolve(extensionPath));
}

function assertUniquePlannedTargets(plannedFiles: PlannedFile[]): void {
  const targetNames = new Set<string>();
  for (const file of plannedFiles) {
    if (targetNames.has(file.target)) throw new Error(`extension produces duplicate target: ${file.target}`);
    targetNames.add(file.target);
  }
}

function assertNoCrossOwnership(
  projectRoot: string,
  registry: Registry,
  extensionName: string,
  plannedFiles: PlannedFile[],
  currentRoots: string[],
): void {
  const otherOwnedTargets = new Set<string>();
  for (const extension of registry.extensions) {
    if (extension.name === extensionName) continue;
    const roots = extension.runtime_roots.map((root) => resolveProjectEntrypoint(projectRoot, root));
    for (const file of extension.installed_files) {
      otherOwnedTargets.add(resolveManagedTarget(projectRoot, file.target, roots));
    }
  }
  for (const file of plannedFiles) {
    const abs = resolveManagedTarget(projectRoot, file.target, currentRoots);
    if (otherOwnedTargets.has(abs)) throw new Error(`target is owned by another extension: ${file.target}`);
  }
}

async function preflightStaleFiles(
  projectRoot: string,
  staleFiles: InstalledFile[],
  managedRoots: string[],
): Promise<void> {
  for (const file of staleFiles) {
    if ((await verifyInstalledFile(projectRoot, file, managedRoots)) === "modified") {
      throw new Error(`refusing to replace extension with locally modified stale file: ${file.target}`);
    }
  }
}

export async function install(extensionPath: string, options: CliOptions): Promise<InstalledExtension> {
  const sourceRoot = path.resolve(extensionPath);
  const projectRoot = path.resolve(options.target);
  const manifest = await loadManifest(sourceRoot);
  const action = async (): Promise<InstalledExtension> => {
    const registry = await loadRegistry(projectRoot);
    const previous = registry.extensions.find((item) => item.name === manifest.name);
    const targets = await skillTargets(projectRoot, manifest.runtime_targets);
    const currentRoots = targets.map((target) => target.root);
    const previousRoots = previous?.runtime_roots.map((root) => resolveProjectEntrypoint(projectRoot, root)) ?? [];
    const managedRoots = [...new Set([...currentRoots, ...previousRoots])];
    const plannedFiles = await planSkillFiles(sourceRoot, projectRoot, manifest, previous, targets);
    assertUniquePlannedTargets(plannedFiles);
    assertNoCrossOwnership(projectRoot, registry, manifest.name, plannedFiles, currentRoots);
    // Recorded-only packs (no skill components declared) register with an empty
    // installed_files list: the entry is still lock-protected, validated, and written
    // atomically, but nothing is projected. Declared skills that resolve to zero
    // installable files are a hard error inside planSkillFiles instead.
    const newTargets = new Set(plannedFiles.map((file) => file.target));
    const staleFiles = previous?.installed_files.filter((file) => !newTargets.has(file.target)) ?? [];
    await preflightStaleFiles(projectRoot, staleFiles, managedRoots);
    const installedFiles = plannedFiles.map(({ content: _content, ...file }) => file);
    const installed: InstalledExtension = {
      ...manifest,
      source: { path: sourceRoot, git_commit: await gitCommit(sourceRoot) },
      runtime_roots: currentRoots.map((root) => path.relative(projectRoot, root).replace(/\\/g, "/")),
      installed_at: new Date().toISOString(),
      installed_files: installedFiles,
    };
    registry.extensions = registry.extensions.filter((item) => item.name !== manifest.name);
    registry.extensions.push(installed);
    registry.extensions.sort((a, b) => a.name.localeCompare(b.name));
    if (!options.dryRun) {
      await applyInstallTransaction(
        projectRoot,
        plannedFiles,
        staleFiles,
        managedRoots,
        async () => saveRegistry(projectRoot, registry, false),
      );
    }
    return installed;
  };
  return options.dryRun ? action() : withRegistryLock(projectRoot, action);
}

export async function list(projectRootArg: string): Promise<InstalledExtension[]> {
  const registry = await loadRegistry(path.resolve(projectRootArg));
  return registry.extensions;
}

export async function remove(extensionName: string, options: CliOptions): Promise<InstalledExtension | null> {
  assertSafeName(extensionName, "extension name");
  const projectRoot = path.resolve(options.target);
  const action = async (): Promise<InstalledExtension | null> => {
    const registry = await loadRegistry(projectRoot);
    const installed = registry.extensions.find((item) => item.name === extensionName) ?? null;
    if (!installed) return null;
    const managedRoots = installed.runtime_roots.map((root) => resolveProjectEntrypoint(projectRoot, root));
    for (const file of installed.installed_files) {
      if ((await verifyInstalledFile(projectRoot, file, managedRoots)) === "modified") {
        throw new Error(`refusing to remove locally modified installed file: ${file.target}`);
      }
    }
    registry.extensions = registry.extensions.filter((item) => item.name !== extensionName);
    if (!options.dryRun) {
      await applyInstallTransaction(
        projectRoot,
        [],
        installed.installed_files,
        managedRoots,
        async () => saveRegistry(projectRoot, registry, false),
      );
    }
    return installed;
  };
  return options.dryRun ? action() : withRegistryLock(projectRoot, action);
}

type ConvergeFindings = {
  missing: string[];
  modified: string[];
  invalid_targets: string[];
  source_missing: string[];
  source_modified: string[];
};

async function classifySourceFile(sourceRootPath: string, file: InstalledFile): Promise<"ok" | "missing" | "modified"> {
  let sourceAbs;
  try {
    sourceAbs = resolveExtensionSource(sourceRootPath, file.source);
  } catch {
    return "missing";
  }
  if (!(await exists(sourceAbs))) return "missing";
  return (await sha256(sourceAbs)) === file.sha256 ? "ok" : "modified";
}

async function classifyInstalledFiles(
  projectRoot: string,
  extension: InstalledExtension,
  managedRoots: string[],
): Promise<ConvergeFindings> {
  const findings: ConvergeFindings = { missing: [], modified: [], invalid_targets: [], source_missing: [], source_modified: [] };
  for (const file of extension.installed_files) {
    let state;
    try {
      state = await verifyInstalledFile(projectRoot, file, managedRoots);
    } catch {
      findings.invalid_targets.push(file.target);
      continue;
    }
    if (state === "missing") {
      findings.missing.push(file.target);
      continue;
    }
    if (state === "modified") findings.modified.push(file.target);
    if (file.source !== "<generated>") {
      const sourceState = await classifySourceFile(extension.source.path, file);
      if (sourceState === "missing") findings.source_missing.push(file.source);
      else if (sourceState === "modified") findings.source_modified.push(file.source);
    }
  }
  return findings;
}

async function convergeExtension(projectRoot: string, extension: InstalledExtension): Promise<Record<string, unknown>> {
  const managedRoots = extension.runtime_roots.map((root) => resolveProjectEntrypoint(projectRoot, root));
  const currentManifest = await loadManifest(extension.source.path).catch(() => null);
  const currentCommit = await gitCommit(extension.source.path);
  const findings = await classifyInstalledFiles(projectRoot, extension, managedRoots);
  const clean =
    findings.missing.length === 0 &&
    findings.modified.length === 0 &&
    findings.invalid_targets.length === 0 &&
    findings.source_missing.length === 0 &&
    findings.source_modified.length === 0 &&
    currentManifest?.version === extension.version &&
    currentCommit === extension.source.git_commit;
  return {
    name: extension.name,
    status: clean ? "OK" : "DRIFT",
    // Advisory only: a recorded-only pack has no on-disk files to verify, so the
    // report says so explicitly. It never causes DRIFT by itself — only real
    // version/commit/source drift does.
    recorded_only: extension.installed_files.length === 0,
    installed_version: extension.version,
    source_version: currentManifest?.version ?? null,
    installed_commit: extension.source.git_commit,
    source_commit: currentCommit,
    ...findings,
  };
}

export async function converge(projectRootArg: string): Promise<Record<string, unknown>[]> {
  const projectRoot = path.resolve(projectRootArg);
  const registry = await loadRegistry(projectRoot);
  const reports: Record<string, unknown>[] = [];
  for (const extension of registry.extensions) {
    reports.push(await convergeExtension(projectRoot, extension));
  }
  return reports;
}

function printManifest(manifest: ExtensionManifest): void {
  console.log(`${manifest.name} ${manifest.version} (${manifest.type})`);
  if (manifest.description) console.log(manifest.description);
  console.log(`runtime targets: ${manifest.runtime_targets.join(", ")}`);
  for (const [kind, entries] of Object.entries(manifest.components)) {
    console.log(`${kind}: ${entries.length}`);
    for (const entry of entries.slice(0, 20)) {
      console.log(`  - ${entry.name}${entry.version ? `@${entry.version}` : ""} (${entry.path})`);
    }
    if (entries.length > 20) console.log(`  ... ${entries.length - 20} more`);
  }
}

async function main(): Promise<void> {
  const { command, args, options, json } = parseArgs(process.argv.slice(2));
  if (command === "info") {
    if (!args[0]) usage();
    printManifest(await info(args[0]));
    return;
  }
  if (command === "install") {
    if (!args[0]) usage();
    const installed = await install(args[0], options);
    console.log(`${options.dryRun ? "would install" : "installed"} ${installed.name} ${installed.version}`);
    console.log(`files: ${installed.installed_files.length}`);
    return;
  }
  if (command === "remove") {
    if (!args[0]) usage();
    const removed = await remove(args[0], options);
    console.log(removed ? `${options.dryRun ? "would remove" : "removed"} ${removed.name}` : `not installed: ${args[0]}`);
    return;
  }
  if (command === "list") {
    const installed = await list(options.target);
    if (installed.length === 0) {
      console.log("no extensions installed");
      return;
    }
    for (const item of installed) console.log(`${item.name} ${item.version} (${item.type})`);
    return;
  }
  if (command === "converge") {
    await runConverge(options, json);
    return;
  }
  usage();
}

async function runConverge(options: CliOptions, json: boolean): Promise<void> {
  const reports = await converge(options.target);
  const hasDrift = reports.some((report) => report.status === "DRIFT");
  if (json) {
    console.log(JSON.stringify(reports, null, 2));
    if (hasDrift) process.exitCode = 1;
    return;
  }
  if (reports.length === 0) {
    console.log("no extensions installed");
    return;
  }
  for (const report of reports) printConvergeReport(report);
  if (hasDrift) process.exitCode = 1;
}

function printConvergeReport(report: Record<string, unknown>): void {
  console.log(`${report.name}: ${report.status}`);
  if (report.recorded_only) console.log("  note: recorded-only entry, no installed files on disk to verify");
  const missing = report.missing as string[];
  const modified = report.modified as string[];
  const invalidTargets = report.invalid_targets as string[];
  const sourceMissing = report.source_missing as string[];
  const sourceModified = report.source_modified as string[];
  if (missing.length > 0) console.log(`  missing: ${missing.join(", ")}`);
  if (modified.length > 0) console.log(`  modified: ${modified.join(", ")}`);
  if (invalidTargets.length > 0) console.log(`  invalid targets: ${invalidTargets.join(", ")}`);
  if (sourceMissing.length > 0) console.log(`  source missing: ${sourceMissing.join(", ")}`);
  if (sourceModified.length > 0) console.log(`  source modified: ${sourceModified.join(", ")}`);
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`✗ roster-extension: ${error.message}`);
    process.exit(1);
  });
}
