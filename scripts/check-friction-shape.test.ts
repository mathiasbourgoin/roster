/**
 * Contract test for scripts/check-friction-shape.ts --log mode (P2 — friction classes).
 * Spawns the built CLI against fixtures in scripts/__fixtures__/friction-log/, matching
 * scripts/check-cost-shape.test.ts's execFile-against-dist convention.
 *
 * Every negative fixture asserts BOTH a non-zero exit AND the specific message, so a
 * checker that started failing for an unrelated reason cannot read as a passing test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CLI = path.join(REPO_ROOT, "dist", "scripts", "check-friction-shape.js");
const FIXTURES = path.join(REPO_ROOT, "scripts", "__fixtures__", "friction-log");

function run(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile("node", [CLI, ...args], { cwd: REPO_ROOT }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 0;
      resolve({ code, output: `${stdout}\n${stderr}` });
    });
  });
}

const fixture = (name: string) => path.join(FIXTURES, name);

test("valid log — exit 0", async () => {
  const { code, output } = await run(["--log", fixture("valid.jsonl")]);
  assert.equal(code, 0, output);
  assert.match(output, /conforms to the entry schema and the closed class vocabulary/);
});

test("class outside the closed vocabulary — non-zero, names the value", async () => {
  const { code, output } = await run(["--log", fixture("unknown-class.jsonl")]);
  assert.equal(code, 1);
  assert.match(output, /class "flakiness" is not in the closed vocabulary/);
});

test("frictions with an empty classes array — non-zero (this is the (unclassified) case)", async () => {
  const { code, output } = await run(["--log", fixture("unclassified.jsonl")]);
  assert.equal(code, 1);
  assert.match(output, /2 friction\(s\) with an empty "classes"/);
});

test('class "other" without a class_note — non-zero', async () => {
  const { code, output } = await run(["--log", fixture("other-without-note.jsonl")]);
  assert.equal(code, 1);
  assert.match(output, /class "other" requires a non-empty "class_note"/);
});

test("missing classes key entirely — non-zero", async () => {
  const { code, output } = await run(["--log", fixture("missing-classes-key.jsonl")]);
  assert.equal(code, 1);
  assert.match(output, /missing required key\(s\) \[classes\]/);
});

test("classes on a clean run — non-zero (clean runs are the denominator, they carry no class)", async () => {
  const { code, output } = await run(["--log", fixture("classes-on-clean-run.jsonl")]);
  assert.equal(code, 1);
  assert.match(output, /"classes" is non-empty on a clean run/);
});

test("absent log — exit 0 but NOT reported as a pass", async () => {
  const { code, output } = await run(["--log", path.join(os.tmpdir(), "roster-no-such-friction-log.jsonl")]);
  assert.equal(code, 0, output);
  assert.match(output, /log NOT checked/);
  assert.doesNotMatch(output, /^✓ friction-shape: .*absent/m);
});

test("--log with no path — exit 2, not a silent pass", async () => {
  const { code } = await run(["--log"]);
  assert.equal(code, 2);
});

// ── --since (migration seam) ────────────────────────────────────────────────
// The risk here is a gate that cannot fail: if --since silently skipped everything
// it would read green forever. These assert both directions AND the visible counts.

test("--since skips older entries and says how many", async () => {
  const { code, output } = await run(["--log", fixture("unclassified.jsonl"), "--since", "2026-08-01"]);
  assert.equal(code, 0, output);
  assert.match(output, /0 checked, 1 pre-2026-08-01 entries skipped/);
});

test("--since still checks entries on or after the cutoff", async () => {
  const { code, output } = await run(["--log", fixture("unclassified.jsonl"), "--since", "2026-07-01"]);
  assert.equal(code, 1);
  assert.match(output, /1 checked, 0 pre-2026-07-01 entries skipped/);
  assert.match(output, /with an empty "classes"/);
});

test("--since does not let a dateless entry opt out", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "roster-friction-nodate-"));
  const log = path.join(scratch, "friction.jsonl");
  fs.writeFileSync(
    log,
    JSON.stringify({
      skill: "roster-review",
      task: "t",
      frictions: ["a"],
      classes: [],
      methods: [],
      suggestion_type: null,
      suggestion: null,
      effort_estimate: null,
    }) + "\n",
  );
  const { code, output } = await run(["--log", log, "--since", "2099-01-01"]);
  assert.equal(code, 1, output);
  assert.match(output, /missing required key\(s\) \[date\]/);
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("--since with no date argument — exit 2", async () => {
  const { code } = await run(["--log", fixture("valid.jsonl"), "--since"]);
  assert.equal(code, 2);
});

// Anti-vacuity: the vocabulary is parsed from schema/skill-schema.md, not hardcoded here.
// If that enum line is ever removed or renamed, --log must fail loudly rather than
// accept every value. Proven by mutation against a scratch copy of the repo doc.
test("schema enum line removed — checker throws instead of accepting anything", async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "roster-friction-mut-"));
  const docRel = path.join("schema", "skill-schema.md");
  fs.mkdirSync(path.join(scratch, "schema"));
  fs.mkdirSync(path.join(scratch, "dist", "scripts"), { recursive: true });
  const doc = fs.readFileSync(path.join(REPO_ROOT, docRel), "utf-8");
  const mutated = doc.replace(/^\s*classes:\s*<[^<>]+>\s*$/m, "classes: REMOVED");
  assert.notEqual(mutated, doc, "mutation did not apply — the enum line was not found");
  fs.writeFileSync(path.join(scratch, docRel), mutated);
  fs.copyFileSync(CLI, path.join(scratch, "dist", "scripts", "check-friction-shape.js"));

  const { code, output } = await new Promise<{ code: number; output: string }>((resolve) => {
    execFile(
      "node",
      [path.join(scratch, "dist", "scripts", "check-friction-shape.js"), "--log", fixture("valid.jsonl")],
      { cwd: scratch },
      (err, stdout, stderr) => {
        const c = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 0;
        resolve({ code: c, output: `${stdout}\n${stderr}` });
      },
    );
  });
  assert.notEqual(code, 0);
  assert.match(output, /no `classes: <a\|b\|c>` enum line found/);
  fs.rmSync(scratch, { recursive: true, force: true });
});
