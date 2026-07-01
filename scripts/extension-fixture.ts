// Test fixture helpers for roster-extension tests.
// All extension/project layout knowledge for the new seam tests lives here, so the
// tests themselves only exercise the public surface (spawned CLI or public exports).
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CliResult = { code: number; stdout: string; stderr: string };

export type RuntimeFixture = { name: string; enabled: boolean; entrypoint: string };

export type SkillFixture = {
  dir: string;
  name?: string;
  version?: string;
  description?: string;
  extraFiles?: Record<string, string>;
};

export type ExtensionFixtureOptions = {
  dirName?: string;
  plugin?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  versionFile?: string;
  skills?: SkillFixture[];
  profiles?: string[];
  templates?: string[];
};

export async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

export async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "roster-extension-fixture-"));
}

// Creates a temp project root. When `runtimes` is given, writes
// .harness/harness.json with exactly those runtime entries (injectable enablement).
export async function makeProject(runtimes?: RuntimeFixture[]): Promise<string> {
  const root = await tempRoot();
  if (runtimes) {
    await write(path.join(root, ".harness/harness.json"), JSON.stringify({ runtimes }));
  }
  return root;
}

function skillMarkdown(skill: SkillFixture): string {
  const lines = ["---"];
  if (skill.name) lines.push(`name: ${skill.name}`);
  lines.push(`version: ${skill.version ?? "1.0.0"}`);
  if (skill.description) lines.push(`description: ${skill.description}`);
  lines.push("---", `# ${skill.name ?? skill.dir}`, "");
  return lines.join("\n");
}

// Writes extension content into an existing root. Shared by makeExtension (fresh
// temp root) and the canned pack builders (caller-provided root).
async function writeExtensionInto(root: string, options: ExtensionFixtureOptions): Promise<void> {
  if (options.plugin) {
    await write(path.join(root, ".claude-plugin/plugin.json"), JSON.stringify(options.plugin));
  }
  if (options.manifest) {
    await write(path.join(root, "roster-extension.json"), JSON.stringify(options.manifest));
  }
  if (options.versionFile) {
    await write(path.join(root, "VERSION"), `${options.versionFile}\n`);
  }
  for (const skill of options.skills ?? []) {
    await write(path.join(root, "skills", skill.dir, "SKILL.md"), skillMarkdown(skill));
    for (const [rel, content] of Object.entries(skill.extraFiles ?? {})) {
      await write(path.join(root, "skills", skill.dir, rel), content);
    }
  }
  for (const profile of options.profiles ?? []) {
    await write(path.join(root, "profiles", `${profile}.md`), `# ${profile}\n`);
  }
  for (const template of options.templates ?? []) {
    await write(path.join(root, "project-template", `${template}.template`), `# ${template}\n`);
  }
}

// Fabricates an extension source directory. The extension lives in a safe-named
// subdirectory (mkdtemp basenames may contain uppercase, which the installer's
// name fallback would reject).
export async function makeExtension(options: ExtensionFixtureOptions = {}): Promise<string> {
  const root = path.join(await tempRoot(), options.dirName ?? "fixture-ext");
  await fs.mkdir(root, { recursive: true });
  await writeExtensionInto(root, options);
  return root;
}

// Canned multi-skill pack used by the legacy lifecycle tests (migrated from
// roster-extension.test.ts local builders — scenario preserved 1:1).
export async function makeSkillPack(root: string): Promise<void> {
  await writeExtensionInto(root, {
    plugin: { name: "security-workflows", version: "1.57.0", description: "Security workflow skills" },
    skills: [
      {
        dir: "security-hunt",
        name: "security-hunt",
        version: "1.0.0",
        description: "Hunt for invariant violations.",
        extraFiles: { "reference.md": "# Reference\n" },
      },
      { dir: "security-review", name: "security-review", version: "1.0.0" },
    ],
  });
}

// Canned apparatus pack (skills + profiles + project templates) — migrated 1:1.
export async function makeApparatus(root: string): Promise<void> {
  await writeExtensionInto(root, {
    plugin: { name: "verification-apparatus", version: "1.2.1", description: "Verification project apparatus" },
    skills: [{ dir: "verification-apparatus", name: "verification-apparatus", version: "1.2.1" }],
    profiles: ["example-host"],
    templates: ["STATUS.md"],
  });
}

// Writes a harness manifest with codex enabled at the given entrypoint and
// opencode disabled — migrated 1:1 from the legacy writeHarness builder.
export async function writeHarness(root: string, codexEntrypoint: string): Promise<void> {
  await write(
    path.join(root, ".harness/harness.json"),
    JSON.stringify({
      runtimes: [
        { name: "codex", enabled: true, entrypoint: codexEntrypoint },
        { name: "opencode", enabled: false, entrypoint: ".opencode" },
      ],
    }),
  );
}

// Spawns the compiled CLI and never throws — exit code, stdout, and stderr are
// returned for assertion (exit-code behavior is part of the CLI contract).
export async function runCli(args: string[], cliDir: string): Promise<CliResult> {
  const cli = path.resolve(cliDir, "roster-extension.js");
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

export type RegistryFileFixture = { source: string; target: string; sha256: string };

// A structurally valid registry entry that corrupt-registry tests can then distort.
export function makeRegistryEntry(name: string, installedFiles: RegistryFileFixture[]): Record<string, unknown> {
  return {
    schema_version: "1.0",
    name,
    version: "1.0.0",
    type: "skill-pack",
    description: "",
    runtime_targets: ["codex"],
    components: { skills: [], agents: [], hooks: [], profiles: [], templates: [], tools: [], workflows: [] },
    source: { path: "/nonexistent-extension-source", git_commit: null },
    runtime_roots: [".agents/skills"],
    installed_at: new Date().toISOString(),
    installed_files: installedFiles,
  };
}

export async function writeRegistry(projectRoot: string, extensions: Record<string, unknown>[]): Promise<void> {
  await write(
    path.join(projectRoot, ".harness/extensions.json"),
    JSON.stringify({ schema_version: "1.0", extensions }),
  );
}

export const VALID_SHA = "a".repeat(64);
