// Seam tests for R10b: remove (and entrypoint migration) prune now-empty
// managed directories, bounded strictly below the managed roots. Foreign
// files halt pruning. Public surface only (module exports).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

import { install, remove } from "./roster-extension.js";
import { makeExtension, makeProject, write, writeHarness } from "./extension-fixture.js";

describe("roster-extension empty-dir prune (R10b)", () => {
  it("remove deletes now-empty skill directories but keeps the managed root", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "prune-pack", version: "1.0.0" },
      skills: [{ dir: "prune-skill", name: "prune-skill", extraFiles: { "assets/data.md": "# Data\n" } }],
    });
    const projectRoot = await makeProject();
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills/prune-skill/assets/data.md")));

    await remove("prune-pack", { target: projectRoot, dryRun: false });

    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/prune-skill")));
    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills")));
  });

  it("entrypoint migration prunes the emptied skill directories under the old root", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "migrate-pack", version: "1.0.0" },
      skills: [{ dir: "mig-skill", name: "mig-skill" }],
    });
    const projectRoot = await makeProject();
    await writeHarness(projectRoot, ".old/skills");
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    await writeHarness(projectRoot, ".new/skills");

    await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.ok(await fs.stat(path.join(projectRoot, ".new/skills/mig-skill/SKILL.md")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".old/skills/mig-skill")));
    assert.ok(await fs.stat(path.join(projectRoot, ".old/skills")));
  });

  it("keeps a directory (and its parents) alive when it still contains foreign files", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "foreign-pack", version: "1.0.0" },
      skills: [{ dir: "foreign-skill", name: "foreign-skill" }],
    });
    const projectRoot = await makeProject();
    await install(extensionRoot, { target: projectRoot, dryRun: false });
    const userNote = path.join(projectRoot, ".agents/skills/foreign-skill/user-note.md");
    await write(userNote, "# Mine\n");

    await remove("foreign-pack", { target: projectRoot, dryRun: false });

    assert.equal(await fs.readFile(userNote, "utf8"), "# Mine\n");
    assert.ok(await fs.stat(path.join(projectRoot, ".agents/skills/foreign-skill")));
  });
});
