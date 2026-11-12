"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const CLI = path.join(__dirname, "roster-recovery.cjs");
const CORE = path.join(__dirname, "roster-roadmap.cjs");
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(args, cli = CLI) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  let data; try { data = JSON.parse(r.stdout); } catch { data = { stdout: r.stdout, stderr: r.stderr }; }
  return { code: r.status, data };
}
function ok(args, cli) { const r = run(args, cli); assert.equal(r.code, 0, JSON.stringify(r)); return r.data; }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = path.join(root, "demo-state.json");
  const state = { task: "demo", mode: "full", current_phase: "review", events: [] };
  write(ledger, state);
  return { root, ledger, state, args: ["--ledger", ledger, "--phase", "review"] };
}
function append(f, phase, outcome) { f.state.events.push({ phase, outcome, by: `roster-${phase}` }); f.state.current_phase = phase; write(f.ledger, f.state); }
function decision(f, status, extra = {}) {
  const file = path.join(f.root, "decision.json");
  const { identity, source_count, source_digest, failure_ids } = status;
  write(file, { identity, source_count, source_digest, failure_ids, actor: "owner", basis: "Inspected failing checks", diagnosis: "Fixture shared invalid state", changed_strategy: "Isolate the fixture before changing code", next_discriminating_check: "Run the isolated regression", evidence: ["reports/failure.txt"], ...extra });
  return file;
}
test("actual CLI counts only consecutive selected-phase failures, is read-only, and GO resets", t => {
  const f = fixture(t);
  append(f, "review", "NO-GO"); append(f, "qa", "GO"); append(f, "review", "NO-GO");
  const before = fs.readFileSync(f.ledger, "utf8");
  for (const cmd of ["status", "check", "status"]) {
    const s = ok([cmd, ...f.args]); assert.equal(s.consecutive_failures, 2); assert.equal(s.reframe_needed, false); assert.equal(s.retry_allowed, null);
  }
  assert.equal(fs.readFileSync(f.ledger, "utf8"), before);
  assert.deepEqual(fs.readdirSync(f.root), ["demo-state.json"]);
  append(f, "review", "NO-GO");
  const check = run(["check", ...f.args]); assert.equal(check.code, 2); assert.equal(check.data.status, "needs-reframe");
  append(f, "review", "GO"); assert.equal(ok(["status", ...f.args]).consecutive_failures, 0);
});
test("reframe anchors preserve history, require diagnosis and reject stale/forged resets", t => {
  const f = fixture(t);
  append(f, "review", "NO-GO");
  let s = ok(["status", ...f.args]);
  assert.equal(run(["reframe", ...f.args, "--decision", decision(f, s)]).code, 1);
  append(f, "review", "NO-GO"); append(f, "review", "NO-GO");
  s = ok(["status", ...f.args]);
  assert.equal(run(["reframe", ...f.args, "--decision", decision(f, s, { diagnosis: "" })]).code, 1);
  assert.equal(run(["reframe", ...f.args, "--decision", decision(f, s, { identity: { ...s.identity, task_id: "other" } })]).code, 1);
  const d = decision(f, s); const sourceBefore = fs.readFileSync(f.ledger, "utf8");
  let next = ok(["reframe", ...f.args, "--decision", d]);
  assert.equal(next.consecutive_failures, 0); assert.equal(next.historical_consecutive_failures, 3); assert.equal(next.observations.length, 3); assert.equal(next.reframes.length, 1);
  assert.equal(fs.readFileSync(f.ledger, "utf8"), sourceBefore);
  assert.equal(run(["reframe", ...f.args, "--decision", d]).code, 1);
  append(f, "review", "NO-GO"); append(f, "review", "NO-GO"); append(f, "review", "NO-GO");
  next = ok(["status", ...f.args]); assert.equal(next.consecutive_failures, 3);
  assert.equal(run(["reframe", ...f.args, "--decision", d]).code, 1);
  ok(["reframe", ...f.args, "--decision", decision(f, next)]);
  const artifact = `${f.ledger}.recovery-review.json`, stored = read(artifact);
  assert.equal(stored.records.length, 2);
  stored.records[0].source_digest = "0".repeat(64); write(artifact, stored);
  assert.equal(run(["status", ...f.args]).code, 1);
});
test("changed or deleted source prefixes invalidate saved anchors", t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) append(f, "review", "NO-GO");
  const s = ok(["status", ...f.args]); ok(["reframe", ...f.args, "--decision", decision(f, s)]);
  f.state.events[0].by = "someone-else"; write(f.ledger, f.state);
  assert.equal(run(["status", ...f.args]).code, 1);
  f.state.events.pop(); write(f.ledger, f.state);
  assert.equal(run(["check", ...f.args]).code, 1);
});
test("malformed ledgers, symlinks, and existing locks fail without writes", t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) append(f, "review", "NO-GO");
  const s = ok(["status", ...f.args]), d = decision(f, s), artifact = `${f.ledger}.recovery-review.json`;
  fs.mkdirSync(`${artifact}.lock`);
  assert.equal(run(["reframe", ...f.args, "--decision", d]).code, 1); fs.rmdirSync(`${artifact}.lock`);
  fs.symlinkSync(f.ledger, artifact);
  assert.equal(run(["status", ...f.args]).code, 1);
  assert.equal(run(["reframe", ...f.args, "--decision", d]).code, 1); fs.unlinkSync(artifact);
  const link = path.join(f.root, "linked.json"); fs.symlinkSync(f.ledger, link);
  assert.equal(run(["status", "--ledger", link, "--phase", "review"]).code, 1);
  f.state.events.push({ phase: "review", outcome: "PARTIAL", by: "roster-review" }); write(f.ledger, f.state);
  assert.equal(run(["status", ...f.args]).code, 1);
});
function boardFixture(t, max = 4, policy = "retry") {
  const f = fixture(t), board = path.join(f.root, "board");
  ok(["init", board, "--id", "demo"], CORE);
  const task = { id: "a", intake: "briefs/a-intake.md", objective: "Deliver A", depends_on: [], inputs: [], outputs: ["a.txt"], allowed_files: ["a.txt"], dod: ["Verified"], success: ["Works"], checks: [{ id: "unit", description: "Pass" }], topology: { runtime: "codex", role: "implementer", persona: "Engineer", model: "configured", route: "sequential", fallbacks: [] }, policy: { max_attempts: max, on_failure: policy, stop_if: ["Scope change"], recovery: ["Diagnose"], failure: "Escalate" }, workflow: { recommendation: "none", reason: "Small", steps: [] } };
  write(path.join(board, "roadmap.json"), { schema_version: 1, id: "demo", goal: "Demo", success: ["Works"], global_checks: [{ id: "global", description: "Pass" }], execution: { max_active: 1 }, tasks: [task] });
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: {} } } });
  const digest = ok(["lint", board], CORE).contract_digest;
  const accept = path.join(f.root, "accept.json"); write(accept, { by: "owner", basis: "Agreed", contract_digest: digest });
  function mutate(cmd, args = []) { return ok([cmd, board, "--coordinator", "lead", "--revision", String(read(path.join(board, "state.json")).revision), ...args], CORE); }
  mutate("accept", ["--decision", accept]);
  function blocked() {
    const assignment = mutate("claim", ["--task", "a", "--assignee", "worker"]).assignment;
    const receipt = path.join(f.root, "receipt.json");
    write(receipt, { task_id: "a", attempt_id: assignment.id, assignee: "worker", contract_digest: digest, result: "blocked", summary: "Regression fails", evidence: ["reports/failure.txt"], changed_files: [], checks: [{ id: "unit", status: "fail", evidence: ["reports/failure.txt"] }] });
    mutate("record", ["--receipt", receipt]);
  }
  function release() { mutate("release", ["--task", "a", "--reason", "Inspected work", "--reconciled-by", "lead"]); }
  return { ...f, board, args: ["--board", board, "--task", "a"], blocked, release, mutate };
}
test("roadmap counts actual blocked attempts, never claims/releases, and reframe cannot refund budget", t => {
  const f = boardFixture(t, 3);
  f.blocked(); f.release(); f.blocked(); f.release(); f.blocked();
  const before = fs.readFileSync(path.join(f.board, "state.json"), "utf8");
  const s = ok(["status", ...f.args]); assert.equal(s.consecutive_failures, 3); assert.equal(s.exhausted, true); assert.equal(s.retry_allowed, false);
  const result = ok(["reframe", ...f.args, "--decision", decision(f, s)]);
  assert.equal(result.reframe_needed, false); assert.equal(result.retry_allowed, false); assert.equal(result.exhausted, true);
  assert.equal(fs.readFileSync(path.join(f.board, "state.json"), "utf8"), before);
  const state = read(path.join(f.board, "state.json")); state.receipts[1].attempt_id = state.receipts[0].attempt_id; write(path.join(f.board, "state.json"), state);
  assert.equal(run(["status", ...f.args]).code, 1);
});
test("reconciled roadmap retry remains separate from diagnosed reframe", t => {
  const f = boardFixture(t);
  f.blocked(); f.release(); f.blocked(); f.release(); f.blocked();
  const s = ok(["status", ...f.args]);
  const stateBefore = fs.readFileSync(path.join(f.board, "state.json"), "utf8");
  const refused = run(["release", f.board, "--coordinator", "lead", "--revision", String(read(path.join(f.board, "state.json")).revision), "--task", "a", "--reason", "Try unchanged strategy again", "--reconciled-by", "lead"], CORE);
  assert.equal(refused.code, 1); assert.match(refused.data.error, /three consecutive failures/);
  assert.equal(fs.readFileSync(path.join(f.board, "state.json"), "utf8"), stateBefore);
  const r = ok(["reframe", ...f.args, "--decision", decision(f, s)]);
  assert.equal(r.retry_allowed, false); assert.equal(r.reconciliation_required, true);
  f.release(); assert.equal(ok(["status", ...f.args]).retry_allowed, true);
  f.mutate("claim", ["--task", "a", "--assignee", "worker"]);
  const active = ok(["status", ...f.args]); assert.equal(active.retry_allowed, false); assert.equal(active.reconciliation_required, true);
  const assignment = read(path.join(f.board, "state.json")).tasks.a.assignment;
  const receipt = path.join(f.root, "done.json");
  write(receipt, { task_id: "a", attempt_id: assignment.id, assignee: "worker", contract_digest: assignment.contract_digest, result: "done", summary: "Regression fixed", evidence: ["reports/pass.txt"], changed_files: ["a.txt"], checks: [{ id: "unit", status: "pass", evidence: ["reports/pass.txt"] }] });
  f.mutate("record", ["--receipt", receipt]);
  const done = ok(["status", ...f.args]);
  assert.equal(done.consecutive_failures, 0); assert.equal(done.historical_consecutive_failures, 0); assert.equal(done.total_failures, 3);
  assert.equal(done.attempts, 4); assert.equal(done.retry_allowed, false);
});
test("portable CJS CLI works in an installed ESM consumer with its runtime closure", t => {
  const f = fixture(t), install = path.join(f.root, "installed"); fs.mkdirSync(install);
  write(path.join(install, "package.json"), { type: "module" });
  for (const name of ["roster-recovery.cjs", "roster-roadmap.cjs", "roster-artifacts.cjs", "roster-roadmap-view.cjs", "roster-roadmap-estimates.cjs", "roster-usage.cjs"]) fs.copyFileSync(path.join(__dirname, name), path.join(install, name));
  append(f, "review", "NO-GO");
  assert.equal(ok(["status", ...f.args], path.join(install, "roster-recovery.cjs")).consecutive_failures, 1);
});
test("concurrent real reframe CLIs append at most once", async t => {
  const f = fixture(t); for (let i = 0; i < 3; i++) append(f, "review", "NO-GO");
  const d = decision(f, ok(["status", ...f.args]));
  function concurrent() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, "reframe", ...f.args, "--decision", d]);
      let stdout = ""; child.stdout.on("data", chunk => { stdout += chunk; });
      child.on("error", reject); child.on("close", code => resolve({ code, data: JSON.parse(stdout) }));
    });
  }
  const results = await Promise.all([concurrent(), concurrent()]);
  assert.equal(results.filter(r => r.code === 0).length, 1, JSON.stringify(results));
  assert.equal(read(`${f.ledger}.recovery-review.json`).records.length, 1);
  assert.equal(ok(["status", ...f.args]).observations.length, 3);
});
test("block policy and immutable accepted contract remain authoritative", t => {
  const f = boardFixture(t, 4, "block"); f.blocked();
  const s = ok(["status", ...f.args]); assert.equal(s.consecutive_failures, 1); assert.equal(s.retry_allowed, false);
  assert.ok(s.retry_blockers.some(reason => reason.includes("policy")));
  const contractFile = path.join(f.board, "roadmap.json"), contract = read(contractFile);
  contract.tasks[0].objective = "A different mission"; write(contractFile, contract);
  assert.equal(run(["status", ...f.args]).code, 1);
});
test("saved reframe cannot reset a different task/phase or accept truncated history", t => {
  const f = fixture(t); for (let i = 0; i < 3; i++) append(f, "review", "NO-GO");
  const s = ok(["status", ...f.args]); ok(["reframe", ...f.args, "--decision", decision(f, s)]);
  const saved = read(`${f.ledger}.recovery-review.json`);
  write(`${f.ledger}.recovery-qa.json`, saved);
  assert.equal(run(["status", "--ledger", f.ledger, "--phase", "qa"]).code, 1);
  f.state.events = f.state.events.slice(0, 2); write(f.ledger, f.state);
  assert.equal(run(["status", ...f.args]).code, 1);
});
