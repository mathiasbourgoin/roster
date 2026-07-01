// Seam tests for the R4 walkFiles fail-closed semantics: unreadable source
// directories and symlinked source entries are hard errors; dist/node_modules/
// .git are documented skips. Public surface only (module exports).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

import { info, install } from "./roster-extension.js";
import { makeExtension, makeProject, write } from "./extension-fixture.js";

describe("roster-extension source walk (R4 fail-closed)", () => {
  it("hard-errors on a symlinked source file inside a skill directory", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "symlink-pack", version: "1.0.0" },
      skills: [{ dir: "sym-skill", name: "sym-skill" }],
    });
    const projectRoot = await makeProject();
    const outside = path.join(path.dirname(extensionRoot), "outside.md");
    await write(outside, "# Outside\n");
    await fs.symlink(outside, path.join(extensionRoot, "skills/sym-skill/linked.md"));

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /refusing symlinked extension source file/,
    );
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
  });

  it("hard-errors on a symlinked directory inside the source tree", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "symdir-pack", version: "1.0.0" },
      skills: [{ dir: "sd-skill", name: "sd-skill" }],
    });
    const outsideDir = path.join(path.dirname(extensionRoot), "outside-dir");
    await write(path.join(outsideDir, "smuggled.md"), "# Smuggled\n");
    await fs.symlink(outsideDir, path.join(extensionRoot, "skills/sd-skill/resources"), "dir");

    await assert.rejects(info(extensionRoot), /refusing symlinked extension source file/);
  });

  it("hard-errors on an unreadable directory instead of silently skipping it", async (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("running as root: permission bits are not enforced");
      return;
    }
    const extensionRoot = await makeExtension({
      plugin: { name: "unreadable-pack", version: "1.0.0" },
      skills: [{ dir: "ur-skill", name: "ur-skill", extraFiles: { "assets/data.md": "# Data\n" } }],
    });
    const projectRoot = await makeProject();
    const blocked = path.join(extensionRoot, "skills/ur-skill/assets");
    await fs.chmod(blocked, 0o000);
    try {
      await assert.rejects(
        install(extensionRoot, { target: projectRoot, dryRun: false }),
        /unreadable extension source directory/,
      );
      await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
    } finally {
      await fs.chmod(blocked, 0o755);
    }
  });

  it("skips dist, node_modules, and .git without projecting their contents", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "skip-pack", version: "1.0.0" },
      skills: [{ dir: "skip-skill", name: "skip-skill" }],
    });
    const projectRoot = await makeProject();
    await write(path.join(extensionRoot, "skills/skip-skill/dist/build.md"), "# Build artifact\n");
    await write(path.join(extensionRoot, "skills/skip-skill/node_modules/dep/index.md"), "# Dep\n");
    await write(path.join(extensionRoot, "skills/skip-skill/.git/config"), "[core]\n");

    const installed = await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills/skip-skill/SKILL.md")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/skip-skill/dist")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/skip-skill/node_modules")));
    assert.equal(
      installed.installed_files.some((file) => /dist|node_modules|\.git/.test(file.target)),
      false,
    );
  });
});
