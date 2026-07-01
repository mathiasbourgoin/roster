// CLI/command domain: argument parsing, the five public operations
// (info/install/list/remove/converge), and the terminal presentation layer.
// Moved verbatim from scripts/roster-extension.ts (S4 split).
import path from "node:path";

import {
  exists,
  gitCommit,
  loadManifest,
  sha256,
  assertSafeName,
  type ExtensionManifest,
  type InstalledExtension,
  type InstalledFile,
} from "./manifest.js";
import {
  planSkillFiles,
  resolveExtensionSource,
  resolveManagedTarget,
  resolveProjectEntrypoint,
  skillTargets,
  verifyInstalledFile,
  type PlannedFile,
} from "./planner.js";
import { applyInstallTransaction } from "./transaction.js";
import { loadRegistry, saveRegistry, withRegistryLock, type Registry } from "./registry.js";

export type CliOptions = {
  target: string;
  dryRun: boolean;
};

const DEFAULT_TARGET = ".";

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

// Per-command arity/flag table (R8 + R10-json): every known flag is either
// honored or rejected per command, and extra operands are rejected instead of
// silently ignored. This table is the single source the parser enforces; it
// mirrors the usage() text above.
type CommandSpec = { operands: number; flags: readonly string[] };

const COMMAND_SPECS: Record<string, CommandSpec> = {
  info: { operands: 1, flags: [] },
  install: { operands: 1, flags: ["--target", "--dry-run"] },
  remove: { operands: 1, flags: ["--target", "--dry-run"] },
  list: { operands: 0, flags: ["--target"] },
  converge: { operands: 0, flags: ["--target", "--json"] },
};

function assertFlagAllowed(command: string, flag: string): void {
  const spec = COMMAND_SPECS[command];
  if (spec && !spec.flags.includes(flag)) cliParseError(`${flag} is not supported by ${command}`);
}

function assertOperandArity(command: string, args: string[]): void {
  const spec = COMMAND_SPECS[command];
  if (spec && args.length > spec.operands) {
    cliParseError(`unexpected argument for ${command}: ${args[spec.operands]}`);
  }
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
      assertFlagAllowed(command, arg);
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) cliParseError("--target requires a value");
      target = value;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      assertFlagAllowed(command, arg);
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      assertFlagAllowed(command, arg);
      json = true;
      continue;
    }
    if (arg.startsWith("--")) cliParseError(`unknown option: ${arg}`);
    args.push(arg);
  }
  assertOperandArity(command, args);

  return { command, args, options: { target, dryRun }, json };
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
  // A vanished source root is reported truthfully as source_missing (R10c).
  // Previously loadManifest inferred a phantom manifest from the nonexistent
  // path (basename name, version "0.0.0") and DRIFT surfaced as a bogus
  // version comparison.
  const sourceRootExists = await exists(extension.source.path);
  const currentManifest = sourceRootExists ? await loadManifest(extension.source.path).catch(() => null) : null;
  const currentCommit = await gitCommit(extension.source.path);
  const findings = await classifyInstalledFiles(projectRoot, extension, managedRoots);
  if (!sourceRootExists) findings.source_missing.unshift(extension.source.path);
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

export async function main(): Promise<void> {
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
