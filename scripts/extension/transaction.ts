// Transaction domain: staged, backed-up, rollback-safe application of a file
// plan. Depends one-way on planner types/guards — planner never imports this
// module. Moved verbatim from scripts/roster-extension.ts (S4 split).
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { exists, type InstalledFile } from "./manifest.js";
import {
  assertNoSymlinkParents,
  assertNotSymlink,
  resolveManagedTarget,
  type PlannedFile,
} from "./planner.js";

// Bounded empty-dir prune (R10b): after deletions, walk each affected file's
// parent chain upward and rmdir while empty, stopping strictly below the
// managed roots — the roots themselves (e.g. .agents/skills) always survive.
// rmdir refuses non-empty directories, so foreign files halt the walk safely.
async function pruneEmptyDirs(targets: string[], managedRoots: string[]): Promise<void> {
  for (const target of targets) {
    let dir = path.dirname(target);
    while (managedRoots.some((root) => dir.startsWith(`${root}${path.sep}`))) {
      try {
        await fs.rmdir(dir);
      } catch {
        break; // not empty (or already gone) — stop this walk
      }
      dir = path.dirname(dir);
    }
  }
}

// Undo a partially applied mutation list in reverse order, restoring backups,
// then prune any directories the failed attempt left empty.
async function rollbackTouched(
  touched: { target: string; backup: string | null }[],
  managedRoots: string[],
): Promise<void> {
  const rolledBack = touched.reverse();
  for (const item of rolledBack) {
    await fs.rm(item.target, { force: true });
    if (item.backup && (await exists(item.backup))) {
      await fs.mkdir(path.dirname(item.target), { recursive: true });
      await fs.rename(item.backup, item.target);
    }
  }
  await pruneEmptyDirs(rolledBack.map((item) => item.target), managedRoots);
}

export async function applyInstallTransaction(
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
  const deletions: string[] = [];
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
      else deletions.push(target);
    }
    await save();
    await pruneEmptyDirs(deletions, managedRoots);
  } catch (error) {
    await rollbackTouched(touched, managedRoots);
    throw error;
  } finally {
    await fs.rm(transactionRoot, { recursive: true, force: true });
  }
}
