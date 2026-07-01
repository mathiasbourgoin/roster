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
  // DEFECT (pinned, do not rely on): the registry branch of the guard is expected to
  // refuse this sync, but its jq expression is broken — `.extensions // [] |
  // any(.installed_files[]?; ...)` indexes the extensions ARRAY with a string, jq
  // errors (silenced by `2>/dev/null`), and the guard fails OPEN on perfectly valid
  // JSON. Same fail-open family as audit finding M4; discovered by this test on
  // 2026-07-01 during the extension-installer-fixes task. When the guard is fixed,
  // invert this test into a refusal assertion (exit != 0, "Refusing to overwrite
  // extension-owned skill 'guard-skill'").
  it("currently fails open on a valid registry entry recording the target (guard jq defect, pinned)", async () => {
    const root = await makeFixture();
    await write(
      path.join(root, ".harness/extensions.json"),
      registryOwning(`.agents/skills/${SKILL_NAME}/SKILL.md`),
    );

    const result = await runSync(root);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(await fs.stat(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`)));
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

  // Pins CURRENT behavior for audit finding M4 (out of scope to fix here): a corrupt
  // .harness/extensions.json makes `jq -e ... 2>/dev/null` fail, the guard fails OPEN,
  // and sync overwrites the skill. When M4 is fixed (fail closed), this test must be
  // inverted deliberately.
  it("currently fails open when extensions.json is corrupt JSON (audit M4, pinned)", async () => {
    const root = await makeFixture();
    await write(path.join(root, ".harness/extensions.json"), "{ not json");

    const result = await runSync(root);

    assert.equal(result.code, 0, result.stderr);
    assert.ok(await fs.stat(path.join(root, `.agents/skills/${SKILL_NAME}/SKILL.md`)));
  });
});
