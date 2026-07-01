// Planner domain: path containment guards, runtime target resolution, and the
// skill file plan. Moved verbatim from scripts/roster-extension.ts (S4 split).
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  assertSafeName,
  exists,
  readJson,
  sha256,
  walkFiles,
  type ExtensionManifest,
  type InstalledExtension,
  type InstalledFile,
  type RuntimeTarget,
} from "./manifest.js";

export type PlannedFile = InstalledFile & {
  content: Buffer;
};

export function resolveManagedTarget(projectRoot: string, target: string, managedRoots: string[]): string {
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

export function resolveExtensionSource(sourceRoot: string, source: string): string {
  const abs = path.resolve(sourceRoot, source);
  const rel = path.relative(sourceRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing source outside extension: ${source}`);
  }
  return abs;
}

export async function assertNoSymlinkParents(projectRoot: string, targetFile: string): Promise<void> {
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

export async function assertNotSymlink(filePath: string, label: string): Promise<void> {
  try {
    if ((await fs.lstat(filePath)).isSymbolicLink()) {
      throw new Error(`refusing symlinked ${label}: ${filePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export function resolveProjectEntrypoint(projectRoot: string, entrypoint: string): string {
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

export async function skillTargets(
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

export async function planSkillFiles(
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
export async function verifyInstalledFile(
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
