// Seam tests for R10d: the roster-extension.sh wrapper rebuilds when any
// TypeScript source is newer than the dist entry, not only when dist is
// missing. The sandbox prohibits child-process execution from Node tests, so
// verify the wrapper's watch expression directly.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

const wrapper = path.resolve(__dirname, "../../scripts/roster-extension.sh");

describe("roster-extension.sh stale-build check (R10d)", () => {
  it("watches the entry and extension implementation when the dist entry is stale", async () => {
    const source = await fs.readFile(wrapper, "utf8");
    assert.match(source, /\[ ! -f "\$cli" \]\s*\|\|/);
    assert.match(source, /"\$repo_root\/scripts\/roster-extension\.ts"/);
    assert.match(source, /"\$repo_root\/scripts\/extension"/);
    assert.match(source, /-name '\*\.ts' -newer "\$cli"/);
    assert.match(source, /npm --prefix "\$repo_root" run build:ts/);
  });

  it("executes the built CLI after the freshness check", async () => {
    const source = await fs.readFile(wrapper, "utf8");
    assert.match(source, /exec node "\$cli" "\$@"/);
  });

  // Review finding (codex-xruntime, 2026-07-02): the watch set is limited to
  // the CLI's own sources — an unrelated (e.g. future-dated test) .ts file
  // under scripts/ must NOT trigger a rebuild loop.
  it("does not put unrelated scripts files in the watch set", async () => {
    const source = await fs.readFile(wrapper, "utf8");
    assert.doesNotMatch(source, /find "\$repo_root\/scripts" -name/);
    assert.doesNotMatch(source, /extension-wrapper-rebuild\.test\.ts/);
  });
});
