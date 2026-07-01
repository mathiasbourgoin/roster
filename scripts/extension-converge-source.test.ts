// Seam tests for R10c: a converge whose recorded source root no longer exists
// reports source_missing truthfully instead of a phantom "0.0.0" version
// comparison. Public surface only (module exports).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

import { converge, install } from "./roster-extension.js";
import { makeExtension, makeProject } from "./extension-fixture.js";

describe("roster-extension converge with a missing source root (R10c)", () => {
  it("reports the vanished source root of a recorded-only pack as source_missing", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "ghost-profiles", version: "2.0.0" },
      profiles: ["host-a"],
    });
    const projectRoot = await makeProject();
    const installed = await install(extensionRoot, { target: projectRoot, dryRun: false });
    await fs.rm(extensionRoot, { recursive: true, force: true });

    const reports = await converge(projectRoot);

    assert.equal(reports[0].status, "DRIFT");
    assert.deepEqual(reports[0].source_missing, [installed.source.path]);
    assert.equal(reports[0].source_version, null);
    assert.equal(reports[0].recorded_only, true);
  });

  it("reports the vanished source root of a skill pack ahead of its per-file entries", async () => {
    const extensionRoot = await makeExtension({
      plugin: { name: "ghost-pack", version: "1.0.0" },
      skills: [{ dir: "ghost-skill", name: "ghost-skill" }],
    });
    const projectRoot = await makeProject();
    const installed = await install(extensionRoot, { target: projectRoot, dryRun: false });
    await fs.rm(extensionRoot, { recursive: true, force: true });

    const reports = await converge(projectRoot);

    assert.equal(reports[0].status, "DRIFT");
    const sourceMissing = reports[0].source_missing as string[];
    assert.equal(sourceMissing[0], installed.source.path);
    assert.ok(sourceMissing.includes("skills/ghost-skill/SKILL.md"));
    assert.equal(reports[0].source_version, null);
    // Installed files are untouched — only the source is gone.
    assert.deepEqual(reports[0].missing, []);
    assert.deepEqual(reports[0].modified, []);
  });
});
