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
