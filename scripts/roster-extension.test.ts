import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { info, install, list, remove, converge } from "./roster-extension.js";
import {
  makeProject,
  makeExtension,
  makeRegistryEntry,
  makeSkillPack,
  makeApparatus,
  writeHarness,
  writeRegistry,
  runCli as runFixtureCli,
  tempRoot,
  write,
  VALID_SHA,
  type CliResult,
} from "./extension-fixture.js";

const execFileAsync = promisify(execFile);

async function runCli(args: string[]): Promise<CliResult> {
  return runFixtureCli(args, __dirname);
}

const tempDir = tempRoot;

describe("roster-extension CLI argument parsing", () => {
  it("rejects --target with a missing value and prints usage", async () => {
    const result = await runCli(["list", "--target"]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--target requires a value/);
    assert.match(result.stderr, /Usage: roster-extension/);
  });

  it("rejects --target followed by another option instead of a value", async () => {
    const result = await runCli(["install", "some-extension", "--target", "--dry-run"]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--target requires a value/);
    assert.match(result.stderr, /Usage: roster-extension/);
  });

  it("rejects unknown options such as --dryrun", async () => {
    const result = await runCli(["list", "--dryrun"]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /unknown option: --dryrun/);
    assert.match(result.stderr, /Usage: roster-extension/);
  });
});

describe("roster-extension manifest inference", () => {
  it("infers a multi-skill pack from plugin metadata and skills/*/SKILL.md", async () => {
    const root = await tempDir();
    await makeSkillPack(root);

    const manifest = await info(root);

    assert.equal(manifest.name, "security-workflows");
    assert.equal(manifest.version, "1.57.0");
    assert.equal(manifest.type, "skill-pack");
    assert.deepEqual(
      manifest.components.skills.map((skill) => skill.name).sort(),
      ["security-hunt", "security-review"],
    );
  });

  it("infers apparatus when profiles or project templates are present", async () => {
    const root = await tempDir();
    await makeApparatus(root);

    const manifest = await info(root);

    assert.equal(manifest.name, "verification-apparatus");
    assert.equal(manifest.type, "apparatus");
    assert.equal(manifest.components.profiles[0].name, "example-host");
    assert.equal(manifest.components.templates[0].name, "STATUS.md");
  });
});

describe("roster-extension install lifecycle", () => {
  it("installs skill directories, records hashes, detects drift, and removes tracked files only", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);

    const installed = await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.equal(installed.name, "security-workflows");
    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills/security-hunt/SKILL.md")));
    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills/security-hunt/reference.md")));
    assert.ok(await fs.stat(path.join(projectRoot, ".harness/extensions.json")));

    const installedList = await list(projectRoot);
    assert.equal(installedList.length, 1);
    assert.equal(installedList[0].installed_files.some((file) => file.target.endsWith("reference.md")), true);

    assert.deepEqual(
      (await converge(projectRoot)).map((report) => report.status),
      ["OK"],
    );

    await fs.writeFile(path.join(projectRoot, ".agents/skills/security-hunt/reference.md"), "# Local edit\n");
    const drift = await converge(projectRoot);
    assert.equal(drift[0].status, "DRIFT");
    assert.deepEqual(drift[0].modified, [".agents/skills/security-hunt/reference.md"]);

    await fs.copyFile(
      path.join(extensionRoot, "skills/security-hunt/reference.md"),
      path.join(projectRoot, ".agents/skills/security-hunt/reference.md"),
    );
    const removed = await remove("security-workflows", { target: projectRoot, dryRun: false });
    assert.equal(removed?.name, "security-workflows");
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/security-hunt/SKILL.md")));
    assert.equal((await list(projectRoot)).length, 0);
  });

  it("supports dry-run install without writing project files", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);

    const installed = await install(extensionRoot, { target: projectRoot, dryRun: true });

    assert.equal(installed.installed_files.length > 0, true);
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/security-hunt/SKILL.md")));
  });

  it("uses the enabled custom runtime entrypoint from harness.json", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await writeHarness(projectRoot, ".custom/agent-skills");

    await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.ok(await fs.stat(path.join(projectRoot, ".custom/agent-skills/security-hunt/SKILL.md")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/security-hunt/SKILL.md")));
  });

  it("migrates an existing extension when its runtime entrypoint changes", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await writeHarness(projectRoot, ".old/skills");
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await writeHarness(projectRoot, ".new/skills");

    await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.ok(await fs.stat(path.join(projectRoot, ".new/skills/security-hunt/SKILL.md")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".old/skills/security-hunt/SKILL.md")));
  });

  it("refuses to overwrite an unowned skill target", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await write(path.join(projectRoot, ".agents/skills/security-hunt/SKILL.md"), "# Existing local skill\n");

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /refusing to overwrite unowned target/,
    );
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
  });

  it("refuses to remove a locally modified installed file", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await fs.writeFile(path.join(projectRoot, ".agents/skills/security-hunt/reference.md"), "# Local edit\n");

    await assert.rejects(
      remove("security-workflows", { target: projectRoot, dryRun: false }),
      /refusing to remove locally modified installed file/,
    );
    assert.equal((await list(projectRoot)).length, 1);
  });

  it("refuses to overwrite a locally modified file during reinstall", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await fs.writeFile(path.join(projectRoot, ".agents/skills/security-hunt/reference.md"), "# Local edit\n");

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /refusing to overwrite locally modified installed file/,
    );
  });

  it("detects source-file drift without a version or commit change", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await fs.writeFile(path.join(extensionRoot, "skills/security-hunt/reference.md"), "# Source edit\n");

    const reports = await converge(projectRoot);

    assert.equal(reports[0].status, "DRIFT");
    assert.deepEqual(reports[0].source_modified, ["skills/security-hunt/reference.md"]);
  });

  it("preflights all removals before deleting any file", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await fs.writeFile(path.join(projectRoot, ".agents/skills/security-review/SKILL.md"), "# Local edit\n");

    await assert.rejects(
      remove("security-workflows", { target: projectRoot, dryRun: false }),
      /refusing to remove locally modified installed file/,
    );
    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills/security-hunt/SKILL.md")));
  });

  it("rejects runtime targets beneath symlinked directories", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    const outsideRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await fs.mkdir(path.join(projectRoot, ".agents"), { recursive: true });
    await fs.symlink(outsideRoot, path.join(projectRoot, ".agents/skills"), "dir");

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /refusing target beneath symlinked directory/,
    );
    assert.deepEqual(await fs.readdir(outsideRoot), []);
  });

  it("refuses reinstall when a managed file is replaced by a symlink", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    const outsideRoot = await tempDir();
    const outsideFile = path.join(outsideRoot, "outside.md");
    await makeSkillPack(extensionRoot);
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await write(outsideFile, "# Outside\n");
    const target = path.join(projectRoot, ".agents/skills/security-hunt/reference.md");
    await fs.rm(target);
    await fs.symlink(outsideFile, target);

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /refusing symlinked extension target/,
    );
    assert.equal(await fs.readFile(outsideFile, "utf8"), "# Outside\n");
  });

  it("refuses removal through a symlinked runtime directory", async () => {
    const projectRoot = await tempDir();
    const outsideRoot = await tempDir();
    const outsideFile = path.join(outsideRoot, "security-hunt/SKILL.md");
    await write(outsideFile, "# Outside\n");
    await fs.mkdir(path.join(projectRoot, ".agents"), { recursive: true });
    await fs.symlink(outsideRoot, path.join(projectRoot, ".agents/skills"), "dir");
    const digest = crypto.createHash("sha256").update("# Outside\n").digest("hex");
    await write(
      path.join(projectRoot, ".harness/extensions.json"),
      JSON.stringify({
        schema_version: "1.0",
        extensions: [
          {
            schema_version: "1.0",
            name: "security-workflows",
            version: "1.0.0",
            type: "skill-pack",
            description: "",
            runtime_targets: ["codex"],
            components: { skills: [], agents: [], hooks: [], profiles: [], templates: [], tools: [], workflows: [] },
            source: { path: outsideRoot, git_commit: null },
            runtime_roots: [".agents/skills"],
            installed_at: new Date().toISOString(),
            installed_files: [
              { source: "skills/security-hunt/SKILL.md", target: ".agents/skills/security-hunt/SKILL.md", sha256: digest },
            ],
          },
        ],
      }),
    );

    await assert.rejects(
      remove("security-workflows", { target: projectRoot, dryRun: false }),
      /refusing target beneath symlinked directory/,
    );
    assert.equal(await fs.readFile(outsideFile, "utf8"), "# Outside\n");
  });

  it("rejects unsupported explicit manifest schema versions", async () => {
    const extensionRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await write(
      path.join(extensionRoot, "roster-extension.json"),
      JSON.stringify({ schema_version: "2.0", name: "security-workflows", version: "2.0.0" }),
    );

    await assert.rejects(info(extensionRoot), /unsupported roster-extension.json schema_version/);
  });

  it("rejects unsupported explicit runtime targets", async () => {
    const extensionRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await write(
      path.join(extensionRoot, "roster-extension.json"),
      JSON.stringify({
        schema_version: "1.0",
        name: "security-workflows",
        version: "2.0.0",
        runtime_targets: ["claude"],
      }),
    );

    await assert.rejects(info(extensionRoot), /unsupported runtime target in manifest/);
  });

  it("rejects non-string explicit runtime targets", async () => {
    const extensionRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await write(
      path.join(extensionRoot, "roster-extension.json"),
      JSON.stringify({
        schema_version: "1.0",
        name: "security-workflows",
        version: "2.0.0",
        runtime_targets: [1],
      }),
    );

    await assert.rejects(info(extensionRoot), /runtime_targets entries must be strings/);
  });

  it("rejects duplicate skill targets before writing anything", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await write(
      path.join(extensionRoot, "skills/duplicate/SKILL.md"),
      "---\nname: security-hunt\nversion: 1.0.0\n---\n# Duplicate\n",
    );

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /extension produces duplicate target/,
    );
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/security-hunt/SKILL.md")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
  });

  it("serializes concurrent installs so both registry entries survive", async () => {
    const firstRoot = await tempDir();
    const secondRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(firstRoot);
    await makeSkillPack(secondRoot);
    await write(
      path.join(secondRoot, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "review-workflows", version: "1.0.0", description: "Review workflows" }),
    );
    await fs.rename(
      path.join(secondRoot, "skills/security-hunt"),
      path.join(secondRoot, "skills/review-hunt"),
    );
    await fs.rename(
      path.join(secondRoot, "skills/security-review"),
      path.join(secondRoot, "skills/review-review"),
    );
    await write(
      path.join(secondRoot, "skills/review-hunt/SKILL.md"),
      "---\nname: review-hunt\nversion: 1.0.0\n---\n# Review Hunt\n",
    );
    await write(
      path.join(secondRoot, "skills/review-review/SKILL.md"),
      "---\nname: review-review\nversion: 1.0.0\n---\n# Review Review\n",
    );

    const results = await Promise.allSettled([
      install(firstRoot, { target: projectRoot, dryRun: false }),
      install(secondRoot, { target: projectRoot, dryRun: false }),
    ]);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assert.deepEqual(
      (await list(projectRoot)).map((entry) => entry.name).sort(),
      ["review-workflows", "security-workflows"],
    );
  });

  it("rejects targets owned by another extension even when its files are missing", async () => {
    const firstRoot = await tempDir();
    const secondRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(firstRoot);
    await makeSkillPack(secondRoot);
    await write(
      path.join(secondRoot, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "other-workflows", version: "1.0.0", description: "Other workflows" }),
    );
    await install(firstRoot, { target: projectRoot, dryRun: false });
    await fs.rm(path.join(projectRoot, ".agents/skills/security-hunt"), { recursive: true });
    await fs.rm(path.join(projectRoot, ".agents/skills/security-review"), { recursive: true });

    await assert.rejects(
      install(secondRoot, { target: projectRoot, dryRun: false }),
      /target is owned by another extension/,
    );
  });

  it("reclaims a stale lock left by a dead process", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await write(
      path.join(projectRoot, ".harness/extensions.lock/owner.json"),
      JSON.stringify({ pid: 2147483647, acquired_at: Date.now() - 60_000 }),
    );

    const installed = await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.equal(installed.name, "security-workflows");
  });

  it("converge exits nonzero on drift in text and JSON modes", async () => {
    const extensionRoot = await tempDir();
    const projectRoot = await tempDir();
    await makeSkillPack(extensionRoot);
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await fs.writeFile(path.join(projectRoot, ".agents/skills/security-hunt/reference.md"), "# Drift\n");
    const cli = path.resolve(__dirname, "roster-extension.js");

    await assert.rejects(execFileAsync(process.execPath, [cli, "converge", "--target", projectRoot]));
    await assert.rejects(execFileAsync(process.execPath, [cli, "converge", "--target", projectRoot, "--json"]));
  });

  it("ships an executable wrapper for clean-checkout CLI use", async () => {
    const wrapper = path.resolve(__dirname, "../../scripts/roster-extension.sh");
    const stat = await fs.stat(wrapper);
    assert.equal((stat.mode & 0o111) !== 0, true);
    const { stdout } = await execFileAsync(wrapper, ["--help"]);
    assert.match(stdout, /Usage: roster-extension/);
  });
});

describe("roster-extension runtime gating and projections", () => {
  it("rejects install when the requested runtime is disabled in harness.json", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "gated-pack", version: "1.0.0" },
      skills: [{ dir: "gated-skill", name: "gated-skill" }],
    });
    const projectRoot = await makeProject([
      { name: "codex", enabled: false, entrypoint: ".agents/skills" },
      { name: "opencode", enabled: false, entrypoint: ".opencode" },
    ]);

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /requested extension runtime is not enabled in .harness\/harness.json: codex/,
    );
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
  });

  it("projects skills into .opencode/skills/<name> for an enabled opencode runtime", async () => {
    const extensionRoot = await makeExtension({
      manifest: {
        schema_version: "1.0",
        name: "opencode-pack",
        version: "1.0.0",
        runtime_targets: ["opencode"],
      },
      skills: [{ dir: "oc-skill", name: "oc-skill" }],
    });
    const projectRoot = await makeProject([
      { name: "codex", enabled: false, entrypoint: ".agents/skills" },
      { name: "opencode", enabled: true, entrypoint: ".opencode" },
    ]);

    await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.ok(await fs.stat(path.join(projectRoot, ".opencode/skills/oc-skill/SKILL.md")));
    assert.ok(await fs.stat(path.join(projectRoot, ".opencode/skills/oc-skill/.roster-extension")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/oc-skill/SKILL.md")));
  });
});

describe("roster-extension explicit manifest and fallbacks", () => {
  it("lets an explicit roster-extension.json drive name, version, and type", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "plugin-name-ignored", version: "0.1.0" },
      manifest: {
        schema_version: "1.0",
        name: "explicit-pack",
        version: "9.9.9",
        type: "skill-pack",
        description: "Explicit manifest pack",
      },
      skills: [{ dir: "explicit-skill", name: "explicit-skill" }],
    });
    const projectRoot = await makeProject();

    const manifest = await info(extensionRoot);
    assert.equal(manifest.name, "explicit-pack");
    assert.equal(manifest.version, "9.9.9");
    assert.equal(manifest.type, "skill-pack");
    assert.equal(manifest.description, "Explicit manifest pack");

    await install(extensionRoot, { target: projectRoot, dryRun: false });
    const entries = await list(projectRoot);
    assert.equal(entries[0].name, "explicit-pack");
    assert.equal(entries[0].version, "9.9.9");
  });

  it("falls back to the VERSION file, then to 0.0.0, when no manifest version exists", async () => {
    const withVersionFile = await makeExtension({
      dirName: "version-file-pack",
      versionFile: "3.2.1",
      skills: [{ dir: "vf-skill", name: "vf-skill" }],
    });
    const bare = await makeExtension({
      dirName: "bare-pack",
      skills: [{ dir: "bare-skill", name: "bare-skill" }],
    });

    assert.equal((await info(withVersionFile)).version, "3.2.1");
    assert.equal((await info(withVersionFile)).name, "version-file-pack");
    assert.equal((await info(bare)).version, "0.0.0");
  });
});

describe("roster-extension name validation", () => {
  it("rejects an unsafe extension name", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "Bad Name", version: "1.0.0" },
      skills: [{ dir: "some-skill", name: "some-skill" }],
    });

    await assert.rejects(info(extensionRoot), /extension name must be a safe lowercase name/);
  });

  it("rejects an unsafe skill name", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "ok-pack", version: "1.0.0" },
      skills: [{ dir: "some-skill", name: "Bad Skill" }],
    });

    await assert.rejects(info(extensionRoot), /skill name must be a safe lowercase name/);
  });
});

describe("roster-extension remove --dry-run", () => {
  it("reports the removal without touching registry or disk", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "dryrun-pack", version: "1.0.0" },
      skills: [{ dir: "dr-skill", name: "dr-skill" }],
    });
    const projectRoot = await makeProject();
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    const registryPath = path.join(projectRoot, ".harness/extensions.json");
    const registryBefore = await fs.readFile(registryPath, "utf8");

    const result = await runCli(["remove", "dryrun-pack", "--target", projectRoot, "--dry-run"]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /would remove dryrun-pack/);
    assert.equal(await fs.readFile(registryPath, "utf8"), registryBefore);
    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills/dr-skill/SKILL.md")));
    assert.equal((await list(projectRoot)).length, 1);
  });
});

describe("roster-extension converge drift matrix", () => {
  async function installedSkillPack(): Promise<{ extensionRoot: string; projectRoot: string }> {
    const extensionRoot = await makeExtension({
      plugin: { name: "drift-pack", version: "1.0.0" },
      skills: [{ dir: "drift-skill", name: "drift-skill", extraFiles: { "reference.md": "# Reference\n" } }],
    });
    const projectRoot = await makeProject();
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    return { extensionRoot, projectRoot };
  }

  it("reports a missing installed file", async () => {
    const { projectRoot } = await installedSkillPack();
    await fs.rm(path.join(projectRoot, ".agents/skills/drift-skill/reference.md"));

    const reports = await converge(projectRoot);

    assert.equal(reports[0].status, "DRIFT");
    assert.deepEqual(reports[0].missing, [".agents/skills/drift-skill/reference.md"]);
  });

  it("reports a deleted source file as source_missing", async () => {
    const { extensionRoot, projectRoot } = await installedSkillPack();
    await fs.rm(path.join(extensionRoot, "skills/drift-skill/reference.md"));

    const reports = await converge(projectRoot);

    assert.equal(reports[0].status, "DRIFT");
    assert.deepEqual(reports[0].source_missing, ["skills/drift-skill/reference.md"]);
  });

  it("reports a source version change", async () => {
    const { extensionRoot, projectRoot } = await installedSkillPack();
    await write(
      path.join(extensionRoot, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "drift-pack", version: "1.1.0" }),
    );

    const reports = await converge(projectRoot);

    assert.equal(reports[0].status, "DRIFT");
    assert.equal(reports[0].installed_version, "1.0.0");
    assert.equal(reports[0].source_version, "1.1.0");
    assert.deepEqual(reports[0].missing, []);
    assert.deepEqual(reports[0].modified, []);
  });

  it("reports a source commit change", async () => {
    const { extensionRoot, projectRoot } = await installedSkillPack();
    const git = (args: string[]) => execFileAsync("git", ["-C", extensionRoot, ...args]);
    await git(["init", "-q"]);
    await git(["add", "-A"]);
    await git(["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"]);

    const reports = await converge(projectRoot);

    assert.equal(reports[0].status, "DRIFT");
    assert.equal(reports[0].installed_commit, null);
    assert.notEqual(reports[0].source_commit, null);
    assert.deepEqual(reports[0].modified, []);
  });
});

describe("roster-extension recorded-only packs", () => {
  it("rejects a skills tree that resolves to no installable skills", async () => {
    const projectRoot = await makeProject();

    const emptySkills = await makeExtension({
      plugin: { name: "empty-skills", version: "1.0.0", description: "Empty skills dir" },
    });
    await fs.mkdir(path.join(emptySkills, "skills"), { recursive: true });
    await assert.rejects(install(emptySkills, { target: projectRoot, dryRun: false }), /no installable skills/);

    const straySkills = await makeExtension({
      plugin: { name: "stray-skills", version: "1.0.0", description: "Skill dir without SKILL.md" },
    });
    await write(path.join(straySkills, "skills/foo/reference.md"), "# not a skill\n");
    await assert.rejects(install(straySkills, { target: projectRoot, dryRun: false }), /no installable skills/);
  });

  it("registers a profiles-only pack, lists it, converges with an advisory, and removes it", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "host-profiles", version: "2.0.0", description: "Profiles only" },
      profiles: ["host-a", "host-b"],
    });
    const projectRoot = await makeProject();

    const installed = await install(extensionRoot, { target: projectRoot, dryRun: false });
    assert.equal(installed.name, "host-profiles");
    assert.equal(installed.type, "apparatus");
    assert.deepEqual(installed.installed_files, []);
    assert.ok(await fs.stat(path.join(projectRoot, ".harness/extensions.json")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents")));

    const listResult = await runCli(["list", "--target", projectRoot]);
    assert.equal(listResult.code, 0);
    assert.match(listResult.stdout, /host-profiles 2\.0\.0 \(apparatus\)/);

    const cleanJson = await runCli(["converge", "--target", projectRoot, "--json"]);
    assert.equal(cleanJson.code, 0);
    const cleanReports = JSON.parse(cleanJson.stdout) as Record<string, unknown>[];
    assert.equal(cleanReports[0].status, "OK");
    assert.equal(cleanReports[0].recorded_only, true);

    const cleanText = await runCli(["converge", "--target", projectRoot]);
    assert.equal(cleanText.code, 0);
    assert.match(cleanText.stdout, /host-profiles: OK/);
    assert.match(cleanText.stdout, /recorded-only/);

    await write(
      path.join(extensionRoot, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "host-profiles", version: "2.1.0", description: "Profiles only" }),
    );
    const drifted = await runCli(["converge", "--target", projectRoot, "--json"]);
    assert.notEqual(drifted.code, 0);
    const driftedReports = JSON.parse(drifted.stdout) as Record<string, unknown>[];
    assert.equal(driftedReports[0].status, "DRIFT");
    assert.equal(driftedReports[0].recorded_only, true);

    const removed = await remove("host-profiles", { target: projectRoot, dryRun: false });
    assert.equal(removed?.name, "host-profiles");
    assert.equal((await list(projectRoot)).length, 0);
  });

  it("does not report the advisory for a normal skill pack", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "normal-pack", version: "1.0.0" },
      skills: [{ dir: "np-skill", name: "np-skill" }],
    });
    const projectRoot = await makeProject();
    await install(extensionRoot, { target: projectRoot, dryRun: false });

    const result = await runCli(["converge", "--target", projectRoot, "--json"]);

    assert.equal(result.code, 0);
    const reports = JSON.parse(result.stdout) as Record<string, unknown>[];
    assert.equal(reports[0].recorded_only, false);
  });

  it("still runs registry validation on the empty install path", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "host-profiles", version: "2.0.0" },
      profiles: ["host-a"],
    });
    const projectRoot = await makeProject();
    await writeRegistry(projectRoot, [
      makeRegistryEntry("twin-pack", [
        { source: "skills/a/SKILL.md", target: ".agents/skills/a/SKILL.md", sha256: VALID_SHA },
      ]),
      makeRegistryEntry("twin-pack", [
        { source: "skills/b/SKILL.md", target: ".agents/skills/b/SKILL.md", sha256: VALID_SHA },
      ]),
    ]);

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /duplicate extension name: twin-pack/,
    );
  });
});

describe("roster-extension corrupt registry rejection", () => {
  it("rejects duplicate extension names", async () => {
    const projectRoot = await makeProject();
    await writeRegistry(projectRoot, [
      makeRegistryEntry("twin-pack", [
        { source: "skills/a/SKILL.md", target: ".agents/skills/a/SKILL.md", sha256: VALID_SHA },
      ]),
      makeRegistryEntry("twin-pack", [
        { source: "skills/b/SKILL.md", target: ".agents/skills/b/SKILL.md", sha256: VALID_SHA },
      ]),
    ]);

    await assert.rejects(list(projectRoot), /duplicate extension name: twin-pack/);
  });

  it("rejects duplicate owned targets across extensions", async () => {
    const projectRoot = await makeProject();
    const sharedTarget = { source: "skills/a/SKILL.md", target: ".agents/skills/a/SKILL.md", sha256: VALID_SHA };
    await writeRegistry(projectRoot, [
      makeRegistryEntry("first-pack", [sharedTarget]),
      makeRegistryEntry("second-pack", [sharedTarget]),
    ]);

    await assert.rejects(list(projectRoot), /duplicate owned target/);
  });

  it("rejects a malformed sha256 on an installed file", async () => {
    const projectRoot = await makeProject();
    await writeRegistry(projectRoot, [
      makeRegistryEntry("bad-sha-pack", [
        { source: "skills/a/SKILL.md", target: ".agents/skills/a/SKILL.md", sha256: "not-a-sha" },
      ]),
    ]);

    await assert.rejects(list(projectRoot), /contains an invalid installed file/);
  });
});
