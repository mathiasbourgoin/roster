// Tests for hooks/quality/phase-checkpoint-reminder.md and hooks/safety/block-adhoc-review.md.
// Each hook's `## Command` block is extracted with the same awk rule sync-harness.sh uses
// (extract_command_block) and run as a black box against temp `briefs/` fixtures.
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const BASH = execFileSync("bash", ["-c", "command -v bash"]).toString().trim();
const HOUR_MS = 3600 * 1000;

function extractCommand(hookRel) {
  const out = execFileSync("awk", [
    '/^```command$/ {b=1; next} /^```$/ && b {exit} b {print}',
    path.join(REPO_ROOT, hookRel),
  ]).toString();
  assert.ok(out.startsWith("#!/bin/bash"), `${hookRel}: command block not found`);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hook-cmd-")), "hook.sh");
  fs.writeFileSync(file, out);
  return file;
}

const REMINDER = extractCommand("hooks/quality/phase-checkpoint-reminder.md");
const GUARD = extractCommand("hooks/safety/block-adhoc-review.md");

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const ev = (phase, outcome, at) => (at === undefined ? { phase, outcome } : { phase, outcome, at });
const FULL_TO_PLAN = (at) => [
  ev("question", "COMPLETED"), ev("research", "COMPLETED"), ev("intake", "VALIDATED"),
  ev("spec", "VALIDATED"), ev("plan", "COMPLETED", at),
];

// Fixture project: briefs/ACTIVE_TASK + optional ledger (object or raw string) + optional impl brief.
function project({ slug = "t", active = slug, ledger, mode = "full", events, impl = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phase-guard-"));
  const briefs = path.join(root, "briefs");
  fs.mkdirSync(briefs);
  if (active !== null) fs.writeFileSync(path.join(briefs, "ACTIVE_TASK"), `${active}\n`);
  const body = ledger !== undefined ? ledger
    : events ? JSON.stringify({ task: slug, mode, current_phase: events[events.length - 1].phase, events })
    : null;
  if (body !== null) fs.writeFileSync(path.join(briefs, `${slug}-state.json`), body);
  if (impl) fs.writeFileSync(path.join(briefs, `${slug}-impl.md`), "# Implementation Brief\n");
  return root;
}

function run(script, input, { env = {}, cwd } = {}) {
  const base = { ...process.env };
  for (const k of ["CLAUDE_PROJECT_DIR", "ROSTER_PHASE_STALE_HOURS", "ROSTER_ALLOW_ADHOC_REVIEW"]) delete base[k];
  const r = spawnSync(BASH, [script], {
    input: JSON.stringify(input),
    cwd: cwd || os.tmpdir(),
    env: { ...base, GIT_CEILING_DIRECTORIES: os.tmpdir(), ...env },
  });
  return { code: r.status, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function remind(root, opts) {
  const r = run(REMINDER, { hook_event_name: "UserPromptSubmit", cwd: root, prompt: "continue" }, opts);
  assert.equal(r.code, 0, r.stderr);
  if (r.stdout === "") return null;
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  return out.hookSpecificOutput.additionalContext;
}

function spawn(root, toolInput, opts) {
  const r = run(GUARD, { hook_event_name: "PreToolUse", tool_name: "Agent", cwd: root, tool_input: toolInput }, opts);
  assert.equal(r.code, 0, r.stderr);
  if (r.stdout === "") return null;
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  return out.hookSpecificOutput.permissionDecisionReason;
}

// PATH with every tool the hooks use except jq, so the no-jq cases exercise the real path.
const NO_JQ_PATH = fs.mkdtempSync(path.join(os.tmpdir(), "no-jq-"));
for (const tool of ["cat", "head", "tr", "git", "date"]) {
  const real = execFileSync("bash", ["-c", `command -v ${tool}`]).toString().trim();
  fs.symlinkSync(real, path.join(NO_JQ_PATH, tool));
}
const REVIEWER = { subagent_type: "reviewer", description: "Check S1-S18", prompt: "Look at the work." };

describe("phase-checkpoint-reminder", () => {
  it("fail-open: silent without jq on PATH", () => {
    const root = project({ events: FULL_TO_PLAN(iso(30 * HOUR_MS)) });
    assert.equal(remind(root, { env: { PATH: NO_JQ_PATH, CLAUDE_PROJECT_DIR: root } }), null);
  });

  it("fail-open: silent without briefs/ACTIVE_TASK", () => {
    assert.equal(remind(project({ active: null, events: FULL_TO_PLAN(iso(30 * HOUR_MS)) })), null);
  });

  it("fail-open: silent with an empty ACTIVE_TASK", () => {
    assert.equal(remind(project({ active: "", events: FULL_TO_PLAN(iso(30 * HOUR_MS)) })), null);
  });

  it("fail-open: silent when the ledger is missing", () => {
    assert.equal(remind(project()), null);
  });

  it("fail-open: silent on an invalid or empty ledger", () => {
    assert.equal(remind(project({ ledger: "{not json" })), null);
    assert.equal(remind(project({ ledger: JSON.stringify({ task: "t", mode: "full", events: [] }) })), null);
  });

  it("tezos_bees shape: ledger stops at plan 30h ago, no impl brief -> STALE reminder", () => {
    const ctx = remind(project({ slug: "core-rewrite", events: FULL_TO_PLAN(iso(30 * HOUR_MS)) }));
    assert.match(ctx, /^roster STALE \(>= 4h\)/);
    assert.match(ctx, /task core-rewrite/);
    assert.match(ctx, /ledger still ends at plan\/COMPLETED/);
    assert.match(ctx, /write briefs\/core-rewrite-impl\.md/);
    assert.match(ctx, /append the implement event to briefs\/core-rewrite-state\.json/);
    assert.match(ctx, /friction entry/);
    assert.match(ctx, /\/roster-review/);
  });

  it("fresh open implement -> one-line status, not STALE", () => {
    const ctx = remind(project({ events: FULL_TO_PLAN(iso(1 * HOUR_MS)) }));
    assert.match(ctx, /^roster: implement phase of task t is open since /);
    assert.doesNotMatch(ctx, /STALE/);
    assert.match(ctx, /Closing requires: write briefs\/t-impl\.md/);
  });

  it("impl brief present but no implement event -> half-closed, impl brief not re-requested", () => {
    const ctx = remind(project({ impl: true, events: FULL_TO_PLAN(iso(1 * HOUR_MS)) }));
    assert.match(ctx, /half-closed/);
    assert.doesNotMatch(ctx, /write briefs\/t-impl\.md/);
    assert.match(ctx, /append the implement event/);
  });

  it("implement/PARTIAL keeps the phase open", () => {
    const ctx = remind(project({ events: [...FULL_TO_PLAN(), ev("implement", "PARTIAL", iso(HOUR_MS))] }));
    assert.match(ctx, /ledger ends at implement\/PARTIAL/);
  });

  it("slot still set after implement/COMPLETED -> stale-slot line", () => {
    const ctx = remind(project({ impl: true, events: [...FULL_TO_PLAN(), ev("implement", "COMPLETED", iso(HOUR_MS))] }));
    assert.match(ctx, /still names t, but its ledger already records implement\/COMPLETED/);
    assert.match(ctx, /rm briefs\/ACTIVE_TASK/);
  });

  it("ROSTER_PHASE_STALE_HOURS tunes the threshold; a non-integer falls back to 4", () => {
    const events = FULL_TO_PLAN(iso(2 * HOUR_MS));
    assert.match(remind(project({ events }), { env: { ROSTER_PHASE_STALE_HOURS: "1" } }), /^roster STALE \(>= 1h\)/);
    assert.doesNotMatch(remind(project({ events }), { env: { ROSTER_PHASE_STALE_HOURS: "abc" } }), /STALE/);
    assert.doesNotMatch(remind(project({ events })), /STALE/);
  });

  it("timezone offsets are honoured when computing age", () => {
    // 3h ago, written in +02:00 local time: ignoring the offset would read as 1h (or 5h).
    const t = new Date(Date.now() - 3 * HOUR_MS + 2 * HOUR_MS);
    const at = t.toISOString().replace(/\.\d+Z$/, "+02:00");
    const ctx = remind(project({ events: FULL_TO_PLAN(at) }));
    const age = Number(ctx.match(/\((\d+(?:\.\d)?)h ago/)[1]);
    assert.ok(age >= 2.9 && age <= 3.1, `age ${age}`);
  });

  it("no `at` on the last event -> falls back to the ACTIVE_TASK mtime", () => {
    const root = project({ events: FULL_TO_PLAN() });
    const old = new Date(Date.now() - 10 * HOUR_MS);
    fs.utimesSync(path.join(root, "briefs/ACTIVE_TASK"), old, old);
    assert.match(remind(root), /^roster STALE/);
  });

  it("CLAUDE_PROJECT_DIR locates the project when cwd is elsewhere", () => {
    const root = project({ events: FULL_TO_PLAN(iso(HOUR_MS)) });
    const r = run(REMINDER, { cwd: os.tmpdir(), prompt: "x" }, { env: { CLAUDE_PROJECT_DIR: root } });
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /task t is open/);
  });
});

describe("block-adhoc-review", () => {
  const open = () => project({ slug: "core-rewrite", events: FULL_TO_PLAN(iso(30 * HOUR_MS)) });

  it("fail-open: allows without jq on PATH", () => {
    const root = open();
    assert.equal(spawn(root, REVIEWER, { env: { PATH: NO_JQ_PATH, CLAUDE_PROJECT_DIR: root } }), null);
  });

  it("fail-open: allows without ACTIVE_TASK, without a ledger, or with an invalid ledger", () => {
    assert.equal(spawn(project({ active: null, events: FULL_TO_PLAN() }), REVIEWER), null);
    assert.equal(spawn(project(), REVIEWER), null);
    assert.equal(spawn(project({ ledger: "{not json" }), REVIEWER), null);
  });

  it("allows outside Full mode", () => {
    assert.equal(spawn(project({ mode: "fast", events: [ev("implement", "PARTIAL")] }), REVIEWER), null);
  });

  it("allows once implement is closed (implement/COMPLETED, or a later phase)", () => {
    assert.equal(spawn(project({ events: [...FULL_TO_PLAN(), ev("implement", "COMPLETED")] }), REVIEWER), null);
    assert.equal(spawn(project({ events: [...FULL_TO_PLAN(), ev("implement", "COMPLETED"), ev("review", "NO-GO")] }), REVIEWER), null);
  });

  it("tezos_bees shape: reviewer subagent while the ledger ends at plan -> deny with recovery", () => {
    const reason = spawn(open(), REVIEWER);
    assert.match(reason, /^BLOCKED: review-like subagent \(subagent_type "reviewer"\)/);
    assert.match(reason, /task core-rewrite .* \(ledger ends at plan\/COMPLETED\)/);
    assert.match(reason, /write briefs\/core-rewrite-impl\.md/);
    assert.match(reason, /briefs\/core-rewrite-state\.json/);
    assert.match(reason, /then run \/roster-review/);
    assert.match(reason, /\[outside-roster-review: <reason>\]/);
    assert.match(reason, /ROSTER_ALLOW_ADHOC_REVIEW=1/);
  });

  it("denies during implement/PARTIAL", () => {
    assert.ok(spawn(project({ events: [...FULL_TO_PLAN(), ev("implement", "PARTIAL")] }), REVIEWER));
  });

  it("denies reviewer-like subagent types", () => {
    for (const t of ["pr-review-toolkit:code-reviewer", "architect", "red-team-auditor", "Reviewer"]) {
      assert.ok(spawn(open(), { subagent_type: t, description: "Check work", prompt: "Go." }), t);
    }
  });

  it("denies review wording in the description", () => {
    for (const d of ["Adversarial review round 2", "Audit worker pool", "Red-team the API", "Revue du core"]) {
      assert.ok(spawn(open(), { subagent_type: "general-purpose", description: d, prompt: "Go." }), d);
    }
  });

  it("denies strong review phrases in the prompt", () => {
    for (const p of [
      "You are an adversarial reviewer. Find defects.",
      "You are a skeptical senior code reviewer.",
      "Please review the diff on branch core-rewrite and report findings.",
      "Audit these changes for races.",
      "Faites une revue de code du module worker.",
    ]) {
      assert.ok(spawn(open(), { subagent_type: "general-purpose", description: "Second look", prompt: p }), p);
    }
  });

  it("allows ordinary implementation spawns that mention review in passing", () => {
    for (const input of [
      { subagent_type: "implementer", description: "Implement S3 worker pool",
        prompt: "Implement S3. The review scope gate runs later in /roster-review; keep the manifest." },
      { subagent_type: "general-purpose", description: "Update review.json parser", prompt: "Fix the parser." },
      { subagent_type: "general-purpose", description: "Wire roster-review hook", prompt: "Edit the skill." },
      { subagent_type: "Explore", description: "Find scheduler code",
        prompt: "Read and review the implementation plan in briefs/t-plan.md, then locate the scheduler." },
    ]) {
      assert.equal(spawn(open(), input), null, input.description);
    }
  });

  it("per-spawn override marker allows; an empty reason does not", () => {
    assert.equal(spawn(open(), { ...REVIEWER, prompt: "Go. [outside-roster-review: human approved in chat]" }), null);
    assert.equal(spawn(open(), { ...REVIEWER, description: "[Outside-Roster-Review: false positive]" }), null);
    assert.ok(spawn(open(), { ...REVIEWER, prompt: "Go. [outside-roster-review: ]" }));
  });

  it("session override ROSTER_ALLOW_ADHOC_REVIEW=1 allows; other values do not", () => {
    assert.equal(spawn(open(), REVIEWER, { env: { ROSTER_ALLOW_ADHOC_REVIEW: "1" } }), null);
    assert.ok(spawn(open(), REVIEWER, { env: { ROSTER_ALLOW_ADHOC_REVIEW: "yes" } }));
  });
});
