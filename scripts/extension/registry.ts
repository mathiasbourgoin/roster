// Registry domain: the .harness/extensions.json store — validation, load/save,
// and the cross-process registry lock. Moved verbatim from
// scripts/roster-extension.ts (S4 split).
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  asArray,
  assertSafeName,
  readJson,
  type InstalledExtension,
  type RuntimeTarget,
} from "./manifest.js";
import { resolveManagedTarget, resolveProjectEntrypoint } from "./planner.js";

export type Registry = {
  schema_version: "1.0";
  extensions: InstalledExtension[];
};

export const REGISTRY_PATH = ".harness/extensions.json";

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

export async function validateRegistry(projectRoot: string, raw: Record<string, unknown>): Promise<Registry> {
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

export async function loadRegistry(projectRoot: string): Promise<Registry> {
  const registryPath = path.join(projectRoot, REGISTRY_PATH);
  const raw = await readJson(registryPath);
  if (!raw) return { schema_version: "1.0", extensions: [] };
  return validateRegistry(projectRoot, raw);
}

export async function saveRegistry(projectRoot: string, registry: Registry, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await validateRegistry(projectRoot, registry as unknown as Record<string, unknown>);
  const registryPath = path.join(projectRoot, REGISTRY_PATH);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  const tempPath = `${registryPath}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, { flag: "wx" });
  await fs.rename(tempPath, registryPath);
}

export async function withRegistryLock<T>(projectRoot: string, action: () => Promise<T>): Promise<T> {
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
