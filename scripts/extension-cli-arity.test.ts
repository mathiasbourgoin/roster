// Seam tests for R8 + R10-json: table-driven per-command arity/flag
// enforcement through the cliParseError path. Extra operands and
// command-incompatible flags are rejected instead of silently ignored.
// Public parsing surface; no child process is needed to prove argument handling.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "./roster-extension.js";

type CliResult = { code: number; stdout: string; stderr: string };

function runCli(args: string[]): CliResult {
  try {
    parseArgs(args);
    return { code: 0, stdout: "", stderr: "" };
  } catch (error) {
    return { code: 1, stdout: "", stderr: (error as Error).message };
  }
}

function assertParseRejection(result: CliResult, pattern: RegExp): void {
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, pattern);
  assert.match(result.stderr, /Usage: roster-extension/);
}

describe("roster-extension per-command arity (R8)", () => {
  it("rejects an extra operand on list", () => {
    assertParseRejection(runCli(["list", "foo"]), /unexpected argument for list: foo/);
  });

  it("rejects an extra operand on converge", () => {
    assertParseRejection(runCli(["converge", "extra"]), /unexpected argument for converge: extra/);
  });

  it("rejects a second operand on info, install, and remove", () => {
    assertParseRejection(runCli(["info", "a", "b"]), /unexpected argument for info: b/);
    assertParseRejection(runCli(["install", "a", "b"]), /unexpected argument for install: b/);
    assertParseRejection(runCli(["remove", "a", "b"]), /unexpected argument for remove: b/);
  });

  it("rejects --json on info", () => {
    assertParseRejection(runCli(["info", "some-path", "--json"]), /--json is not supported by info/);
  });

  it("rejects --dry-run on list", () => {
    assertParseRejection(runCli(["list", "--dry-run"]), /--dry-run is not supported by list/);
  });
});

describe("roster-extension command x flag rejection matrix (R10-json)", () => {
  const rejections: [command: string, operands: string[], flag: string][] = [
    ["info", ["some-path"], "--target"],
    ["info", ["some-path"], "--dry-run"],
    ["install", ["some-path"], "--json"],
    ["remove", ["some-name"], "--json"],
    ["list", [], "--json"],
    ["converge", [], "--dry-run"],
  ];

  for (const [command, operands, flag] of rejections) {
    it(`rejects ${flag} on ${command}`, () => {
      const result = runCli([command, ...operands, flag, ...(flag === "--target" ? ["."] : [])]);
      assertParseRejection(result, new RegExp(`${flag} is not supported by ${command}`));
    });
  }

  it("still reports a missing --target value on commands that accept it", () => {
    assertParseRejection(runCli(["list", "--target"]), /--target requires a value/);
  });

  it("still reports unknown options with the original message", () => {
    assertParseRejection(runCli(["list", "--dryrun"]), /unknown option: --dryrun/);
  });
});
