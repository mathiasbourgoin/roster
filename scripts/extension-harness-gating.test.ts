// Seam tests for R5: harness gating is fail-closed. A present
// .harness/harness.json is authoritative — missing or malformed runtimes
// refuse the install instead of silently falling back to conventional paths.
// Public surface only (module exports).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

import { install } from "./roster-extension.js";
import { makeExtension, makeProject, tempRoot, write } from "./extension-fixture.js";

function gatedPack(): ReturnType<typeof makeExtension> {
  return makeExtension({
    plugin: { name: "gating-pack", version: "1.0.0" },
    skills: [{ dir: "gating-skill", name: "gating-skill" }],
  });
}

describe("roster-extension harness gating (R5 fail-closed)", () => {
  it("installs at the configured entrypoint when a runtimes array is present and enabled", async () => {
    const extensionRoot = await gatedPack();
    const projectRoot = await makeProject([
      { name: "codex", enabled: true, entrypoint: ".gated/skills" },
      { name: "opencode", enabled: false, entrypoint: ".opencode" },
    ]);

    await install(extensionRoot, { target: projectRoot, dryRun: false });

    assert.ok(await fs.stat(path.join(projectRoot, ".gated/skills/gating-skill/SKILL.md")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents/skills/gating-skill/SKILL.md")));
  });

  it("refuses install when harness.json exists but lacks a runtimes array", async () => {
    const extensionRoot = await gatedPack();
    const projectRoot = await tempRoot();
    await write(path.join(projectRoot, ".harness/harness.json"), JSON.stringify({ version: "1.0" }));

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /harness\.json exists but has no runtimes array/,
    );
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
  });

  it("refuses install when runtimes is present but not an array", async () => {
    const extensionRoot = await gatedPack();
    const projectRoot = await tempRoot();
    await write(path.join(projectRoot, ".harness/harness.json"), JSON.stringify({ runtimes: "codex" }));

    await assert.rejects(
      install(extensionRoot, { target: projectRoot, dryRun: false }),
      /harness\.json exists but has no runtimes array/,
    );
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents")));
  });

  it("refuses install when harness.json is malformed JSON", async () => {
    const extensionRoot = await gatedPack();
    const projectRoot = await tempRoot();
    await write(path.join(projectRoot, ".harness/harness.json"), "{ not json");

    await assert.rejects(install(extensionRoot, { target: projectRoot, dryRun: false }), SyntaxError);
    await assert.rejects(fs.stat(path.join(projectRoot, ".agents")));
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.json")));
  });
});
