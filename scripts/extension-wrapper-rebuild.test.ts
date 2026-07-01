// Seam tests for R10d: the roster-extension.sh wrapper rebuilds when any
// TypeScript source is newer than the dist entry, not only when dist is
// missing. Public surface only (spawned wrapper script).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const wrapper = path.resolve(__dirname, "../../scripts/roster-extension.sh");
const cli = path.resolve(__dirname, "roster-extension.js");

describe("roster-extension.sh stale-build check (R10d)", () => {
  it("rebuilds when the dist entry is older than a source file", async () => {
    // Backdate the built entry so every source is newer than it.
    const epoch = new Date(0);
    await fs.utimes(cli, epoch, epoch);

    const { stdout } = await execFileAsync(wrapper, ["--help"]);

    assert.match(stdout, /Usage: roster-extension/);
    const rebuilt = await fs.stat(cli);
    assert.ok(rebuilt.mtimeMs > epoch.getTime(), "dist entry was not rebuilt");
  });

  it("does not rebuild when the dist entry is up to date", async () => {
    const before = await fs.stat(cli);

    const { stdout } = await execFileAsync(wrapper, ["--help"]);

    assert.match(stdout, /Usage: roster-extension/);
    const after = await fs.stat(cli);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  // Review finding (codex-xruntime, 2026-07-02): the watch set is limited to
  // the CLI's own sources — an unrelated (e.g. future-dated test) .ts file
  // under scripts/ must NOT trigger a rebuild loop.
  it("does not rebuild when only an unrelated scripts/*.ts file is newer", async () => {
    const before = await fs.stat(cli);
    const unrelated = path.resolve(__dirname, "../../scripts/extension-wrapper-rebuild.test.ts");
    const original = await fs.stat(unrelated);
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(unrelated, future, future);
    try {
      const { stdout } = await execFileAsync(wrapper, ["--help"]);
      assert.match(stdout, /Usage: roster-extension/);
      const after = await fs.stat(cli);
      assert.equal(after.mtimeMs, before.mtimeMs);
    } finally {
      await fs.utimes(unrelated, original.atime, original.mtime);
    }
  });
});
