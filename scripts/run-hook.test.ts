/**
 * Tests for the hook executor (scripts/run-hook.ts).
 * Uses Node.js built-in test runner (node --test).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runHook as runHookRaw, RunHookOptions, HookResult } from "./run-hook";

// ─── Pollution guard (R1) ─────────────────────────────────────────────────────
// Every runHook call in this file MUST use a scratch metaDir — never the repo's
// skills-meta/. The wrapper below injects a scratch default; the after() backstop
// asserts the repo friction.jsonl line count is unchanged across the whole run.

const SCRATCH_ROOT = fsSync.mkdtempSync(path.join(os.tmpdir(), "roster-hook-meta-"));
const DEFAULT_META = path.join(SCRATCH_ROOT, "default-meta");
fsSync.mkdirSync(DEFAULT_META);

const REPO_FRICTION = path.resolve(__dirname, "../..", "skills-meta", "friction.jsonl");
const repoFrictionLines = (): number => {
  try {
    return fsSync.readFileSync(REPO_FRICTION, "utf-8").split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    return -1;
  }
};
const REPO_FRICTION_LINES_BEFORE = repoFrictionLines();

after(() => {
  assert.equal(
    repoFrictionLines(),
    REPO_FRICTION_LINES_BEFORE,
    "POLLUTION: run-hook tests wrote to the repo's skills-meta/friction.jsonl"
  );
  fsSync.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

/** runHook with a scratch metaDir default (explicit opts.metaDir still wins). */
function runHook(opts: RunHookOptions): Promise<HookResult> {
  return runHookRaw({ metaDir: DEFAULT_META, ...opts });
}

let metaDirCounter = 0;
/** Fresh empty scratch metaDir for tests that assert friction file contents. */
function newMetaDir(): string {
  const dir = path.join(SCRATCH_ROOT, `meta-${metaDirCounter++}`);
  fsSync.mkdirSync(dir);
  return dir;
}

async function readFrictionRecords(metaDir: string): Promise<Record<string, unknown>[]> {
  const raw = await fs.readFile(path.join(metaDir, "friction.jsonl"), "utf-8");
  return raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
}

function makeHook(event: "pre" | "post", stepsYaml: string): string {
  return `---
name: test-hook
version: 1.0.0
event: ${event}
skill: roster-implement
---

## Hook

\`\`\`yaml
steps:
${stepsYaml}
\`\`\`
`;
}

test("run: success → pass", async () => {
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s" });
  assert.equal(r.outcome, "pass");
  assert.equal(r.steps_run, 1);
  assert.equal(r.pending_llm_steps.length, 0);
});

test("run: failure on_error:stop → abort", async () => {
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 1"\n    on_error: stop`), event: "pre", skill: "s" });
  assert.equal(r.outcome, "abort");
  assert.ok(r.abort_reason);
});

test("run: failure on_error:warn → warn continues", async () => {
  const r = await runHook({
    content: makeHook("post", `  - run: "exit 1"\n    on_error: warn\n  - run: "exit 0"`),
    event: "post", skill: "s",
  });
  assert.equal(r.outcome, "warn");
  assert.equal(r.steps_run, 2);
});

test("run: failure on_error:skip → pass", async () => {
  const r = await runHook({
    content: makeHook("pre", `  - run: "exit 1"\n    on_error: skip\n  - run: "exit 0"`),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "pass");
});

test("run: default pre → stop", async () => {
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 2"`), event: "pre", skill: "s" });
  assert.equal(r.outcome, "abort");
});

test("run: default post → warn", async () => {
  const r = await runHook({ content: makeHook("post", `  - run: "exit 2"`), event: "post", skill: "s" });
  assert.equal(r.outcome, "warn");
});

test("pending outranks warn: a warned hook with deferred LLM steps is pending", async () => {
  // Review finding (codex-xruntime 2026-07-02): warn used to mask pending, so
  // callers keying on exit 3 skipped the deferred steps. The warn survives in
  // warn_reasons and the friction record.
  const metaDir = newMetaDir();
  const r = await runHook({
    content: makeHook("post", `  - run: "exit 2"\n  - prompt: "do the deferred thing"`),
    event: "post", skill: "s", metaDir,
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.pending_llm_steps.length, 1);
  assert.equal(r.warn_reasons.length, 1);
  const records = await readFrictionRecords(metaDir);
  assert.equal(records[0].outcome, "pending");
  assert.deepEqual(records[0].frictions, []);
});

test("frontmatter on_error: warn overrides the pre-hook stop default", async () => {
  // A pre-hook normally defaults failed steps to stop → abort. A hook-level
  // `on_error: warn` must become the per-step default, so a failing step warns instead.
  const content = `---
name: test-hook
version: 1.0.0
event: pre
skill: roster-implement
on_error: warn
---

\`\`\`yaml
steps:
  - run: "exit 1"
\`\`\`
`;
  const r = await runHook({ content, event: "pre", skill: "s" });
  assert.equal(r.outcome, "warn");
});

test("invalid frontmatter on_error is rejected at parse (fail-closed)", async () => {
  const content = `---
name: test-hook
version: 1.0.0
event: pre
skill: roster-implement
on_error: retry:2
---

\`\`\`yaml
steps:
  - run: "exit 0"
\`\`\`
`;
  await assert.rejects(() => runHook({ content, event: "pre", skill: "s" }), /Invalid frontmatter on_error/);
});

test("invalid step-level on_error is rejected at parse (fail-closed)", async () => {
  const content = makeHook("pre", `  - run: "exit 1"\n    on_error: retry:2`);
  await assert.rejects(() => runHook({ content, event: "pre", skill: "s" }), /Invalid on_error/);
});

test("timeout: enforced — slow command killed", { timeout: 5000 }, async () => {
  const r = await runHook({
    content: makeHook("pre", `  - timeout: 100\n  - run: "sleep 5"\n    on_error: stop`),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "abort");
});

test("timeout: not triggered if fast", async () => {
  const r = await runHook({
    content: makeHook("pre", `  - timeout: 5000\n  - run: "exit 0"`),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "pass");
});

test("retry: succeeds eventually", { timeout: 5000 }, async () => {
  const tmp = `/tmp/roster-hook-test-${Date.now()}`;
  const r = await runHook({
    content: makeHook("pre", [
      `  - run: "c=$(cat ${tmp} 2>/dev/null || echo 0); echo $((c+1)) > ${tmp}; [ $((c+1)) -ge 3 ]"`,
      `    on_error: stop`,
      `  - retry: 3`,
      `    backoff: 10`,
    ].join("\n")),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "pass");
});

test("retry: exhausted → abort", { timeout: 5000 }, async () => {
  const r = await runHook({
    content: makeHook("pre", `  - run: "exit 1"\n    on_error: stop\n  - retry: 2\n    backoff: 10`),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "abort");
});

test("test: on_true when exit 0", async () => {
  const r = await runHook({
    content: makeHook("pre", [
      `  - test: "exit 0"`,
      `    on_true:`,
      `      - log: "yes"`,
      `    on_false:`,
      `      - run: "exit 1"`,
      `        on_error: stop`,
    ].join("\n")),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "pass");
  assert.ok(r.log.some((l) => l.includes("yes")));
});

test("test: on_false when exit 1", async () => {
  const r = await runHook({
    content: makeHook("pre", [
      `  - test: "exit 1"`,
      `    on_true:`,
      `      - run: "exit 1"`,
      `        on_error: stop`,
      `    on_false:`,
      `      - log: "no"`,
    ].join("\n")),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "pass");
  assert.ok(r.log.some((l) => l.includes("no")));
});

test("log: in result", async () => {
  const r = await runHook({ content: makeHook("pre", `  - log: "hello hook"`), event: "pre", skill: "s" });
  assert.ok(r.log.some((l) => l.includes("hello hook")));
  assert.equal(r.outcome, "pass");
});

test("goto: jumps over failing step", async () => {
  const r = await runHook({
    content: makeHook("pre", [
      `  - goto: done`,
      `  - run: "exit 1"`,
      `    on_error: stop`,
      `  - label: done`,
      `  - log: "reached"`,
    ].join("\n")),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "pass");
  assert.ok(r.log.some((l) => l.includes("reached")));
});

test("prompt: → pending_llm_steps", async () => {
  const r = await runHook({
    content: makeHook("pre", `  - run: "exit 0"\n  - prompt: "summarise"\n    agent: qa`),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.pending_llm_steps.length, 1);
  assert.equal((r.pending_llm_steps[0] as unknown as Record<string, unknown>).prompt, "summarise");
});

test("loop: → pending_llm_steps", async () => {
  const r = await runHook({
    content: makeHook("post", `  - loop:\n      steps:\n        - log: "x"\n      until: "exit 0"`),
    event: "post", skill: "s",
  });
  assert.ok(r.pending_llm_steps.length >= 1);
  assert.ok("loop" in r.pending_llm_steps[0]);
});

test("missing hook file → skip", async () => {
  const r = await runHook({ hookDir: "/tmp/no-such-dir-roster", event: "pre", skill: "s" });
  assert.equal(r.outcome, "skip");
});

test("ROSTER_HOOK_RUNNING → skip (re-entrance guard)", async () => {
  process.env.ROSTER_HOOK_RUNNING = "1";
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s" });
  delete process.env.ROSTER_HOOK_RUNNING;
  assert.equal(r.outcome, "skip");
  assert.ok(r.skip_reason?.match(/re-entrance/i));
});

// ─── Friction logging (spec US-6 / AC-16) ─────────────────────────────────────

const CANONICAL_KEYS = [
  "date", "skill", "task", "frictions", "methods",
  "suggestion_type", "suggestion", "effort_estimate",
];
const HOOK_EXTRA_KEYS = ["hook", "outcome", "duration_ms", "loop_iterations"];

test("friction: pass outcome appends canonical record with hook extras", async () => {
  const metaDir = newMetaDir();
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s", metaDir });
  assert.equal(r.outcome, "pass");
  const records = await readFrictionRecords(metaDir);
  assert.equal(records.length, 1);
  const rec = records[0];
  for (const k of [...CANONICAL_KEYS, ...HOOK_EXTRA_KEYS]) {
    assert.ok(k in rec, `record missing key "${k}"`);
  }
  assert.equal(rec.outcome, "pass");
  assert.equal(rec.hook, "pre");
  assert.equal(rec.skill, "s");
  assert.deepEqual(rec.frictions, []);
  assert.deepEqual(rec.methods, []);
  assert.equal(rec.suggestion_type, null);
  assert.equal(rec.suggestion, null);
  assert.equal(rec.effort_estimate, null);
  assert.equal(rec.loop_iterations, null);
  assert.match(String(rec.date), /^\d{4}-\d{2}-\d{2}$/);
});

test("friction: abort outcome carries the abort reason in frictions", async () => {
  const metaDir = newMetaDir();
  const r = await runHook({
    content: makeHook("pre", `  - run: "exit 1"\n    on_error: stop`),
    event: "pre", skill: "s", metaDir,
  });
  assert.equal(r.outcome, "abort");
  const [rec] = await readFrictionRecords(metaDir);
  assert.equal(rec.outcome, "abort");
  assert.equal((rec.frictions as string[]).length, 1);
  assert.match((rec.frictions as string[])[0], /exited with code 1/);
});

test("friction: warn outcome carries warn reasons in frictions", async () => {
  const metaDir = newMetaDir();
  const r = await runHook({
    content: makeHook("post", `  - run: "exit 1"\n    on_error: warn\n  - run: "exit 3"\n    on_error: warn`),
    event: "post", skill: "s", metaDir,
  });
  assert.equal(r.outcome, "warn");
  const [rec] = await readFrictionRecords(metaDir);
  assert.equal(rec.outcome, "warn");
  const frictions = rec.frictions as string[];
  assert.equal(frictions.length, 2);
  assert.match(frictions[0], /exited with code 1/);
  assert.match(frictions[1], /exited with code 3/);
});

test("friction: pending outcome is logged", async () => {
  const metaDir = newMetaDir();
  const r = await runHook({
    content: makeHook("pre", `  - prompt: "check"\n    agent: qa`),
    event: "pre", skill: "s", metaDir,
  });
  assert.equal(r.outcome, "pending");
  const [rec] = await readFrictionRecords(metaDir);
  assert.equal(rec.outcome, "pending");
  assert.deepEqual(rec.frictions, []);
});

test("friction: TASK env populates task; unset → null", async () => {
  const metaDir = newMetaDir();
  process.env.TASK = "my-task";
  try {
    await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s", metaDir });
  } finally {
    delete process.env.TASK;
  }
  await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s", metaDir });
  const records = await readFrictionRecords(metaDir);
  assert.equal(records.length, 2);
  assert.equal(records[0].task, "my-task");
  assert.equal(records[1].task, null);
});

test("friction: duration_ms is a non-negative number", async () => {
  const metaDir = newMetaDir();
  await runHook({ content: makeHook("pre", `  - run: "sleep 0.05"`), event: "pre", skill: "s", metaDir });
  const [rec] = await readFrictionRecords(metaDir);
  assert.equal(typeof rec.duration_ms, "number");
  assert.ok((rec.duration_ms as number) >= 0);
});

test("friction: absent metaDir → logging skipped, hook result unaffected, dir not created", async () => {
  const metaDir = path.join(SCRATCH_ROOT, "does-not-exist");
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s", metaDir });
  assert.equal(r.outcome, "pass");
  assert.equal(fsSync.existsSync(metaDir), false);
});

test("friction: append failure is fail-open (friction.jsonl is a directory)", async () => {
  const metaDir = newMetaDir();
  fsSync.mkdirSync(path.join(metaDir, "friction.jsonl")); // appendFile will fail
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s", metaDir });
  assert.equal(r.outcome, "pass"); // logging failure never fails the hook
});

test("friction: skip outcome writes nothing (re-entrance guard)", async () => {
  const metaDir = newMetaDir();
  process.env.ROSTER_HOOK_RUNNING = "1";
  const r = await runHook({ content: makeHook("pre", `  - run: "exit 0"`), event: "pre", skill: "s", metaDir });
  delete process.env.ROSTER_HOOK_RUNNING;
  assert.equal(r.outcome, "skip");
  assert.equal(fsSync.existsSync(path.join(metaDir, "friction.jsonl")), false);
});

test("friction: skip outcome writes nothing (hook file absent)", async () => {
  const metaDir = newMetaDir();
  const r = await runHook({ hookDir: "/tmp/no-such-dir-roster", event: "pre", skill: "s", metaDir });
  assert.equal(r.outcome, "skip");
  assert.equal(fsSync.existsSync(path.join(metaDir, "friction.jsonl")), false);
});

test("friction: reason strings are newline-stripped — one single-line record", async () => {
  const metaDir = newMetaDir();
  // Multi-line command via YAML block scalar → failure reason embeds newlines.
  const r = await runHook({
    content: makeHook("pre", [
      `  - run: |`,
      `      echo line1`,
      `      exit 1`,
      `    on_error: stop`,
    ].join("\n")),
    event: "pre", skill: "s", metaDir,
  });
  assert.equal(r.outcome, "abort");
  const raw = await fs.readFile(path.join(metaDir, "friction.jsonl"), "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  assert.equal(lines.length, 1); // exactly one physical line per record
  const rec = JSON.parse(lines[0]) as Record<string, unknown>;
  for (const f of rec.frictions as string[]) {
    assert.ok(!/[\r\n]/.test(f), "friction reason contains a raw newline");
  }
});

// ─── CHECK-8 integration: built CLI writes friction BEFORE process.exit ───────
// Spawns dist/scripts/run-hook.js in a scratch project. Reading the record
// AFTER the child has exited proves the append is awaited inside runHook —
// a fire-and-forget write would truncate abort records (R5).

import { execFile } from "node:child_process";

const CLI = path.join(__dirname, "run-hook.js"); // sibling in dist/scripts at runtime

function runCli(cwd: string, event: string, skill: string, env: Record<string, string> = {}):
  Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile("node", [CLI, event, skill], { cwd, env: { ...process.env, ...env } }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 0;
      resolve({ code, stdout });
    });
  });
}

function scaffoldProject(hooks: { skill: string; steps: string }[]): string {
  const proj = path.join(SCRATCH_ROOT, `proj-${metaDirCounter++}`);
  fsSync.mkdirSync(path.join(proj, "skills-meta"), { recursive: true });
  for (const h of hooks) {
    const dir = path.join(proj, ".harness", "hooks", "skills", h.skill);
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(path.join(dir, "pre.md"), makeHook("pre", h.steps));
  }
  return proj;
}

test("CHECK-8 integration: abort via built CLI — record present after exit", async () => {
  const proj = scaffoldProject([{ skill: "s-abort", steps: `  - run: "exit 1"\n    on_error: stop` }]);
  const { code } = await runCli(proj, "pre", "s-abort", { TASK: "check-8" });
  assert.equal(code, 1); // abort exit code
  // Child has fully exited — the record must already be on disk (write-before-exit).
  const records = await readFrictionRecords(path.join(proj, "skills-meta"));
  assert.equal(records.length, 1);
  const rec = records[records.length - 1];
  assert.ok("hook" in rec && "outcome" in rec, "CHECK-8: tail record must carry hook and outcome");
  assert.equal(rec.outcome, "abort");
  assert.equal(rec.task, "check-8");
});

test("integration: one record per outcome (pass/warn/abort/pending), all shape-compliant", async () => {
  const proj = scaffoldProject([
    { skill: "s-pass", steps: `  - run: "exit 0"` },
    { skill: "s-warn", steps: `  - run: "exit 1"\n    on_error: warn` },
    { skill: "s-abort", steps: `  - run: "exit 1"\n    on_error: stop` },
    { skill: "s-pending", steps: `  - prompt: "check"\n    agent: qa` },
  ]);
  const expectations: [string, number, string][] = [
    ["s-pass", 0, "pass"],
    ["s-warn", 2, "warn"],
    ["s-abort", 1, "abort"],
    ["s-pending", 3, "pending"],
  ];
  for (const [skill, expectedCode] of expectations) {
    const { code } = await runCli(proj, "pre", skill);
    assert.equal(code, expectedCode, `exit code for ${skill}`);
  }
  const records = await readFrictionRecords(path.join(proj, "skills-meta"));
  assert.equal(records.length, 4);
  for (let i = 0; i < 4; i++) {
    const rec = records[i];
    assert.equal(rec.outcome, expectations[i][2]);
    for (const k of [...CANONICAL_KEYS, ...HOOK_EXTRA_KEYS]) {
      assert.ok(k in rec, `record ${i} missing key "${k}" — not check-friction-shape compliant`);
    }
  }
});

test("integration: skip (no hook file) via built CLI writes nothing", async () => {
  const proj = scaffoldProject([]); // skills-meta exists, no hooks
  const { code } = await runCli(proj, "pre", "no-hook-skill");
  assert.equal(code, 4); // skip
  assert.equal(fsSync.existsSync(path.join(proj, "skills-meta", "friction.jsonl")), false);
});

// ─── break_if / continue_if (spec US-4 Sc.4C) ─────────────────────────────────

test("break_if: round-trips through the parser as its own operator", async () => {
  const { parseHookFile, stepOperator } = await import("./lib/hooks/hook-parser");
  const parsed = parseHookFile(makeHook("post", [
    `  - break_if: "{{result}} == 'done'"`,
    `  - continue_if: "{{result}} == 'skip'"`,
  ].join("\n")));
  assert.equal(parsed.steps.length, 2);
  assert.equal(stepOperator(parsed.steps[0]), "break_if");
  assert.equal(stepOperator(parsed.steps[1]), "continue_if");
  assert.equal((parsed.steps[0] as { break_if: string }).break_if, "{{result}} == 'done'");
});

test("break_if/continue_if at top level → pending_llm_steps (not silent skip)", async () => {
  const metaDir = newMetaDir();
  const r = await runHook({
    content: makeHook("post", [
      `  - run: "exit 0"`,
      `  - break_if: "{{result}} == 'done'"`,
      `  - continue_if: "{{result}} == 'skip'"`,
    ].join("\n")),
    event: "post", skill: "s", metaDir,
  });
  assert.equal(r.outcome, "pending"); // exit 3 at CLI level
  assert.equal(r.pending_llm_steps.length, 2);
  assert.ok("break_if" in r.pending_llm_steps[0]);
  assert.ok("continue_if" in r.pending_llm_steps[1]);
  assert.ok(!r.log.some((l) => l.includes("[unknown]")), "must not be treated as unknown operator");
});

test("break_if/continue_if inside a loop body travel intact in the deferred loop step", async () => {
  const r = await runHook({
    content: makeHook("post", [
      `  - loop:`,
      `      steps:`,
      `        - run: "npm test"`,
      `        - break_if: "{{result}} == 'done'"`,
      `        - continue_if: "{{result}} == 'skip'"`,
      `      until: "exit 0"`,
    ].join("\n")),
    event: "post", skill: "s",
  });
  assert.equal(r.outcome, "pending");
  assert.equal(r.pending_llm_steps.length, 1);
  const loop = (r.pending_llm_steps[0] as { loop: { steps: unknown[]; until?: string } }).loop;
  assert.equal(loop.steps.length, 3);
  assert.deepEqual(loop.steps[1], { break_if: "{{result}} == 'done'" });
  assert.deepEqual(loop.steps[2], { continue_if: "{{result}} == 'skip'" });
  assert.equal(loop.until, "exit 0");
});

// 501 backward jumps → 501 real shell spawns; comfortably <1s standalone but can
// exceed 5s when the full npm-test chain loads the machine — budget accordingly.
test("backward goto: loop cap triggers abort (not hang)", { timeout: 20000 }, async () => {
  // A hook with an unconditional backward goto must abort via the jump cap, not hang forever.
  const r = await runHook({
    content: makeHook("pre", [
      `  - label: start`,
      `  - run: "exit 0"`,
      `  - goto: start`,
    ].join("\n")),
    event: "pre", skill: "s",
  });
  assert.equal(r.outcome, "abort");
  assert.ok(r.log.some((l) => l.includes("goto loop cap")));
});
