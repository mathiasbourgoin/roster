/**
 * Contract test for scripts/check-cost-shape.ts — CHECK-1 (spec FR-167).
 * Spawns the built CLI against fixture JSONL files in scripts/__fixtures__/cost-snapshot/,
 * matching scripts/check-hook-structure.test.ts's execFile-against-dist convention.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(REPO_ROOT, "dist", "scripts", "check-cost-shape.js");
const FIXTURES = path.join(REPO_ROOT, "scripts", "__fixtures__", "cost-snapshot");

function run(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile("node", [CLI, ...args], { cwd: REPO_ROOT }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 0;
      resolve({ code, output: `${stdout}\n${stderr}` });
    });
  });
}

test("valid fixture — exit 0", async () => {
  const { code } = await run([path.join(FIXTURES, "valid.jsonl")]);
  assert.equal(code, 0);
});

test("missing required key — nonzero with a reason", async () => {
  const { code, output } = await run([path.join(FIXTURES, "missing-key.jsonl")]);
  assert.notEqual(code, 0);
  assert.match(output, /missing required key "attribution"/);
});

test("unknown key (additionalProperties: false) — nonzero with a reason", async () => {
  const { code, output } = await run([path.join(FIXTURES, "unknown-key.jsonl")]);
  assert.notEqual(code, 0);
  assert.match(output, /unknown key "transcript_excerpt"/);
});

test("wrong type — nonzero with a reason", async () => {
  const { code, output } = await run([path.join(FIXTURES, "wrong-type.jsonl")]);
  assert.notEqual(code, 0);
  assert.match(output, /expected type integer/);
});

test("absent cost.jsonl — exit 0 (advisory, FR-160 parity)", async () => {
  const scratch = fsSync.mkdtempSync(path.join(os.tmpdir(), "roster-cost-shape-"));
  const { code } = await run([path.join(scratch, "does-not-exist.jsonl")]);
  fsSync.rmSync(scratch, { recursive: true, force: true });
  assert.equal(code, 0);
});

test("unknown schema keyword — fails closed at compile time", async () => {
  const scratch = fsSync.mkdtempSync(path.join(os.tmpdir(), "roster-cost-shape-schema-"));
  const badSchema = path.join(scratch, "bad.schema.json");
  fsSync.writeFileSync(
    badSchema,
    JSON.stringify({ type: "object", patternProperties: { "^x-": { type: "string" } } })
  );
  const { code, output } = await run([path.join(FIXTURES, "valid.jsonl"), "--schema", badSchema]);
  fsSync.rmSync(scratch, { recursive: true, force: true });
  assert.notEqual(code, 0);
  assert.match(output, /unsupported schema keyword "patternProperties"/);
});
