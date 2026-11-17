"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("./roster-roadmap.cjs");
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const read = file => JSON.parse(fs.readFileSync(file));
function task(id, depends = []) {
  return { id, intake: `briefs/${id}.md`, objective: `Deliver ${id}`, depends_on: depends, inputs: [], outputs: [], allowed_files: [`src/${id}.js`],
    dod: ["Checks pass"], success: ["Observable success"], checks: [{ id: "test", description: "Run test" }],
    topology: { runtime: "codex", model: "configured", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] },
    policy: { max_attempts: 4, on_failure: "retry", stop_if: ["Scope changed"], recovery: ["Diagnose"], failure: "Budget exhausted" },
    workflow: { recommendation: "none", reason: "Bounded mission", steps: [] } };
}
function fixture(t, { accept = true, tasks = [task("a"), task("b", ["a"])] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-requests-")), board = path.join(root, "board");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  core.main(["init", board, "--id", "demo"]);
  const contract = { schema_version: 1, id: "demo", goal: "Deliver demo", success: ["Integrated success"], global_checks: [{ id: "global", description: "Demo works" }], execution: { max_active: 1 }, tasks };
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: {} } } });
  if (accept) {
    const decision = path.join(root, "decision.json");
    write(decision, { by: "owner", basis: "Disposable test", contract_digest: core.hash(contract) });
    core.main(["accept", board, "--coordinator", "lead", "--revision", "0", "--decision", decision]);
  }
  return { root, board, annex: path.join(board, "requests.json"), state: path.join(board, "state.json"), contract: path.join(board, "roadmap.json") };
}
const BASE = { id: "key-b", to: { kind: "role", label: "owner" }, kind: "supply", text: "Install the staging key out of band", task_id: "b", need: "before-task" };
function run(f, command, flag, body, revision, extra = {}, coordinator = "lead") {
  const file = path.join(f.root, `${flag}.json`); write(file, body);
  const args = [command, f.board, "--coordinator", coordinator, "--revision", String(revision), `--${flag}`, file];
  if (extra.id) args.push("--id", extra.id);
  return core.main(args);
}
const open = (f, body, revision, coordinator) => run(f, "request-open", "request", body, revision, {}, coordinator);
const answer = (f, id, body, revision) => run(f, "request-answer", "answer", body, revision, { id });
const withdraw = (f, id, body, revision) => run(f, "request-withdraw", "withdrawal", body, revision, { id });
const journal = (f, body, revision) => run(f, "request-journal", "journal", body, revision);
const bytes = f => [fs.readFileSync(f.state), fs.readFileSync(f.contract)];
function unchanged(f, fn, pattern) {
  const before = bytes(f), annex = fs.existsSync(f.annex) ? fs.readFileSync(f.annex) : null;
  assert.throws(fn, pattern);
  assert.deepEqual(bytes(f), before);
  assert.deepEqual(fs.existsSync(f.annex) ? fs.readFileSync(f.annex) : null, annex);
}

test("AC-1 open records one request without touching state or contract", t => {
  const f = fixture(t), before = bytes(f);
  const result = open(f, BASE, 0);
  assert.equal(result.requests_revision, 1);
  const annex = read(f.annex);
  assert.equal(annex.revision, 1); assert.equal(annex.history.length, 1);
  assert.equal(annex.requests.length, 1);
  assert.deepEqual([annex.requests[0].status, annex.requests[0].created_by, annex.requests[0].answer, annex.requests[0].withdrawal, annex.requests[0].refs], ["open", "lead", null, null, []]);
  assert.match(annex.requests[0].created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(annex.history[0], { revision: 1, action: "open", request_id: "key-b", coordinator: "lead", at: annex.requests[0].created_at });
  assert.deepEqual(bytes(f), before);
});

test("AC-2 open refusals leave every file unchanged", t => {
  const f = fixture(t);
  unchanged(f, () => open(f, BASE, 0, "other"), /foreign coordinator/);
  unchanged(f, () => open(f, BASE, 3), /stale requests revision/);
  open(f, BASE, 0);
  unchanged(f, () => open(f, BASE, 0), /stale requests revision/);
  unchanged(f, () => open(f, BASE, 1), /already used/);
  unchanged(f, () => open(f, { ...BASE, id: "x1", task_id: "nope" }, 1), /unknown task/);
  unchanged(f, () => open(f, { ...BASE, id: "x2", task_id: null }, 1), /requires a task/);
  unchanged(f, () => open(f, { ...BASE, id: "x3", extra: 1 }, 1), /unknown fields/);
  unchanged(f, () => open(f, { ...BASE, id: "x4", kind: "wish" }, 1), /kind must be one of/);
  unchanged(f, () => open(f, { ...BASE, id: "x5", text: "  " }, 1), /text must be nonempty/);
  unchanged(f, () => open(f, { ...BASE, id: "x6", refs: Array(11).fill("r") }, 1), /refs/);
  unchanged(f, () => open(f, { ...BASE, id: "bad id" }, 1), /safe identifier/);
});

test("refuses control, bidi and invisible characters at write, allows newline and tab in texts", t => {
  const f = fixture(t);
  for (const bad of ["a\u202eb", "a\u200bb", "a\u0007b", "a\u0085b", "a\u007fb", "a\u2028b", "a\rb"]) {
    unchanged(f, () => open(f, { ...BASE, id: "c1", text: bad }, 0), /control, bidirectional or invisible/);
  }
  unchanged(f, () => open(f, { ...BASE, id: "c2", to: { kind: "role", label: "own\ner" } }, 0), /control, bidirectional/);
  unchanged(f, () => open(f, { ...BASE, id: "c3", refs: ["a\u202ab"] }, 0), /control, bidirectional/);
  open(f, { ...BASE, id: "c4", text: "line one\n\tline two" }, 0);
  assert.equal(read(f.annex).requests[0].text, "line one\n\tline two");
});

test("AC-3 answer and withdraw record who and when", t => {
  const f = fixture(t);
  open(f, BASE, 0); open(f, { ...BASE, id: "q1", need: "later" }, 1);
  answer(f, "key-b", { text: "Installed; see vault entry ops/staging", by: "owner" }, 2);
  withdraw(f, "q1", { reason: "Settled from logs" }, 3);
  const annex = read(f.annex), [a, q] = annex.requests;
  assert.equal(a.status, "answered");
  assert.deepEqual(a.answer, { text: "Installed; see vault entry ops/staging", by: "owner", at: a.answer.at, relayed_by: "lead" });
  assert.equal(q.status, "withdrawn");
  assert.deepEqual(q.withdrawal, { reason: "Settled from logs", by: "lead", at: q.withdrawal.at });
  assert.equal(annex.revision, 4);
  assert.deepEqual(annex.history.map(h => h.action), ["open", "open", "answer", "withdraw"]);
  assert.equal(a.text, BASE.text); assert.equal(a.created_by, "lead");
});

test("AC-4 terminal states are final and supersedes obeys its rules", t => {
  const f = fixture(t);
  open(f, BASE, 0); open(f, { ...BASE, id: "q1", need: "later" }, 1);
  answer(f, "key-b", { text: "Done", by: "owner" }, 2);
  unchanged(f, () => answer(f, "key-b", { text: "Again", by: "owner" }, 3), /terminal states are final/);
  unchanged(f, () => withdraw(f, "key-b", { reason: "No" }, 3), /terminal states are final/);
  unchanged(f, () => answer(f, "ghost", { text: "x", by: "owner" }, 3), /unknown request/);
  unchanged(f, () => answer(f, "q1", { text: "x", by: "owner", more: 1 }, 3), /exactly the fields/);
  unchanged(f, () => open(f, { ...BASE, id: "n1", supersedes: "q1" }, 3), /open request q1/);
  unchanged(f, () => open(f, { ...BASE, id: "n2", supersedes: "ghost" }, 3), /unknown request/);
  open(f, { ...BASE, id: "n3", supersedes: "key-b" }, 3);
  unchanged(f, () => open(f, { ...BASE, id: "n4", supersedes: "key-b" }, 4), /already superseded/);
  withdraw(f, "q1", { reason: "Obsolete" }, 4);
  unchanged(f, () => open(f, { ...BASE, id: "n5", supersedes: "n3" }, 5), /open request n3/);
});

test("AC-11 journal reference is inert, settable and clearable", t => {
  const f = fixture(t);
  journal(f, { path: "~/notes/demo/journal.html" }, 0);
  assert.equal(read(f.annex).journal, "~/notes/demo/journal.html");
  assert.equal(core.main(["view", f.board]).operator_requests.journal, "~/notes/demo/journal.html");
  journal(f, { path: null }, 1);
  assert.equal(read(f.annex).journal, null); assert.equal(read(f.annex).revision, 2);
  unchanged(f, () => journal(f, { path: "" }, 2), /journal must be nonempty/);
  unchanged(f, () => journal(f, { path: "a\u0001b" }, 2), /control/);
  unchanged(f, () => journal(f, { path: "x".repeat(1001) }, 2), /journal must be nonempty text of at most 1000/);
  unchanged(f, () => journal(f, { path: "x", extra: 1 }, 2), /exactly the fields/);
});

test("lock, symlinked annex, foreign board and corrupt history refuse writes", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.board, ".lock"));
  unchanged(f, () => open(f, BASE, 0), /lock unavailable/);
  fs.rmdirSync(path.join(f.board, ".lock"));
  open(f, BASE, 0);
  const good = read(f.annex);
  write(f.annex, { ...good, board_id: "other" });
  unchanged(f, () => answer(f, "key-b", { text: "x", by: "o" }, 1), /annex invalid.*different board/);
  write(f.annex, { ...good, revision: 5 });
  unchanged(f, () => journal(f, { path: "x" }, 5), /revision must equal the history length/);
  write(f.annex, { ...good, extra: true });
  unchanged(f, () => journal(f, { path: "x" }, 1), /annex invalid/);
  fs.writeFileSync(f.annex, "{ not json");
  unchanged(f, () => journal(f, { path: "x" }, 1), /annex invalid/);
  fs.rmSync(f.annex); write(path.join(f.root, "real.json"), good); fs.symlinkSync(path.join(f.root, "real.json"), f.annex);
  unchanged(f, () => journal(f, { path: "x" }, 1), /annex invalid.*symlink/);
  assert.equal(core.main(["view", f.board]).operator_requests.status, "invalid");
  assert.equal(fs.existsSync(path.join(f.board, ".lock")), false);
});

test("a held lock refuses immediately and a retry after release succeeds", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.board, ".lock"));
  assert.throws(() => open(f, BASE, 0), /lock unavailable/);
  fs.rmdirSync(path.join(f.board, ".lock"));
  assert.equal(open(f, BASE, 0).requests_revision, 1);
});

test("limits: 100 open requests, 500 in total", t => {
  const f = fixture(t);
  const annex = { schema_version: 1, board_id: "demo", revision: 0, journal: null, requests: [], history: [] };
  const mk = (i, status) => ({ id: `r${i}`, to: { kind: "role", label: "o" }, kind: "action", text: "t", task_id: null, need: "later", refs: [], created_at: "2026-11-13T10:00:00.000Z", created_by: "lead", status, supersedes: null,
    answer: status === "answered" ? { text: "ok", by: "o", at: "2026-11-13T10:00:00.000Z", relayed_by: "lead" } : null, withdrawal: null });
  for (let i = 0; i < 100; i++) annex.requests.push(mk(i, "open"));
  annex.history = annex.requests.map((r, i) => ({ revision: i + 1, action: "open", request_id: r.id, coordinator: "lead", at: r.created_at })); annex.revision = 100;
  write(f.annex, annex);
  unchanged(f, () => open(f, { ...BASE, id: "extra", task_id: null, need: "later" }, 100), /at most 100 open/);
  for (let i = 100; i < 500; i++) annex.requests.push(mk(i, "answered"));
  annex.history = annex.requests.map((r, i) => ({ revision: i + 1, action: "open", request_id: r.id, coordinator: "lead", at: r.created_at })); annex.revision = 500;
  write(f.annex, annex);
  unchanged(f, () => open(f, { ...BASE, id: "extra", task_id: null, need: "later" }, 500), /at most 500/);
});

test("draft boards accept requests from any safe coordinator; task must be in the contract", t => {
  const f = fixture(t, { accept: false });
  open(f, BASE, 0, "drafter");
  assert.equal(read(f.annex).requests[0].created_by, "drafter");
  unchanged(f, () => open(f, { ...BASE, id: "x", task_id: "zzz" }, 1, "drafter"), /unknown task/);
  unchanged(f, () => open(f, { ...BASE, id: "y" }, 1, "bad id"), /safe identifier/);
  assert.equal(read(f.state).acceptance, null);
});

test("after acceptance the coordinator may answer requests opened on the draft", t => {
  const f = fixture(t, { accept: false });
  open(f, BASE, 0, "drafter");
  const contract = read(f.contract);
  const decision = path.join(f.root, "decision.json");
  write(decision, { by: "owner", basis: "ok", contract_digest: core.hash(contract) });
  core.main(["accept", f.board, "--coordinator", "lead", "--revision", "0", "--decision", decision]);
  answer(f, "key-b", { text: "Done", by: "owner" }, 1);
  assert.equal(read(f.annex).requests[0].answer.relayed_by, "lead");
});

test("complete boards refuse open but allow answer, withdraw and journal", t => {
  const f = fixture(t, { tasks: [task("a")] });
  open(f, { ...BASE, task_id: "a", need: "later" }, 0); open(f, { ...BASE, id: "q2", task_id: "a", need: "later" }, 1);
  const claim = core.main(["claim", f.board, "--coordinator", "lead", "--revision", "1", "--task", "a", "--assignee", "w"]);
  const receipt = path.join(f.root, "receipt.json");
  write(receipt, { task_id: "a", attempt_id: claim.assignment.id, assignee: "w", contract_digest: claim.assignment.contract_digest, result: "done", summary: "ok", evidence: ["log"], changed_files: [], checks: [{ id: "test", status: "pass", evidence: ["log"] }] });
  core.main(["record", f.board, "--coordinator", "lead", "--revision", "2", "--receipt", receipt]);
  const global = path.join(f.root, "global.json");
  write(global, { contract_digest: core.hash(read(f.contract)), state_revision: 3, summary: "ok", evidence: ["log"], checks: [{ id: "global", status: "pass", evidence: ["log"] }] });
  core.main(["complete", f.board, "--coordinator", "lead", "--revision", "3", "--receipt", global]);
  unchanged(f, () => open(f, { ...BASE, id: "late", task_id: null, need: "later" }, 2), /globally complete/);
  answer(f, "key-b", { text: "Done", by: "owner" }, 2);
  withdraw(f, "q2", { reason: "Moot" }, 3);
  journal(f, { path: "j.html" }, 4);
  assert.equal(read(f.annex).revision, 5);
});

test("requests never change claim, next or the default status", t => {
  const f = fixture(t);
  const next = core.main(["next", f.board]), status = core.main(["status", f.board]);
  open(f, { ...BASE, id: "blk", task_id: "a", need: "blocking" }, 0);
  const before = bytes(f);
  assert.deepEqual(core.main(["next", f.board]), next);
  assert.deepEqual(core.main(["status", f.board]), status);
  assert.deepEqual(bytes(f), before);
  const claim = core.main(["claim", f.board, "--coordinator", "lead", "--revision", "1", "--task", "a", "--assignee", "w"]);
  assert.equal(claim.task_id, "a");
  assert.ok(!Object.keys(status).includes("operator_requests"));
});

test("a corrupt annex never blocks claim", t => {
  const f = fixture(t);
  fs.writeFileSync(f.annex, "garbage");
  assert.equal(core.main(["claim", f.board, "--coordinator", "lead", "--revision", "1", "--task", "a", "--assignee", "w"]).task_id, "a");
});

test("option validation: coordinator, revision, file and id flags", t => {
  const f = fixture(t);
  const file = path.join(f.root, "r.json"); write(file, BASE);
  assert.throws(() => core.main(["request-open", f.board, "--revision", "0", "--request", file]), /--coordinator/);
  assert.throws(() => core.main(["request-open", f.board, "--coordinator", "lead", "--revision", "x", "--request", file]), /--revision/);
  assert.throws(() => core.main(["request-open", f.board, "--coordinator", "lead", "--revision", "0"]), /--request FILE is required/);
  assert.throws(() => core.main(["request-answer", f.board, "--coordinator", "lead", "--revision", "0", "--answer", file]), /--id/);
  assert.throws(() => core.main(["request-open", f.board, "--coordinator", "lead", "--revision", "0", "--request", file, "--id", "x"]), /unknown or duplicate option/);
  assert.throws(() => core.main(["request-open", path.join(f.root, "none"), "--coordinator", "lead", "--revision", "0", "--request", file]), /cannot read/);
});

test("AC-13 closure: sibling modules and schema doc are installed and the core stays small", () => {
  const root = path.resolve(__dirname, "..");
  const sync = fs.readFileSync(path.join(__dirname, "sync-harness.sh"), "utf8");
  for (const name of ["roster-roadmap-requests.cjs", "roster-roadmap-requests-view.cjs"]) {
    assert.ok(fs.existsSync(path.join(__dirname, name)));
    assert.ok(sync.includes(`/${name}"`)); assert.ok(sync.includes(`/bin/${name}"`));
    assert.equal(fs.readFileSync(path.join(__dirname, name), "utf8"), fs.readFileSync(path.join(root, ".harness/bin", name), "utf8"));
  }
  assert.ok(sync.includes("roadmap-requests-schema.md") && sync.includes("roadmap/requests-schema.md"));
  assert.ok(fs.readFileSync(path.join(__dirname, "roster-roadmap.cjs"), "utf8").split("\n").length - 1 <= 500);
});

test("FR-003 refuses every Unicode format character and both separators in every string", t => {
  const f = fixture(t);
  const bad = ["؜", "­", "᠎", "\u{E0041}", "\u{E007F}", " ", "‎", "⁦"].map(c => `a${c}b`);
  for (const value of bad) {
    unchanged(f, () => open(f, { ...BASE, id: "f1", text: value }, 0), /control, bidirectional or invisible/);
    unchanged(f, () => open(f, { ...BASE, id: "f2", to: { kind: "role", label: value } }, 0), /control, bidirectional or invisible/);
    unchanged(f, () => open(f, { ...BASE, id: "f3", refs: [value] }, 0), /control, bidirectional or invisible/);
    unchanged(f, () => journal(f, { path: value }, 0), /control, bidirectional or invisible/);
  }
  open(f, BASE, 0); open(f, { ...BASE, id: "q1" }, 1);
  for (const value of bad) {
    unchanged(f, () => answer(f, "key-b", { text: value, by: "owner" }, 2), /control, bidirectional or invisible/);
    unchanged(f, () => answer(f, "key-b", { text: "ok", by: value }, 2), /control, bidirectional or invisible/);
    unchanged(f, () => withdraw(f, "q1", { reason: value }, 2), /control, bidirectional or invisible/);
  }
});

test("FR-002 every length bound is accepted at the bound and refused one over", t => {
  const f = fixture(t), x = n => "x".repeat(n);
  open(f, { ...BASE, id: "max", text: x(2000), to: { kind: "person", label: x(200) }, refs: Array(10).fill(x(500)) }, 0);
  unchanged(f, () => open(f, { ...BASE, id: "o1", text: x(2001) }, 1), /text must be nonempty text of at most 2000/);
  unchanged(f, () => open(f, { ...BASE, id: "o2", to: { kind: "role", label: x(201) } }, 1), /to\.label must be nonempty text of at most 200/);
  unchanged(f, () => open(f, { ...BASE, id: "o3", refs: [x(501)] }, 1), /refs must be nonempty text of at most 500/);
  unchanged(f, () => open(f, { ...BASE, id: "o4", refs: Array(11).fill("r") }, 1), /at most 10 references/);
  open(f, { ...BASE, id: "q1" }, 1);
  unchanged(f, () => answer(f, "max", { text: x(2001), by: "owner" }, 2), /answer\.text must be nonempty text of at most 2000/);
  unchanged(f, () => answer(f, "max", { text: "ok", by: x(201) }, 2), /answer\.by must be nonempty text of at most 200/);
  answer(f, "max", { text: x(2000), by: x(200) }, 2);
  unchanged(f, () => withdraw(f, "q1", { reason: x(2001) }, 3), /withdrawal\.reason must be nonempty text of at most 2000/);
  withdraw(f, "q1", { reason: x(2000) }, 3);
  unchanged(f, () => journal(f, { path: x(1001) }, 4), /journal must be nonempty text of at most 1000/);
  journal(f, { path: x(1000) }, 4);
  const annex = read(f.annex);
  assert.deepEqual([annex.revision, annex.requests[0].answer.text.length, annex.requests[1].withdrawal.reason.length, annex.journal.length], [5, 2000, 2000, 1000]);
});

test("FR-003 a write that would push open requests past 512 KiB of UTF-8 is refused; the view still renders", t => {
  const f = fixture(t), cjk = n => "漢".repeat(n);
  const body = i => ({ ...BASE, id: `big${i}`, task_id: null, need: "blocking", text: cjk(2000), to: { kind: "role", label: cjk(200) }, refs: Array(10).fill(cjk(500)) });
  let accepted = 0;
  for (; accepted < 100; accepted++) {
    try { open(f, body(accepted), accepted); } catch (error) { assert.match(error.message, /open requests would exceed 524288 bytes/); break; }
  }
  assert.ok(accepted > 0 && accepted < 100, `refused before the count limit (accepted ${accepted})`);
  unchanged(f, () => open(f, body(accepted), accepted), /would exceed 524288 bytes/);
  const block = core.main(["view", f.board]).operator_requests;
  assert.deepEqual([block.status, block.counts.open, block.items.length, block.truncated], ["valid", accepted, accepted, false]);
  assert.match(core.main(["status", f.board, "--format", "text"]), /Waiting on:/);
  withdraw(f, "big0", { reason: "Too long" }, accepted);
  assert.equal(open(f, { ...BASE, id: "small", task_id: null, need: "later" }, accepted + 1).written, true);
});

test("FR-003 an oversize hand-edited annex can still be reduced by answer and withdraw", t => {
  const f = fixture(t), cjk = n => "漢".repeat(n);
  const body = i => ({ ...BASE, id: `big${i}`, task_id: null, need: "blocking", text: cjk(2000), to: { kind: "role", label: cjk(200) }, refs: Array(10).fill(cjk(500)) });
  let revision = 0;
  for (; revision < 100; revision++) { try { open(f, body(revision), revision); } catch { break; } }
  const annex = read(f.annex);
  annex.requests.push({ ...annex.requests[0], id: "edited" });
  annex.history.push({ ...annex.history[0], revision: revision + 1, request_id: "edited" }); annex.revision = revision + 1;
  write(f.annex, annex);
  assert.equal(core.main(["view", f.board]).operator_requests.status, "valid");
  assert.equal(answer(f, "edited", { text: "Confirmed out of band", by: "owner" }, revision + 1).written, true);
  assert.equal(withdraw(f, "big0", { reason: "Too long" }, revision + 2).written, true);
});

function tree(dir, base = dir, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name), rel = path.relative(base, file);
    if (entry.isDirectory()) { out[`${rel}/`] = true; tree(file, base, out); } else if (rel !== "requests.json") out[rel] = fs.readFileSync(file).toString("base64");
  }
  return out;
}
test("FR-012 request commands leave receipts, estimates and progress untouched and release unchanged", t => {
  const f = fixture(t), plain = fixture(t);
  fs.mkdirSync(path.join(f.board, "receipts"), { recursive: true }); write(path.join(f.board, "receipts", "a-1.json"), { candidate: true });
  fs.mkdirSync(path.join(f.board, "progress"), { recursive: true }); write(path.join(f.board, "progress", "a-1.json"), { sequence: 1 });
  write(path.join(f.board, "estimates.json"), { schema_version: 1, sentinel: true });
  const before = tree(f.board);
  open(f, { ...BASE, id: "blk", task_id: "a", need: "blocking" }, 0); open(f, { ...BASE, id: "q1" }, 1);
  answer(f, "q1", { text: "ok", by: "owner" }, 2); withdraw(f, "blk", { reason: "Moot" }, 3);
  open(f, { ...BASE, id: "blk2", task_id: "a", need: "blocking" }, 4); journal(f, { path: "j.html" }, 5);
  assert.deepEqual(tree(f.board), before);
  const release = g => {
    core.main(["claim", g.board, "--coordinator", "lead", "--revision", "1", "--task", "a", "--assignee", "w"]);
    return core.main(["release", g.board, "--coordinator", "lead", "--revision", "2", "--task", "a", "--reason", "retry", "--reconciled-by", "lead"]);
  };
  assert.deepEqual(release(f), release(plain));
  assert.deepEqual(read(f.state).tasks, read(plain.state).tasks);
  assert.equal(read(f.annex).revision, 6);
});
