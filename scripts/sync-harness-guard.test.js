// Seam tests for sync-harness.sh's extension-ownership guard (audit M7 item 10).
// The script is exercised as a black box against a repo-shaped temp fixture; no
// internals are imported. Assertions use fs, never `ls` (unreliable in this env).
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const SYNC_SCRIPT = path.resolve(__dirname, "sync-harness.sh");
const SKILL_NAME = "guard-skill";

async function write(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

// Minimal repo-shaped fixture: harness manifest with only the codex runtime
// enabled, plus one harness skill source that projects to .agents/skills.
async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sync-harness-guard-"));
  await write(
    path.join(root, ".harness/harness.json"),
    JSON.stringify({
      runtimes: [
        { name: "codex", enabled: true, entrypoint: ".agents/skills" },
        { name: "claude-code", enabled: false, entrypoint: ".claude" },
        { name: "opencode", enabled: false, entrypoint: ".opencode" },
      ],
      layers: { skills: [{ name: SKILL_NAME, version: "1.0.0" }] },
    }),
  );
  await write(
    path.join(root, `.harness/skills/${SKILL_NAME}.md`),
    `---\nname: ${SKILL_NAME}\ndescription: Guard fixture skill.\n---\n# Guard skill\n`,
  );
  return root;
}

async function runSync(root) {
  try {
    const { stdout, stderr } = await execFileAsync("bash", [SYNC_SCRIPT, root]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function runCheck(root, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync("bash", [SYNC_SCRIPT, root, "--check"], options);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function registryOwning(target) {
  return JSON.stringify({
    schema_version: "1.0",
    extensions: [
      {
        name: "guard-pack",
        version: "1.0.0",
        source: { path: "/nonexistent", git_commit: null },
        runtime_roots: [".agents/skills"],
        installed_files: [{ source: "skills/guard-skill/SKILL.md", target, sha256: "0".repeat(64) }],
      },
    ],
  });
}

describe("sync-harness extension-ownership guard", () => {
  it("preserves local preamble fragments and gates friction and pipeline injection", async () => {
    const root = await makeFixture();
    const core = "---\nname: preamble\n---\n# Consumer core preamble\n";
    const friction = "---\nname: preamble-friction\n---\n### Friction Log\nConsumer friction definition\n";
    await write(path.join(root, "skills/shared/preamble.md"), core);
    await write(path.join(root, "skills/shared/preamble-friction.md"), friction);
    const skill = (enabled) => `---\nname: ${SKILL_NAME}\npreamble: true\nphase: null\nfriction_log: ${enabled}\n---\n# Guard\n`;
    await write(path.join(root, `.harness/skills/${SKILL_NAME}.md`), skill(true));
    assert.equal((await runSync(root)).code, 0);
    const projected = path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`);
    const first = await fs.readFile(projected, "utf8");
    assert.match(first, /Consumer core preamble/);
    assert.match(first, /Consumer friction definition/);
    assert.doesNotMatch(first, /Pipeline State/);
    assert.equal(await fs.readFile(path.join(root, "skills/shared/preamble.md"), "utf8"), core);
    assert.equal(await fs.readFile(path.join(root, "skills/shared/preamble-friction.md"), "utf8"), friction);
    await fs.unlink(path.join(root, "skills/shared/preamble.md"));
    assert.equal((await runSync(root)).code, 0);
    const fragmentOnly = await fs.readFile(projected, "utf8");
    assert.match(fragmentOnly, /# Roster Preamble/);
    assert.match(fragmentOnly, /Consumer friction definition/);
    await write(path.join(root, `.harness/skills/${SKILL_NAME}.md`), skill(false));
    assert.equal((await runSync(root)).code, 0);
    assert.doesNotMatch(await fs.readFile(projected, "utf8"), /Consumer friction definition|Pipeline State/);
  });
  it("fails clearly when required friction definitions are unavailable", async () => {
    for (const corePresent of [false, true]) {
      const root = await makeFixture();
      const isolatedScript = path.join(root, "roster/scripts/sync-harness.sh");
      await write(isolatedScript, await fs.readFile(SYNC_SCRIPT, "utf8"));
      if (corePresent) await write(path.join(root, "roster/skills/shared/preamble.md"), "# Core\n");
      await write(path.join(root, `.harness/skills/${SKILL_NAME}.md`),
        `---\nname: ${SKILL_NAME}\npreamble: true\nfriction_log: true\n---\n# Guard\n`);
      await assert.rejects(execFileAsync("bash", [isolatedScript, root]), (error) => {
        assert.match(error.stderr, /required friction (preamble|template) unavailable/);
        return true;
      });
    }
  });
  it("installs an executable claims reconciler inside an ESM consumer", async () => {
    const root = await makeFixture();
    const rootPackage = '{"type":"module"}\n';
    await write(path.join(root, "package.json"), rootPackage);
    const synced = await runSync(root);
    assert.equal(synced.code, 0, synced.stderr);
    const result = await execFileAsync(process.execPath, [".harness/bin/claims-reconcile.js", "audit", "--root", root], {cwd: root});
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    assert.equal(await fs.readFile(path.join(root, "package.json"), "utf8"), rootPackage);
    const checked = await runCheck(root);
    assert.equal(checked.code, 0, checked.stderr);
    await fs.unlink(path.join(root, ".harness/bin/package.json"));
    const missingScope = await runCheck(root);
    assert.notEqual(missingScope.code, 0);
    assert.match(missingScope.stderr, /package.json is missing or incompatible/);
  });
  it("preserves and rejects a conflicting consumer-owned harness module scope", async () => {
    const root = await makeFixture();
    const scope = '{"type":"module","name":"consumer-tools"}\n';
    await write(path.join(root, ".harness/bin/package.json"), scope);
    const result = await runSync(root);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refusing incompatible module scope/);
    assert.equal(await fs.readFile(path.join(root, ".harness/bin/package.json"), "utf8"), scope);
    await assert.rejects(fs.stat(path.join(root, ".harness/bin/claims-reconcile.js")));
  });
  it("does not reinterpret an unrelated ESM script when adding the harness module scope", async () => {
    const root = await makeFixture();
    await write(path.join(root, "package.json"), '{"type":"module"}\n');
    const script = 'export const value = 42;\n';
    await write(path.join(root, ".harness/bin/user.js"), script);
    await execFileAsync(process.execPath, [".harness/bin/user.js"], {cwd: root});
    const result = await runSync(root);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /unrelated consumer script/);
    await assert.rejects(fs.stat(path.join(root, ".harness/bin/package.json")));
    assert.equal(await fs.readFile(path.join(root, ".harness/bin/user.js"), "utf8"), script);
    await execFileAsync(process.execPath, [".harness/bin/user.js"], {cwd: root});
  });
  // Inverted 2026-07-02 (extension-installer-refactor R6): the registry-branch jq
  // expression is fixed (`any(.extensions[]?.installed_files[]?; ...)`), so a valid
  // registry entry recording the target now refuses the sync as originally intended.
  it("refuses to overwrite a target recorded in a valid registry entry", async () => {
    const root = await makeFixture();
    await write(
      path.join(root, ".harness/extensions.json"),
      registryOwning(`.agents/skills/${SKILL_NAME}/SKILL.md`),
    );

    const result = await runSync(root);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Refusing to overwrite extension-owned skill 'guard-skill'/);
    await assert.rejects(fs.stat(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`)));
  });

  it("refuses to overwrite a skill directory carrying a .roster-extension marker", async () => {
    const root = await makeFixture();
    await write(path.join(root, `.agents/skills/${SKILL_NAME}/.roster-extension`), "guard-pack\n");
    await write(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`), "# Extension-owned\n");

    const result = await runSync(root);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Refusing to overwrite extension-owned skill 'guard-skill'/);
    assert.equal(
      await fs.readFile(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`), "utf8"),
      "# Extension-owned\n",
    );
  });

  it("syncs normally when .harness/extensions.json is absent and no marker exists", async () => {
    const root = await makeFixture();

    const result = await runSync(root);

    assert.equal(result.code, 0, result.stderr);
    const projected = await fs.readFile(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`), "utf8");
    assert.match(projected, /name: guard-skill/);
    assert.ok(await fs.stat(path.join(root, `.agents/skills/${SKILL_NAME}/.roster-managed`)));
  });

  it("sync and check preserve installed-consumer companion docs nested beside projected skills", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.runtimes.find((runtime) => runtime.name === "opencode").enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    const synced = await runSync(root);
    assert.equal(synced.code, 0, synced.stderr);
    for (const runtimeRoot of [".agents/skills", ".opencode/skills"]) {
      await write(
        path.join(root, runtimeRoot, SKILL_NAME, "required-companion.md"),
        "# Required installed companion\n",
      );
    }

    const resynced = await runSync(root);
    assert.equal(resynced.code, 0, resynced.stderr);
    for (const runtimeRoot of [".agents/skills", ".opencode/skills"]) {
      assert.equal(
        await fs.readFile(path.join(root, runtimeRoot, SKILL_NAME, "required-companion.md"), "utf8"),
        "# Required installed companion\n",
      );
    }

    const checked = await runCheck(root);
    assert.equal(checked.code, 0, checked.stderr);
    assert.doesNotMatch(checked.stderr, /stale projection/);
  });

  // Flat files in overwrite-only directories have no provenance record. An extra
  // local agent is ambiguous, not an ownership-safe stale managed projection.
  it("check reports an unattributed local flat file without recommending removal", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    for (const runtime of manifest.runtimes) runtime.enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const synced = await runSync(root);
    assert.equal(synced.code, 0, synced.stderr);
    const localFiles = [".claude/agents/local-agent.md", ".claude/rules/local-rule.md", ".opencode/agents/local-agent.md"];
    for (const file of localFiles) await write(path.join(root, file), "# Project-owned content\n");

    const checked = await runCheck(root);
    assert.notEqual(checked.code, 0);
    assert.match(checked.stderr, /unattributed extra file/);
    assert.doesNotMatch(checked.stderr, /To clean up:|rm -f/);
    for (const file of localFiles) {
      assert.ok(checked.stderr.includes(file), checked.stderr);
      assert.equal(await fs.readFile(path.join(root, file), "utf8"), "# Project-owned content\n");
    }
  });

  it("keeps removed-source failures conservative in every overwrite-only flat directory", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    for (const runtime of manifest.runtimes) runtime.enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const sources = [".harness/agents/retired-agent.md", ".harness/rules/retired-rule.md"];
    for (const source of sources) await write(path.join(root, source), "---\nname: retired\ndescription: Previously generated\n---\n# Retired\n");
    const synced = await runSync(root); assert.equal(synced.code, 0, synced.stderr);
    const targets = [".claude/agents/retired-agent.md", ".claude/rules/retired-rule.md", ".opencode/agents/retired-agent.md"];
    const before = await Promise.all(targets.map(file => fs.readFile(path.join(root, file), "utf8")));
    for (const source of sources) await fs.unlink(path.join(root, source));
    const checked = await runCheck(root);
    assert.notEqual(checked.code, 0);
    assert.match(checked.stderr, /unattributed extra file/);
    assert.match(checked.stderr, /local content or projections of removed sources/);
    assert.doesNotMatch(checked.stderr, /To clean up:|rm -f/);
    assert.equal((await runSync(root)).code, 0);
    for (const [index, file] of targets.entries()) {
      assert.ok(checked.stderr.includes(file), checked.stderr);
      assert.equal(await fs.readFile(path.join(root, file), "utf8"), before[index]);
    }
  });

  it("detects local flat extras with diff-quoted names without removal advice", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    for (const runtime of manifest.runtimes) runtime.enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await runSync(root)).code, 0);
    const directories = [".claude/agents", ".claude/rules", ".opencode/agents"];
    for (const name of ["local agent.md", "local: agent.md", "local\nagent.md", "local\tagent.md", "local'agent.md", ".hidden.md", ".md"]) {
      for (const dir of directories) await write(path.join(root, dir, name), "# User file\n");
      const checked = await runCheck(root);
      assert.notEqual(checked.code, 0, `unreported extra ${JSON.stringify(name)}: ${checked.stderr}`);
      assert.match(checked.stderr, /unattributed extra file/);
      assert.doesNotMatch(checked.stderr, /To clean up:|rm -f/);
      for (const dir of directories) {
        assert.ok(checked.stderr.includes(dir + "/"), checked.stderr);
        assert.equal(await fs.readFile(path.join(root, dir, name), "utf8"), "# User file\n");
        await fs.unlink(path.join(root, dir, name));
      }
      if (name.includes("\n")) assert.match(checked.stderr, /local\\nagent\.md/);
      if (name.includes("\t")) assert.match(checked.stderr, /local\\tagent\.md/);
    }
  });

  it("detects a generated-then-removed flat rule with spaces and colon in its name", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.runtimes.find(runtime => runtime.name === "claude-code").enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const source = path.join(root, ".harness/rules/retired: local rule.md");
    await write(source, "# Previously projected rule\n");
    assert.equal((await runSync(root)).code, 0);
    await fs.unlink(source);
    const checked = await runCheck(root);
    assert.notEqual(checked.code, 0, checked.stderr);
    assert.match(checked.stderr, /unattributed extra file/);
    assert.doesNotMatch(checked.stderr, /To clean up:|rm -f/);
    assert.equal(await fs.readFile(path.join(root, ".claude/rules/retired: local rule.md"), "utf8"), "# Previously projected rule\n");
  });

  it("reports flat extras beneath a root containing spaces and regex metacharacters", async () => {
    const original = await makeFixture(), root = `${original} [project]: local`;
    await fs.rename(original, root);
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    for (const runtime of manifest.runtimes) runtime.enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await runSync(root)).code, 0);
    for (const dir of [".claude/agents", ".claude/rules", ".opencode/agents"]) await write(path.join(root, dir, "local agent.md"), "# Keep\n");
    const checked = await runCheck(root);
    assert.notEqual(checked.code, 0);
    assert.match(checked.stderr, /unattributed extra file/);
    assert.doesNotMatch(checked.stderr, /To clean up:|rm -f/);
  });

  it("reports dangling flat file links and directory links without target inspection", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.runtimes.find(runtime => runtime.name === "codex").enabled = false;
    manifest.runtimes.find(runtime => runtime.name === "claude-code").enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await runSync(root)).code, 0);
    const link = path.join(root, ".claude/agents/local agent.md");
    const absent = path.join(root, "absent-target.md"); await fs.symlink(absent, link);
    let checked = await runCheck(root);
    assert.notEqual(checked.code, 0); assert.match(checked.stderr, /unattributed extra file/);
    assert.doesNotMatch(checked.stderr, /To clean up:|rm -f/);
    assert.equal(await fs.readlink(link), absent);
    const probeDir = path.join(root, "probe-bin");
    await write(path.join(probeDir, "diff"), "#!/bin/sh\nprintf 'DIFF_WAS_CALLED\\n' >&2\nexit 42\n");
    await fs.chmod(path.join(probeDir, "diff"), 0o700);
    const options = { env: { ...process.env, PATH: `${probeDir}${path.delimiter}${process.env.PATH}` } };
    assert.match((await runCheck(root, options)).stderr, /DIFF_WAS_CALLED/);
    await fs.unlink(link); await fs.rmdir(path.join(root, ".claude/agents"));
    const external = path.join(root, "external"); await fs.mkdir(external);
    await write(path.join(external, "do-not-inspect.md"), "# External file\n");
    await fs.symlink(external, path.join(root, ".claude/agents"));
    checked = await runCheck(root, options);
    assert.notEqual(checked.code, 0); assert.match(checked.stderr, /symlink directory; not inspected/);
    assert.doesNotMatch(checked.stderr, /DIFF_WAS_CALLED/);
    assert.doesNotMatch(checked.stderr, /To clean up:|rm -f/);
    assert.equal(await fs.readFile(path.join(external, "do-not-inspect.md"), "utf8"), "# External file\n");
  });

  it("retains stale managed command failures alongside unattributed local agents", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.runtimes.find(runtime => runtime.name === "claude-code").enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal((await runSync(root)).code, 0);
    await write(path.join(root, ".claude/agents/local-agent.md"), "# Keep local\n");
    await fs.unlink(path.join(root, `.harness/skills/${SKILL_NAME}.md`));
    manifest.layers.skills = []; await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await write(path.join(root, ".claude/harness.json"), JSON.stringify(manifest));
    const checked = await runCheck(root);
    assert.notEqual(checked.code, 0);
    assert.match(checked.stderr, /stale projection/);
    assert.match(checked.stderr, /\.claude\/commands\/guard-skill\.md/);
    assert.match(checked.stderr, /unattributed extra file/);
    for (const line of checked.stderr.split("\n").filter(line => /To clean up:/.test(line))) {
      assert.doesNotMatch(line, /local-agent\.md/);
    }
  });

  it("still fails missing or hand-edited generated flat agents", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.runtimes.find(runtime => runtime.name === "opencode").enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await write(path.join(root, ".harness/agents/current-agent.md"), "---\nname: current-agent\ndescription: Current\n---\n# Current\n");
    assert.equal((await runSync(root)).code, 0);
    const target = path.join(root, ".opencode/agents/current-agent.md");
    await fs.appendFile(target, "Edited generated output\n");
    const edited = await runCheck(root); assert.notEqual(edited.code, 0); assert.match(edited.stderr, /drifts from/);
    await fs.unlink(target);
    const missing = await runCheck(root); assert.notEqual(missing.code, 0); assert.match(missing.stderr, /drifts from/);
  });

  it("projects native skill siblings as resources, never standalone skills", async () => {
    const root = await makeFixture();
    const manifestPath = path.join(root, ".harness/harness.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.runtimes.find((runtime) => runtime.name === "opencode").enabled = true;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await write(
      path.join(root, "skills/native-skill/SKILL.md"),
      "---\nname: native-skill\ndescription: Native fixture skill.\n---\n# Native skill\n",
    );
    await write(path.join(root, "skills/native-skill/required-companion.md"), "# Companion\n");
    await write(path.join(root, "skills/native-skill/handoff.json"), "{\"ok\":true}\n");

    const synced = await runSync(root);
    assert.equal(synced.code, 0, synced.stderr);
    for (const runtimeRoot of [".agents/skills", ".opencode/skills"]) {
      assert.equal(
        await fs.readFile(path.join(root, runtimeRoot, "native-skill/required-companion.md"), "utf8"),
        "# Companion\n",
      );
      assert.equal(
        await fs.readFile(path.join(root, runtimeRoot, "native-skill/handoff.json"), "utf8"),
        "{\"ok\":true}\n",
      );
      await assert.rejects(fs.stat(path.join(root, runtimeRoot, "required-companion/SKILL.md")));
    }
    const checked = await runCheck(root);
    assert.equal(checked.code, 0, checked.stderr);
  });

  // Inverted 2026-07-02 (extension-installer-refactor R6 / audit M4): a corrupt
  // .harness/extensions.json now fails CLOSED — ownership cannot be determined, so
  // the sync refuses instead of overwriting the skill.
  it("refuses to sync when extensions.json is corrupt JSON", async () => {
    const root = await makeFixture();
    await write(path.join(root, ".harness/extensions.json"), "{ not json");

    const result = await runSync(root);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Refusing to sync: .*extensions\.json is unreadable or malformed/);
    await assert.rejects(fs.stat(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`)));
  });

  // Review finding (codex-xruntime, 2026-07-02): a registry that IS a JSON
  // object but whose .extensions is missing or not an array must also fail
  // CLOSED — a malformed object must not read as "unowned".
  it("refuses to sync when extensions.json is an object without an extensions array", async () => {
    const root = await makeFixture();
    await write(
      path.join(root, ".harness/extensions.json"),
      JSON.stringify({ schema_version: "1.0", extensions: {} }),
    );

    const result = await runSync(root);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Refusing to sync: .*extensions\.json is unreadable or malformed/);
    await assert.rejects(fs.stat(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`)));
  });
});
