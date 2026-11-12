"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const CLI = path.join(__dirname, "roster-roadmap.cjs");
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-roadmap-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(board, command, args = [], cli = CLI) {
  const out = spawnSync(process.execPath, [cli, command, board, ...args], { encoding: "utf8" });
  let data;
  try { data = JSON.parse(out.stdout); } catch { data = { raw: out.stdout, stderr: out.stderr }; }
  return { code: out.status, data, stderr: out.stderr };
}
function ok(board, command, args = []) {
  const out = run(board, command, args);
  assert.equal(out.code, 0, JSON.stringify(out));
  return out.data;
}
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function task(id, deps = []) {
  return {
    id, intake: `briefs/${id}-intake.md`, objective: `Deliver ${id}`,
    depends_on: deps, inputs: [], outputs: [`src/${id}.js`], allowed_files: [`src/${id}.js`],
    dod: ["Reviewed and verified"], success: [`${id} works`],
    checks: [{ id: "unit", description: "Unit checks pass", command: "node --test" }],
    topology: { runtime: "codex", role: "implementer", persona: "Careful engineer", model: "configured-model", route: "sequential", fallbacks: [] },
    policy: { max_attempts: 2, on_failure: "retry", stop_if: ["Scope changes"], recovery: ["Diagnose then retry"], failure: "Attempts exhausted" },
    workflow: { recommendation: "none", reason: "Single bounded mission", steps: [] },
  };
}
function fixture(t, tasks = [task("a")], execution = { max_active: 1 }) {
  const root = temporary(t), board = path.join(root, "board");
  ok(board, "init", ["--id", "demo"]);
  const contract = { schema_version: 1, id: "demo", goal: "Deliver the complete demo", success: ["Demo scenario works"], global_checks: [{ id: "demo", description: "Integrated demo passes" }], execution, tasks };
  write(path.join(board, "roadmap.json"), contract);
  const capabilities = { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Current runtime observed"], capabilities: {} } } };
  write(path.join(board, "capabilities.json"), capabilities);
  return { root, board, contract, capabilities };
}
function mutate(board, command, args = []) {
  const state = read(path.join(board, "state.json"));
  return run(board, command, ["--coordinator", "lead", "--revision", String(state.revision), ...args]);
}
function accepted(t, tasks, execution) {
  const f = fixture(t, tasks, execution);
  const lint = ok(f.board, "lint");
  const decision = path.join(f.root, "decision.json");
  write(decision, { by: "owner", basis: "Explicit agreed roadmap", contract_digest: lint.contract_digest });
  const result = mutate(f.board, "accept", ["--decision", decision]);
  assert.equal(result.code, 0, JSON.stringify(result));
  return f;
}
function claim(board, id = "a", assignee = "worker") {
  const out = mutate(board, "claim", ["--task", id, "--assignee", assignee]);
  assert.equal(out.code, 0, JSON.stringify(out));
  return out.data;
}
function receiptFor(board, id = "a", result = "done") {
  const state = read(path.join(board, "state.json")), assignment = state.tasks[id].assignment;
  return { task_id: id, attempt_id: assignment.id, assignee: assignment.assignee, contract_digest: assignment.contract_digest, result, summary: `${id} ${result}`, evidence: ["reports/unit.txt"], changed_files: result === "done" ? [`src/${id}.js`] : [], checks: [{ id: "unit", status: result === "done" ? "pass" : "fail", evidence: ["reports/unit.txt"] }] };
}
function record(board, receipt) {
  const file = path.join(path.dirname(board), "candidate.json"); write(file, receipt);
  return mutate(board, "record", ["--receipt", file]);
}
function enable(f, names) {
  for (const name of names) f.capabilities.runtimes.codex.capabilities[name] = { supported: true, authorized: true, evidence: ["Observed tools and owner authorization"] };
  write(path.join(f.board, "capabilities.json"), f.capabilities);
}

test("real CLI lifecycle requires distinct global acceptance and preserves receipts", t => {
  const { board, root } = accepted(t, [task("a"), task("b", ["a"])]);
  assert.equal(ok(board, "next").task.id, "a");
  claim(board); assert.equal(record(board, receiptFor(board)).code, 0);
  assert.equal(ok(board, "next").task.id, "b");
  claim(board, "b"); assert.equal(record(board, receiptFor(board, "b")).code, 0);
  assert.equal(ok(board, "next").status, "global-verification-needed");
  const state = read(path.join(board, "state.json"));
  const file = path.join(root, "global.json");
  write(file, { contract_digest: state.acceptance.contract_digest, state_revision: state.revision, summary: "Integration verified", evidence: ["reports/demo.txt"], checks: [{ id: "demo", status: "pass", evidence: ["reports/demo.txt"] }] });
  assert.equal(mutate(board, "complete", ["--receipt", file]).code, 0);
  assert.equal(ok(board, "next").status, "complete");
  assert.equal(read(path.join(board, "state.json")).receipts.length, 2);
});

test("init makes a non-executable draft and never overwrites files", t => {
  const root = temporary(t), board = path.join(root, "board");
  ok(board, "init", ["--id", "draft"]);
  assert.notEqual(run(board, "lint").code, 0);
  assert.notEqual(run(board, "next").code, 0);
  const before = fs.readFileSync(path.join(board, "roadmap.json"), "utf8");
  assert.notEqual(run(board, "init", ["--id", "draft"]).code, 0);
  assert.equal(fs.readFileSync(path.join(board, "roadmap.json"), "utf8"), before);
});

for (const [label, change] of [
  ["dependency cycle", c => { c.tasks[0].depends_on = ["b"]; c.tasks.push(task("b", ["a"])); }],
  ["unknown dependency", c => { c.tasks[0].depends_on = ["missing"]; }],
  ["duplicate IDs", c => c.tasks.push(task("a"))],
  ["empty checks", c => { c.tasks[0].checks = []; }],
  ["empty success", c => { c.success = []; }],
  ["traversal scope", c => { c.tasks[0].allowed_files = ["../secret"]; }],
  ["missing failure policy", c => { delete c.tasks[0].policy; }],
  ["unknown contract field", c => { c.sucess = []; }],
]) test(`lint refuses ${label}`, t => {
  const { board, contract } = fixture(t); change(contract); write(path.join(board, "roadmap.json"), contract);
  assert.notEqual(run(board, "lint").code, 0);
});

test("stale acceptance cannot authorize a modified contract", t => {
  const { board, contract } = accepted(t);
  contract.goal = "A different goal"; write(path.join(board, "roadmap.json"), contract);
  assert.notEqual(run(board, "next").code, 0);
  assert.notEqual(mutate(board, "claim", ["--task", "a", "--assignee", "worker"]).code, 0);
});

test("coordinator ownership, stale revision and lock conflicts refuse without state mutation", t => {
  const { board } = accepted(t), file = path.join(board, "state.json"), before = fs.readFileSync(file, "utf8");
  const state = read(file);
  assert.notEqual(run(board, "claim", ["--coordinator", "stranger", "--revision", String(state.revision), "--task", "a", "--assignee", "worker"]).code, 0);
  assert.notEqual(run(board, "claim", ["--coordinator", "lead", "--revision", "0", "--task", "a", "--assignee", "worker"]).code, 0);
  fs.mkdirSync(path.join(board, ".lock"));
  assert.notEqual(mutate(board, "claim", ["--task", "a", "--assignee", "worker"]).code, 0);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("unsupported routes block unless fallback explicitly permits sequential", t => {
  const a = task("a"); a.topology.route = "subagent";
  const f = accepted(t, [a]);
  assert.equal(ok(f.board, "next").status, "blocked");
  assert.notEqual(mutate(f.board, "claim", ["--task", "a", "--assignee", "worker"]).code, 0);
  a.topology.fallbacks = ["sequential"];
  // Start a separate accepted board; accepted contracts cannot be edited in place.
  const g = accepted(t, [a]);
  assert.equal(ok(g.board, "next").route, "sequential");
});

test("support without authorization cannot activate multisession", t => {
  const a = task("a"); a.topology.route = "multisession";
  const f = accepted(t, [a]); enable(f, ["multisession"]);
  f.capabilities.runtimes.codex.capabilities.multisession.authorized = false;
  write(path.join(f.board, "capabilities.json"), f.capabilities);
  assert.equal(ok(f.board, "next").status, "blocked");
});

test("parallel claims require capability and disjoint active scopes", t => {
  const a = task("a"), b = task("b"), c = task("c");
  a.topology.route = b.topology.route = c.topology.route = "parallel";
  c.allowed_files = ["src/"];
  const f = accepted(t, [a, b, c], { max_active: 3 }); enable(f, ["parallel"]);
  claim(f.board, "a"); claim(f.board, "b", "other-worker");
  assert.notEqual(mutate(f.board, "claim", ["--task", "c", "--assignee", "third"]).code, 0);
});

test("blocked branch does not hide other ready work and retries remain bounded", t => {
  const { board } = accepted(t, [task("a"), task("b")]);
  claim(board); assert.equal(record(board, receiptFor(board, "a", "blocked")).code, 0);
  assert.equal(ok(board, "next").task.id, "b");
  claim(board, "b"); assert.equal(record(board, receiptFor(board, "b")).code, 0);
  assert.equal(mutate(board, "release", ["--task", "a", "--reason", "Cause addressed", "--reconciled-by", "lead"]).code, 0);
  claim(board); assert.equal(record(board, receiptFor(board, "a", "blocked")).code, 0);
  assert.notEqual(mutate(board, "release", ["--task", "a", "--reason", "Try again", "--reconciled-by", "lead"]).code, 0);
  assert.equal(ok(board, "next").status, "blocked");
});

for (const [label, change] of [
  ["foreign assignee", r => { r.assignee = "someone-else"; }],
  ["stale attempt", r => { r.attempt_id = "old"; }],
  ["stale contract", r => { r.contract_digest = "0".repeat(64); }],
  ["missing check", r => { r.checks = []; }],
  ["failed check hidden as done", r => { r.checks[0].status = "fail"; }],
  ["missing evidence", r => { r.evidence = []; }],
  ["out-of-scope write", r => { r.changed_files = ["secrets.txt"]; }],
  ["traversal write", r => { r.changed_files = ["src/../secret"]; }],
]) test(`record rejects ${label} without mutation`, t => {
  const { board } = accepted(t); claim(board);
  const before = fs.readFileSync(path.join(board, "state.json"), "utf8");
  const receipt = receiptFor(board); change(receipt);
  assert.notEqual(record(board, receipt).code, 0);
  assert.equal(fs.readFileSync(path.join(board, "state.json"), "utf8"), before);
});

test("duplicate receipt and duplicate active claim cannot replay work", t => {
  const { board } = accepted(t); claim(board);
  assert.notEqual(mutate(board, "claim", ["--task", "a", "--assignee", "worker"]).code, 0);
  const receipt = receiptFor(board); assert.equal(record(board, receipt).code, 0);
  assert.notEqual(record(board, receipt).code, 0);
});

test("active work survives resume until explicit reconciliation", t => {
  const { board } = accepted(t); claim(board);
  assert.equal(ok(board, "next").status, "active");
  assert.notEqual(mutate(board, "release", ["--task", "a", "--reason", "No response"]).code, 0);
  assert.equal(mutate(board, "release", ["--task", "a", "--reason", "Process stopped and worktree inspected", "--reconciled-by", "lead"]).code, 0);
  claim(board);
  assert.equal(read(path.join(board, "state.json")).tasks.a.attempts, 2);
});

test("premature, failing and empty global receipts cannot complete", t => {
  const { board, root } = accepted(t), file = path.join(root, "global.json");
  const global = { contract_digest: ok(board, "lint").contract_digest, summary: "Demo", evidence: ["demo.txt"], checks: [{ id: "demo", status: "pass", evidence: ["demo.txt"] }] };
  write(file, global); assert.notEqual(mutate(board, "complete", ["--receipt", file]).code, 0);
  claim(board); assert.equal(record(board, receiptFor(board)).code, 0);
  global.state_revision = read(path.join(board, "state.json")).revision;
  global.checks[0].status = "fail"; write(file, global);
  const failing = mutate(board, "complete", ["--receipt", file]);
  assert.notEqual(failing.code, 0); assert.match(failing.data.error, /failing checks/);
  global.checks = []; write(file, global);
  const missing = mutate(board, "complete", ["--receipt", file]);
  assert.notEqual(missing.code, 0); assert.match(missing.data.error, /cover every declared check/);
});

test("prompt gives bounded goal, state, mission and continuation without notes/history", t => {
  const { board } = accepted(t); claim(board);
  fs.writeFileSync(path.join(board, "notes", "large.md"), "UNRELATED_HISTORY".repeat(10000));
  const prompt = ok(board, "prompt", ["--task", "a", "--max-chars", "8000"]);
  assert.match(prompt.prompt, /Deliver the complete demo/);
  assert.match(prompt.prompt, /Reviewed and verified/);
  assert.match(prompt.prompt, /continu/i);
  assert.match(prompt.prompt, /active/);
  assert.doesNotMatch(prompt.prompt, /UNRELATED_HISTORY/);
  assert.ok(prompt.prompt.length <= 8000);
  assert.notEqual(run(board, "prompt", ["--task", "a", "--max-chars", "100"]).code, 0);
});

test("malformed state, unknown options and unsafe managed links fail closed", t => {
  const { board, root } = accepted(t), state = path.join(board, "state.json");
  const bytes = fs.readFileSync(state);
  assert.notEqual(run(board, "claim", ["--typo", "a"]).code, 0);
  fs.writeFileSync(state, "{bad"); assert.notEqual(run(board, "status").code, 0);
  fs.writeFileSync(state, bytes);
  const outside = path.join(root, "outside.json"); fs.writeFileSync(outside, bytes); fs.unlinkSync(state); fs.symlinkSync(outside, state);
  assert.notEqual(mutate(board, "claim", ["--task", "a", "--assignee", "worker"]).code, 0);
  assert.deepEqual(fs.readFileSync(outside), bytes);
});

test("standalone runtime closure runs inside ESM consumer without repository dependencies", t => {
  const root = temporary(t), cli = path.join(root, "roster-roadmap.cjs"), board = path.join(root, "board");
  write(path.join(root, "package.json"), { type: "module" });
  for (const name of ["roster-roadmap.cjs", "roster-artifacts.cjs", "roster-recovery.cjs", "roster-roadmap-view.cjs", "roster-roadmap-estimates.cjs", "roster-usage.cjs"]) fs.copyFileSync(path.join(__dirname, name), path.join(root, name));
  const out = run(board, "init", ["--id", "esm-consumer"], cli);
  assert.equal(out.code, 0, JSON.stringify(out));
  assert.equal(read(path.join(board, "roadmap.json")).id, "esm-consumer");
});

test("capability changes invalidate active result acceptance", t => {
  const f = accepted(t); claim(f.board);
  const receipt = receiptFor(f.board);
  enable(f, ["multisession"]);
  assert.notEqual(record(f.board, receipt).code, 0);
  assert.equal(ok(f.board, "next").status, "active");
});

test("two sequential missions cannot bypass parallel authorization", t => {
  const { board } = accepted(t, [task("a"), task("b")], { max_active: 2 });
  claim(board);
  assert.notEqual(mutate(board, "claim", ["--task", "b", "--assignee", "other"]).code, 0);
});

test("global evidence must bind the latest execution revision", t => {
  const { board, root } = accepted(t), revision = read(path.join(board, "state.json")).revision;
  claim(board); assert.equal(record(board, receiptFor(board)).code, 0);
  const file = path.join(root, "global.json");
  write(file, { contract_digest: ok(board, "lint").contract_digest, state_revision: revision, summary: "Old global result", evidence: ["old-report"], checks: [{ id: "demo", status: "pass", evidence: ["old-report"] }] });
  assert.notEqual(mutate(board, "complete", ["--receipt", file]).code, 0);
});

test("corrupt stored global result never reports a complete roadmap", t => {
  const { board } = accepted(t), file = path.join(board, "state.json"), state = read(file);
  state.global_receipt = {}; write(file, state);
  assert.notEqual(run(board, "status").code, 0);
  assert.notEqual(run(board, "next").code, 0);
});

test("unknown checks, invalid capability flags and linked ancestors refuse", t => {
  const f = accepted(t); claim(f.board);
  const receipt = receiptFor(f.board); receipt.checks.push({ id: "invented", status: "pass", evidence: ["assertion"] });
  assert.notEqual(record(f.board, receipt).code, 0);
  f.capabilities.runtimes.codex.capabilities.parallel = { supported: true, authorized: "yes", evidence: ["assertion"] };
  write(path.join(f.board, "capabilities.json"), f.capabilities);
  assert.notEqual(run(f.board, "next").code, 0);
  const link = path.join(f.root, "alias"); fs.symlinkSync(f.board, link);
  assert.notEqual(run(link, "status").code, 0);
});

test("concurrent CLI claim processes preserve one winner and all prior receipts", { timeout: 10000 }, async t => {
  const { board } = accepted(t, [task("a"), task("b", ["a"])]);
  claim(board, "a"); assert.equal(record(board, receiptFor(board, "a")).code, 0);
  const stateFile = path.join(board, "state.json"), before = read(stateFile);
  function competingClaim(assignee) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, "claim", board, "--coordinator", "lead", "--revision", String(before.revision), "--task", "b", "--assignee", assignee], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", code => {
        try { resolve({ code, data: JSON.parse(stdout), stderr }); }
        catch (error) { reject(error); }
      });
    });
  }
  const results = await Promise.all([competingClaim("worker-one"), competingClaim("worker-two")]);
  const winners = results.filter(result => result.code === 0), losers = results.filter(result => result.code !== 0);
  assert.equal(winners.length, 1, JSON.stringify(results));
  assert.equal(losers.length, 1, JSON.stringify(results));
  assert.match(losers[0].data.error, /lock unavailable|stale revision/);
  const after = read(stateFile);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.tasks.a.status, "done");
  assert.equal(after.tasks.b.status, "active");
  assert.equal(after.tasks.b.attempts, 1);
  assert.deepEqual(after.tasks.b.assignment, winners[0].data.assignment);
  assert.deepEqual(after.receipts, before.receipts);
  assert.equal(Object.values(after.tasks).filter(taskState => taskState.status === "active").length, 1);
});

test("task handoff never routes its worker to another ready mission", t => {
  const f = accepted(t, [task("a"), task("b")], { max_active: 2 }); enable(f, ["parallel"]);
  claim(f.board, "a");
  assert.equal(ok(f.board, "next").task.id, "b");
  const view = JSON.parse(ok(f.board, "prompt", ["--task", "a"]).prompt);
  assert.equal(view.mission.id, "a");
  assert.doesNotMatch(view.next_action, /\bb\b/);
  assert.match(view.next_action, /a.*receipt|receipt.*a/i);
  assert.doesNotMatch(view.continuation, /work another|refresh next|next\/prompt/i);
  assert.match(view.continuation, /return.*receipt|receipt.*return/i);
  const coordinator = JSON.parse(ok(f.board, "prompt").prompt);
  assert.match(coordinator.next_action, /Claim b/);
});

test("aggregate receipt growth refuses before persisting an unreadable state", t => {
  const { board } = accepted(t, [task("a"), task("b")]);
  claim(board, "a");
  const first = receiptFor(board, "a"); first.evidence = ["é".repeat(4.5 * 1024 * 1024)];
  assert.equal(record(board, first).code, 0);
  claim(board, "b");
  const second = receiptFor(board, "b"); second.evidence = ["é".repeat(4.5 * 1024 * 1024)];
  const file = path.join(board, "state.json"), before = fs.readFileSync(file);
  const result = record(board, second);
  assert.notEqual(result.code, 0);
  assert.match(result.data.error, /size|oversized|limit/i);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(ok(board, "status").counts.active, 1);
  assert.equal(read(file).receipts.length, 1);
});

test("stored attempts must reconcile with claim and receipt history", t => {
  const { board } = accepted(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    claim(board); assert.equal(record(board, receiptFor(board, "a", "blocked")).code, 0);
    if (attempt === 0) assert.equal(mutate(board, "release", ["--task", "a", "--reason", "Cause addressed", "--reconciled-by", "lead"]).code, 0);
  }
  const file = path.join(board, "state.json"), state = read(file);
  assert.equal(state.events.filter(event => event.action === "claim").length, 2);
  state.tasks.a.attempts = 1; write(file, state);
  const before = fs.readFileSync(file);
  const result = mutate(board, "release", ["--task", "a", "--reason", "Attempt rollback", "--reconciled-by", "lead"]);
  assert.notEqual(result.code, 0);
  assert.match(result.data.error, /attempt|history/i);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.notEqual(run(board, "status").code, 0);
});

test("exhausted blocked missions expose budget and recovery without hiding failure", t => {
  const a = task("a"); a.policy.max_attempts = 1;
  const { board } = accepted(t, [a]); claim(board);
  const receipt = receiptFor(board, "a", "blocked"); receipt.summary = "Verification failed on the edge case";
  assert.equal(record(board, receipt).code, 0);
  const result = ok(board, "next"), blocked = result.blocked[0];
  assert.equal(blocked.attempts, 1); assert.equal(blocked.max_attempts, 1); assert.equal(blocked.exhausted, true);
  assert.equal(blocked.reason, receipt.summary);
  assert.deepEqual(blocked.recovery, a.policy.recovery);
  assert.match(blocked.next_action, /exhaust|revis|decision/i);
  const progress = ok(board, "status").tasks.find(item => item.id === "a");
  assert.equal(progress.exhausted, true); assert.equal(progress.reason, receipt.summary);
  assert.deepEqual(read(path.join(board, "state.json")).receipts[0].checks, receipt.checks);
});

test("stored receipt writes remain exact files even when their allowed scope is a directory", t => {
  const a = task("a"); a.allowed_files = ["src/"];
  const { board } = accepted(t, [a]); claim(board);
  assert.equal(record(board, receiptFor(board)).code, 0);
  const file = path.join(board, "state.json"), state = read(file);
  state.receipts[0].changed_files = ["src/"]; write(file, state);
  const result = run(board, "status");
  assert.notEqual(result.code, 0); assert.match(result.data.error, /must name a file/);
});
