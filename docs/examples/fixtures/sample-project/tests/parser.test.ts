import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/parser.js";

describe("parseArgs", () => {
  it("default count is 10", () => {
    // Simulate argv with no flags: [node, script]
    const result = parseArgs(["node", "script"]);
    assert.equal(result.count, 10);
  });

  it("--count flag sets count", () => {
    const result = parseArgs(["node", "script", "--count", "5"]);
    // BUG: because slice(1) is used, "script" is treated as the first arg.
    // "--count" ends up at position 1 after slicing at 1, so this test
    // accidentally passes when the bug is present — the flag is still found.
    // The bug manifests as the first positional arg being skipped silently.
    assert.equal(result.count, 5);
  });

  // MISSING: no test for invalid --count value (should throw)
  // MISSING: no tests for formatter at all
});
