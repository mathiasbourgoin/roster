/**
 * Tests for the hook linter (scripts/check-hook-structure.ts) — spawns the
 * built CLI against fixture hook dirs in a scratch directory. cwd stays at the
 * repo root so `.harness/` resolution (agent refs, EC-7 registry) is live.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const LINTER = path.join(REPO_ROOT, "dist", "scripts", "check-hook-structure.js");
const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), "roster-hook-lint-"));

after(() => {
  fsSync.rmSync(SCRATCH, { recursive: true, force: true });
});

interface LintRun {
  code: number;
  output: string; // stdout + stderr combined
}

function runLinterOnce(dir: string): Promise<LintRun & { silentErr: boolean }> {
  return new Promise((resolve) => {
    execFile("node", [LINTER, dir], { cwd: REPO_ROOT }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 0;
      let output = `${stdout}\n${stderr}`;
      const silentErr = Boolean(err) && output.trim() === "";
      // Surface spawn/exec failures so regex assertions fail with a diagnosis instead
      // of an empty string — under some sandboxes the child produced no output at all
      // and every assertion failed opaquely with `actual: '\n'`.
      if (silentErr) {
        const e = err as { code?: unknown; message?: string };
        output = `[runLinter: child produced no output — execFile error code=${String(e.code)} message=${e.message ?? "?"}]`;
      }
      resolve({ code, output, silentErr });
    });
  });
}

async function runLinter(dir: string): Promise<LintRun> {
  // Transient sandbox flake (codex workspace-write): the child intermittently spawns
  // with no output at all, then succeeds on an immediate identical re-run (observed
  // 3× across 2026-07-09/10 — health P2). Retry ONCE only for that silent-spawn
  // signature; deterministic linter failures produce output and are never retried.
  const first = await runLinterOnce(dir);
  if (!first.silentErr) return first;
  return runLinterOnce(dir);
}

let fixtureCounter = 0;
/** Write a hook fixture as <dir>/<skill>/<event>.md; returns the scan dir. */
function fixture(skill: string, event: "pre" | "post", stepsYaml: string): string {
  const dir = path.join(SCRATCH, `fixture-${fixtureCounter++}`);
  fsSync.mkdirSync(path.join(dir, skill), { recursive: true });
  const content = `---
name: fixture-hook
version: 1.0.0
event: ${event}
skill: ${skill}
---

\`\`\`yaml
steps:
${stepsYaml}
\`\`\`
`;
  fsSync.writeFileSync(path.join(dir, skill, `${event}.md`), content);
  return dir;
}

test("EC-3: goto targeting the hook's own skill → warning, exit 0", async () => {
  const dir = fixture("roster-ship", "post", `  - goto: roster-ship`);
  const { code, output } = await runLinter(dir);
  assert.equal(code, 0);
  assert.match(output, /self-loop \(EC-3\)/);
});

test("EC-7: hook for a skill not installed in the harness → warning, exit 0", async () => {
  const dir = fixture("not-a-real-skill", "pre", `  - run: "exit 0"`);
  const { code, output } = await runLinter(dir);
  assert.equal(code, 0);
  assert.match(output, /not installed in the harness.*EC-7/);
});

test("EC-7: hook for a registered pipeline skill → no EC-7 warning", async () => {
  const dir = fixture("roster-ship", "pre", `  - run: "exit 0"`);
  const { code, output } = await runLinter(dir);
  assert.equal(code, 0);
  assert.ok(!/EC-7/.test(output), `unexpected EC-7 warning:\n${output}`);
});

test("break_if/continue_if inside a loop body → accepted, no warning", async () => {
  const dir = fixture("roster-ship", "post", [
    `  - loop:`,
    `      steps:`,
    `        - run: "npm test"`,
    `        - break_if: "{{result}} == 'done'"`,
    `        - continue_if: "{{result}} == 'skip'"`,
    `      until: "exit 0"`,
  ].join("\n"));
  const { code, output } = await runLinter(dir);
  assert.equal(code, 0);
  assert.ok(!/break_if|continue_if/.test(output), `unexpected loop-control warning:\n${output}`);
});

test("break_if outside a loop → warning (LLM-deferred), exit 0", async () => {
  const dir = fixture("roster-ship", "post", [
    `  - run: "exit 0"`,
    `  - break_if: "{{result}} == 'done'"`,
  ].join("\n"));
  const { code, output } = await runLinter(dir);
  assert.equal(code, 0);
  assert.match(output, /"break_if:" outside a loop body/);
});

test("continue_if outside a loop → warning, exit 0", async () => {
  const dir = fixture("roster-ship", "post", `  - continue_if: "{{result}} == 'skip'"`);
  const { code, output } = await runLinter(dir);
  assert.equal(code, 0);
  assert.match(output, /"continue_if:" outside a loop body/);
});

test("unknown operator still errors (exit 1) — break_if addition did not loosen check 8", async () => {
  const dir = fixture("roster-ship", "pre", `  - execute: "exit 0"`);
  const { code, output } = await runLinter(dir);
  assert.equal(code, 1);
  assert.match(output, /unknown operator/);
});
