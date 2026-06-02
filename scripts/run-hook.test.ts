/**
 * Tests for the hook executor (scripts/run-hook.ts).
 * Uses Node.js built-in test runner (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runHook } from "./run-hook";

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
