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

// ---------------------------------------------------------------------------
// Registry lock (R3 redesign)
//
// Artifact shape (observed by the public stale-lock test — do not change):
// a lock DIRECTORY `.harness/extensions.lock` containing `owner.json` with
// numeric `pid` and `acquired_at` (epoch ms). This design adds a `token` for
// ownership re-verification; readers of the legacy shape are unaffected.
//
// Acquisition is an atomic exclusive-create (`mkdir`). Reclaim of a stale lock
// is an atomic `rename` to a caller-unique quarantine path — exactly one
// contender can win the rename, which closes the read→rm TOCTOU where two
// processes could both delete and both acquire. After every acquisition the
// owner file is read back and its token verified (post-reclaim
// re-verification); release is token-checked so a holder never removes a lock
// it no longer owns.
// ---------------------------------------------------------------------------

export type LockConfig = {
  staleMs: number;
  retryBudgetMs: number;
  pollMs: number;
};

// Named defaults. The retry budget MUST exceed the staleness threshold so a
// waiter always survives long enough to reclaim a lock that goes stale while
// it is waiting (the old constants had budget 2.5s < threshold 5s).
export const LOCK_DEFAULTS: LockConfig = { staleMs: 5_000, retryBudgetMs: 10_000, pollMs: 25 };

export const LOCK_STALE_MS_ENV = "ROSTER_EXTENSION_LOCK_STALE_MS";
export const LOCK_RETRY_BUDGET_MS_ENV = "ROSTER_EXTENSION_LOCK_RETRY_BUDGET_MS";
export const LOCK_POLL_MS_ENV = "ROSTER_EXTENSION_LOCK_POLL_MS";

function envMs(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function resolveLockConfig(overrides?: Partial<LockConfig>): LockConfig {
  const config: LockConfig = {
    staleMs: overrides?.staleMs ?? envMs(LOCK_STALE_MS_ENV) ?? LOCK_DEFAULTS.staleMs,
    retryBudgetMs: overrides?.retryBudgetMs ?? envMs(LOCK_RETRY_BUDGET_MS_ENV) ?? LOCK_DEFAULTS.retryBudgetMs,
    pollMs: overrides?.pollMs ?? envMs(LOCK_POLL_MS_ENV) ?? LOCK_DEFAULTS.pollMs,
  };
  if (config.retryBudgetMs <= config.staleMs) {
    throw new Error(
      `extension lock retry budget (${config.retryBudgetMs}ms) must exceed the staleness threshold (${config.staleMs}ms)`,
    );
  }
  return config;
}

type LockOwner = { pid: number | null; acquiredAt: number | null; token: string | null };

async function readLockOwner(ownerPath: string): Promise<LockOwner> {
  const owner = await readJson(ownerPath).catch(() => null);
  return {
    pid: typeof owner?.pid === "number" ? owner.pid : null,
    acquiredAt: typeof owner?.acquired_at === "number" ? owner.acquired_at : null,
    token: typeof owner?.token === "string" ? owner.token : null,
  };
}

function isPidAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Any failure other than "no such process" (e.g. EPERM) means it exists.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// A lock is stale when its holder is dead AND it is older than the staleness
// threshold. Age comes from owner.json; if the holder crashed between mkdir
// and the owner write, the lock directory's mtime stands in.
async function isLockStale(lockPath: string, owner: LockOwner, staleMs: number): Promise<boolean> {
  if (isPidAlive(owner.pid)) return false;
  let age: number;
  if (owner.acquiredAt !== null) {
    age = Date.now() - owner.acquiredAt;
  } else {
    try {
      age = Date.now() - (await fs.stat(lockPath)).mtimeMs;
    } catch {
      return false; // lock vanished — the acquire loop will retry mkdir
    }
  }
  return age > staleMs;
}

// Atomic exclusive-create, then write + read back the owner metadata. Returns
// the ownership token on success. Any interference (dir stolen between mkdir
// and write, token mismatch on read-back) yields null and the caller retries.
async function tryAcquireLock(lockPath: string, ownerPath: string): Promise<string | null> {
  const token = crypto.randomUUID();
  try {
    await fs.mkdir(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return null;
  }
  try {
    await fs.writeFile(ownerPath, JSON.stringify({ pid: process.pid, acquired_at: Date.now(), token }), { flag: "wx" });
    const readBack = await readLockOwner(ownerPath);
    return readBack.token === token ? token : null;
  } catch {
    return null;
  }
}

// Atomic reclaim: exactly one contender wins the rename; the loser sees ENOENT
// and simply retries. The quarantined directory is then deleted out-of-band of
// the lock path, so a fresh lock created by the winner can never be destroyed
// by a slow second reclaimer (the old read→rm TOCTOU).
async function reclaimStaleLock(lockPath: string, token: string): Promise<void> {
  const quarantine = `${lockPath}.reclaimed-${token}`;
  try {
    await fs.rename(lockPath, quarantine);
  } catch {
    return; // another contender won the reclaim (or the holder released)
  }
  await fs.rm(quarantine, { recursive: true, force: true });
}

async function releaseLock(lockPath: string, ownerPath: string, token: string): Promise<void> {
  const owner = await readLockOwner(ownerPath);
  if (owner.token !== null && owner.token !== token) return; // not ours anymore
  await fs.rm(lockPath, { recursive: true, force: true });
}

async function acquireRegistryLock(projectRoot: string, lockPath: string, config: LockConfig): Promise<string> {
  const ownerPath = path.join(lockPath, "owner.json");
  const deadline = Date.now() + config.retryBudgetMs;
  const reclaimToken = crypto.randomUUID();
  for (;;) {
    const token = await tryAcquireLock(lockPath, ownerPath);
    if (token !== null) return token;
    const owner = await readLockOwner(ownerPath);
    if (await isLockStale(lockPath, owner, config.staleMs)) {
      await reclaimStaleLock(lockPath, reclaimToken);
      continue; // retry the exclusive create immediately
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for extension registry lock: ${path.relative(projectRoot, lockPath)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

export async function withRegistryLock<T>(
  projectRoot: string,
  action: () => Promise<T>,
  lockConfig?: Partial<LockConfig>,
): Promise<T> {
  const config = resolveLockConfig(lockConfig);
  const lockPath = path.join(projectRoot, ".harness/extensions.lock");
  const ownerPath = path.join(lockPath, "owner.json");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = await acquireRegistryLock(projectRoot, lockPath, config);
  try {
    return await action();
  } finally {
    await releaseLock(lockPath, ownerPath, token);
  }
}
