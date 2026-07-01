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
