"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("./roster-roadmap.cjs");
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const AT = "2026-11-13T10:00:00.000Z";
function task(id, depends = []) {
  return { id, intake: `briefs/${id}.md`, objective: `Deliver ${id}`, depends_on: depends, inputs: [], outputs: [], allowed_files: [`src/${id}.js`],
    dod: ["Checks pass"], success: ["Observable success"], checks: [{ id: "test", description: "Run test" }],
    topology: { runtime: "codex", model: "configured", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] },
    policy: { max_attempts: 4, on_failure: "retry", stop_if: ["Scope changed"], recovery: ["Diagnose"], failure: "Budget exhausted" },
    workflow: { recommendation: "none", reason: "Bounded mission", steps: [] } };
}
function fixture(t, { accept = true, tasks = [task("a"), task("b", ["a"])] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-requests-view-")), board = path.join(root, "board");
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
  return { root, board, annex: path.join(board, "requests.json") };
}
function req(id, extra = {}) {
  return { id, to: { kind: "role", label: "owner" }, kind: "supply", text: `Text of ${id}`, task_id: null, need: "later", refs: [], created_at: AT, created_by: "lead", status: "open", supersedes: null, answer: null, withdrawal: null, ...extra };
}
const answered = (id, at, extra = {}) => req(id, { status: "answered", answer: { text: `Answer ${id}`, by: "owner", at, relayed_by: "lead" }, ...extra });
const withdrawn = (id, at, extra = {}) => req(id, { status: "withdrawn", withdrawal: { reason: `Reason ${id}`, by: "lead", at }, ...extra });
function put(f, requests, journal = null) {
  const history = requests.map((r, i) => ({ revision: i + 1, action: "open", request_id: r.id, coordinator: "lead", at: AT }));
  write(f.annex, { schema_version: 1, board_id: "demo", revision: history.length, journal, requests, history });
}
const block = (f, options = []) => core.main(["view", f.board, ...options]).operator_requests;
const dueOf = (f, id) => block(f).items.find(item => item.id === id).due;
function claim(f, id, revision) { return core.main(["claim", f.board, "--coordinator", "lead", "--revision", String(revision), "--task", id, "--assignee", "w"]).assignment; }
function record(f, id, assignment, result, revision) {
  const file = path.join(f.root, "receipt.json");
  write(file, { task_id: id, attempt_id: assignment.id, assignee: "w", contract_digest: assignment.contract_digest, result, summary: result, evidence: ["log"], changed_files: [], checks: [{ id: "test", status: result === "done" ? "pass" : "fail", evidence: ["log"] }] });
  core.main(["record", f.board, "--coordinator", "lead", "--revision", String(revision), "--receipt", file]);
}

function check(schema, value, root, where = "$") {
  if (schema.$ref) return check(schema.$ref.split("/").slice(1).reduce((s, k) => s[k], root), value, root, where);
  const errors = [], kind = v => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${where}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where}: enum`);
  if (schema.type) {
    const ok = schema.type === "number" ? typeof value === "number" : schema.type === "object" ? kind(value) === "object" : kind(value) === schema.type;
    if (!ok) { errors.push(`${where}: type ${schema.type}`); return errors; }
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${where}: pattern`);
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${where}: minimum`);
  if (schema.anyOf && !schema.anyOf.some(option => !check(option, value, root, where).length)) errors.push(`${where}: anyOf`);
  if (schema.oneOf && schema.oneOf.filter(option => !check(option, value, root, where).length).length !== 1) errors.push(`${where}: oneOf`);
  if (kind(value) === "object") {
    for (const name of schema.required || []) if (!Object.hasOwn(value, name)) errors.push(`${where}: missing ${name}`);
    for (const [name, item] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, name)) errors.push(...check(schema.properties[name], item, root, `${where}.${name}`));
      else if (schema.additionalProperties === false) errors.push(`${where}: unexpected ${name}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...check(schema.additionalProperties, item, root, `${where}.${name}`));
    }
  }
  if (kind(value) === "array" && schema.items) value.forEach((item, i) => errors.push(...check(schema.items, item, root, `${where}[${i}]`)));
  return errors;
}
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, "../schema/roadmap-view.schema.json"), "utf8"));
const validView = view => check(SCHEMA, view, SCHEMA);

test("AC-12 views with requests, absent annex and invalid annex satisfy the schema", t => {
  const f = fixture(t);
  assert.deepEqual(validView(core.main(["view", f.board])), []);
  put(f, [req("o1", { task_id: "a", need: "before-task", refs: ["notes/x.md"] }), answered("a1", AT, { task_id: "b" }), withdrawn("w1", AT), req("s1", { supersedes: "w1" })], "j.html");
  const view = core.main(["view", f.board]);
  assert.equal(view.operator_requests.items.length, 4);
  assert.deepEqual(validView(view), []);
  assert.equal(view.schema_version, 1);
  fs.writeFileSync(f.annex, "garbage");
  const invalid = core.main(["view", f.board]);
  assert.equal(invalid.operator_requests.status, "invalid");
  assert.deepEqual(validView(invalid), []);
  assert.ok(check({ type: "object", properties: {}, additionalProperties: false }, { x: 1 }, {}).length);
  const broken = JSON.parse(JSON.stringify(view)); broken.operator_requests.items[0].surprise = 1;
  assert.ok(validView(broken).length, "additionalProperties false is honoured");
  delete broken.operator_requests.items[0].surprise; delete broken.operator_requests.counts;
  assert.ok(validView(broken).length, "required properties are honoured");
});

test("absent annex reads as revision 0 and an older view without the block still validates", t => {
  const f = fixture(t), view = core.main(["view", f.board]);
  assert.deepEqual(view.operator_requests, { status: "absent", reason: null, revision: 0, journal: null, counts: { open: 0, now: 0, later: 0, unscheduled: 0, answered: 0, withdrawn: 0, archived: 0 }, items: [], truncated: false });
  assert.deepEqual(view.tasks.map(item => item.requests), [[], []]);
  const older = { ...view }; delete older.operator_requests;
  older.tasks = older.tasks.map(({ requests, ...rest }) => rest);
  assert.deepEqual(validView(older), []);
});

test("AC-5 ordering, counts, per-task ids and next_action prefix", t => {
  const f = fixture(t);
  put(f, [req("l1", { created_at: "2026-11-13T09:00:00.000Z" }), req("n2", { need: "blocking", created_at: "2026-11-13T09:30:00.000Z" }), req("n1", { need: "blocking", task_id: "a", created_at: "2026-11-13T09:00:00.000Z" }),
    req("lt", { task_id: "b", need: "later" }), req("m3", { need: "blocking", to: { kind: "person", label: "ops" } })]);
  const view = core.main(["view", f.board]), b = view.operator_requests;
  assert.deepEqual(b.items.map(item => item.id), ["n1", "n2", "m3", "lt", "l1"]);
  assert.deepEqual(b.items.map(item => item.due), ["now", "now", "now", "later", "unscheduled"]);
  assert.deepEqual(b.counts, { open: 5, now: 3, later: 1, unscheduled: 1, answered: 0, withdrawn: 0, archived: 0 });
  assert.deepEqual(view.tasks.map(item => item.requests), [["n1"], ["lt"]]);
  assert.match(view.next_action, /^Waiting on owner \(2\), ops \(1\): 3 request\(s\) due now\. Claim a/);
  const task = core.main(["view", f.board, "--task", "b"]);
  assert.deepEqual(task.operator_requests.counts, b.counts); assert.equal(task.tasks.length, 1);
  assert.doesNotMatch(core.main(["view", f.board]).next_action.replace(/^Waiting[^.]*\. /, ""), /Waiting/);
});

test("due derivation covers every FR-014 rule", t => {
  const f = fixture(t);
  put(f, [req("blk", { need: "blocking", task_id: "b" }), req("bta", { need: "before-task", task_id: "a" }), req("btb", { need: "before-task", task_id: "b" }), req("lat", { need: "later", task_id: "a" }), req("ub", { need: "later" }), req("ghost", { need: "before-task", task_id: "gone" })]);
  assert.deepEqual(["blk", "bta", "btb", "lat", "ub", "ghost"].map(id => dueOf(f, id)), ["now", "now", "later", "later", "unscheduled", "unscheduled"]);
  assert.equal(block(f).items.find(item => item.id === "ghost").task_state, "unknown");
  const first = claim(f, "a", 1);
  assert.equal(dueOf(f, "bta"), "now");
  record(f, "a", first, "blocked", 2);
  assert.equal(dueOf(f, "bta"), "now");
  core.main(["release", f.board, "--coordinator", "lead", "--revision", "3", "--task", "a", "--reason", "retry", "--reconciled-by", "lead"]);
  const second = claim(f, "a", 4); record(f, "a", second, "done", 5);
  assert.equal(dueOf(f, "bta"), "unscheduled"); assert.equal(dueOf(f, "blk"), "now");
  assert.equal(dueOf(f, "btb"), "now");
  assert.ok(block(f).items.some(item => item.id === "bta"), "open request on a done task stays visible");
});

test("a queued before-task request is later while a basic claim obstacle remains", t => {
  const f = fixture(t, { tasks: [task("a"), task("c")] });
  put(f, [req("bc", { need: "before-task", task_id: "c" })]);
  assert.equal(dueOf(f, "bc"), "now");
  claim(f, "a", 1);
  assert.equal(dueOf(f, "bc"), "later");
});

test("draft boards: bound requests are later or unscheduled and a vanished task is unknown", t => {
  const f = fixture(t, { accept: false });
  put(f, [req("d1", { need: "before-task", task_id: "a" }), req("d2", { need: "before-task", task_id: "vanished" }), req("d3", { need: "blocking", task_id: "a" })]);
  const items = block(f).items;
  assert.deepEqual(items.map(item => [item.id, item.due, item.task_state]), [["d3", "now", "draft"], ["d1", "later", "draft"], ["d2", "unscheduled", "unknown"]]);
  assert.equal(core.main(["status", f.board, "--format", "text"]).includes("Waiting on:"), true);
});

test("AC-6 closed requests stay until their mission is done; unbound ones stay", t => {
  const f = fixture(t, { tasks: [task("a")] });
  put(f, [answered("ab", AT, { task_id: "a", need: "before-task" }), answered("un", "2026-11-13T11:00:00.000Z"), withdrawn("wd", "2026-11-13T12:00:00.000Z", { task_id: "a" })]);
  assert.deepEqual(block(f).items.map(item => item.id), ["wd", "un", "ab"]);
  assert.deepEqual(block(f).items.map(item => item.closed_at), ["2026-11-13T12:00:00.000Z", "2026-11-13T11:00:00.000Z", AT]);
  const assignment = claim(f, "a", 1); record(f, "a", assignment, "done", 2);
  const done = block(f);
  assert.deepEqual(done.items.map(item => item.id), ["un"]);
  assert.deepEqual(done.counts, { open: 0, now: 0, later: 0, unscheduled: 0, answered: 2, withdrawn: 1, archived: 2 });
});

test("superseded_by is derived and closed items keep their answer", t => {
  const f = fixture(t);
  put(f, [withdrawn("old", AT), req("new", { supersedes: "old" })]);
  const items = block(f).items;
  assert.equal(items.find(item => item.id === "old").superseded_by, "new");
  assert.equal(items.find(item => item.id === "new").superseded_by, null);
});

test("version tracks annex status, revision and open due list, never the clock", async t => {
  const f = fixture(t);
  const v0 = core.main(["view", f.board]).version;
  assert.equal(core.main(["view", f.board]).version, v0);
  put(f, [req("o1")]);
  const v1 = core.main(["view", f.board]).version; assert.notEqual(v1, v0);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(core.main(["view", f.board]).version, v1);
  put(f, [req("o1", { need: "blocking" })]);
  assert.notEqual(core.main(["view", f.board]).version, v1);
  fs.writeFileSync(f.annex, "garbage");
  assert.notEqual(core.main(["view", f.board]).version, v1);
});

test("AC-8 text status prints the Waiting on block right after Goal with cleaned strings", t => {
  const f = fixture(t);
  put(f, [req("o1", { need: "blocking", task_id: "a", text: "Install\nthe‮ key\u0007now", to: { kind: "role", label: "own​er" } }), answered("k1", AT, { answer: { text: "x".repeat(400), by: "o\u0085wner", at: AT, relayed_by: "lead" } }), withdrawn("w1", AT, { withdrawal: { reason: "Moot", by: "lead", at: AT } })]);
  const rows = core.main(["status", f.board, "--format", "text"]).split("\n");
  assert.match(rows[1], /^Goal: /);
  assert.equal(rows[2], "Waiting on:");
  assert.equal(rows[3], "  [now] o1 → owner (supply; task a): Install the key now");
  assert.match(rows[4], /^ {2}\[answered 2026-11-13T10:00:00.000Z\] k1 ← o wner: x{159}…$/);
  assert.equal(rows[5], "  [withdrawn 2026-11-13T10:00:00.000Z] w1: Moot");
  assert.match(rows[6], /^Tasks: /);
  assert.doesNotMatch(rows.join("\n"), /[‮​\u0007\u0085]/);
  const bare = fixture(t);
  assert.doesNotMatch(core.main(["status", bare.board, "--format", "text"]), /Waiting on/);
});

test("AC-7 invalid annex renders everywhere and claim still works", t => {
  const f = fixture(t);
  fs.writeFileSync(f.annex, "garbage");
  const text = core.main(["status", f.board, "--format", "text"]).split("\n");
  assert.match(text[2], /^Waiting on: requests annex invalid — /);
  const view = core.main(["view", f.board]);
  assert.equal(view.operator_requests.status, "invalid"); assert.ok(view.operator_requests.reason);
  assert.doesNotMatch(view.next_action, /^Waiting/);
  assert.deepEqual(JSON.parse(core.main(["prompt", f.board]).prompt).operator_requests.status, "invalid");
  assert.equal(claim(f, "a", 1).route, "sequential");
  fs.rmSync(f.annex); write(path.join(f.root, "real.json"), { schema_version: 1 }); fs.symlinkSync(path.join(f.root, "real.json"), f.annex);
  assert.equal(core.main(["view", f.board]).operator_requests.status, "invalid");
  write(path.join(f.root, "real.json"), { schema_version: 1, board_id: "other", revision: 0, journal: null, requests: [], history: [] });
  fs.rmSync(f.annex); fs.copyFileSync(path.join(f.root, "real.json"), f.annex);
  assert.match(core.main(["view", f.board]).operator_requests.reason, /different board/);
});

test("EC-10 an annex over 16 MiB is invalid", t => {
  const f = fixture(t);
  fs.writeFileSync(f.annex, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
  assert.equal(core.main(["view", f.board]).operator_requests.status, "invalid");
});

test("hand-written control and bidi characters are cleaned at render, not invalid", t => {
  const f = fixture(t);
  put(f, [req("o1", { text: "a‮b", to: { kind: "role", label: "x​y" } })]);
  assert.equal(block(f).status, "valid");
  assert.match(core.main(["status", f.board, "--format", "text"]), /\[unscheduled\] o1 → xy \(supply; unbound\): ab/);
});

test("FR-019 oversized blocks drop oldest closed items first, never open ones", t => {
  const f = fixture(t);
  const big = "r".repeat(500), refs = Array(10).fill(big);
  const list = [req("open1", { refs, text: "t".repeat(2000) })];
  for (let i = 0; i < 150; i++) list.push(answered(`c${String(i).padStart(3, "0")}`, `2026-11-13T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, { refs, text: "t".repeat(2000), answer: { text: "a".repeat(2000), by: "o", at: `2026-11-13T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, relayed_by: "lead" } }));
  put(f, list);
  const b = block(f);
  assert.equal(b.truncated, true);
  assert.equal(b.items[0].id, "open1");
  assert.ok(Buffer.byteLength(JSON.stringify(b.items)) <= 512 * 1024 + b.items.length);
  assert.equal(b.counts.answered, 150); assert.equal(b.counts.archived, 150 - (b.items.length - 1));
  const kept = b.items.slice(1).map(item => item.id);
  assert.deepEqual(kept, [...kept].sort().reverse(), "newest closed items are kept");
  assert.deepEqual(validView(core.main(["view", f.board])), []);
});

function promptOf(f, ...args) { return JSON.parse(core.main(["prompt", f.board, ...args]).prompt); }

test("AC-10 coordinator prompt lists open and live answered requests, truncated, without refs", t => {
  const f = fixture(t);
  put(f, [req("o1", { need: "blocking", text: "y".repeat(450), refs: ["a", "b"] }), answered("a1", AT, { task_id: "b", answer: { text: "z".repeat(450), by: "owner", at: AT, relayed_by: "lead" } }), answered("un", AT), withdrawn("wd", AT)], "j.html");
  const p = promptOf(f).operator_requests;
  assert.deepEqual([p.status, p.revision, p.journal], ["valid", 4, "j.html"]);
  assert.deepEqual(p.items.map(item => item.id), ["o1", "a1"]);
  assert.equal(p.items[0].due, "now"); assert.equal(p.items[0].refs_count, 2); assert.ok(!("refs" in p.items[0]));
  assert.equal(p.items[0].text, `${"y".repeat(300)}…[truncated]`);
  assert.equal(p.items[1].answer.text, `${"z".repeat(300)}…[truncated]`);
  assert.ok(!("answer" in p.items[0]));
  assert.deepEqual(Object.keys(p.items[0]), ["id", "to", "kind", "task_id", "need", "due", "status", "text", "refs_count"]);
});

test("mission prompt carries only its task's open and answered requests", t => {
  const f = fixture(t);
  put(f, [req("oa", { task_id: "a" }), req("ob", { task_id: "b" }), answered("ab", AT, { task_id: "b" }), withdrawn("wb", AT, { task_id: "b" }), req("un")]);
  assert.deepEqual(promptOf(f, "--task", "b").operator_requests.items.map(item => item.id), ["ob", "ab"]);
  assert.deepEqual(promptOf(f, "--task", "a").operator_requests.items.map(item => item.id), ["oa"]);
});

test("EC-13 mission prompt without requests has empty items", t => {
  const f = fixture(t);
  assert.deepEqual(promptOf(f, "--task", "a").operator_requests, { status: "absent", revision: 0, journal: null, items: [] });
});

test("prompt overflow still refuses with an actionable error", t => {
  const f = fixture(t);
  put(f, Array.from({ length: 40 }, (_, i) => req(`r${i}`, { need: "blocking", text: "q".repeat(300) })));
  assert.throws(() => core.main(["prompt", f.board]), /mandatory context overflow.*close or withdraw operator requests.*--task.*--max-chars/);
  assert.ok(core.main(["prompt", f.board, "--max-chars", "100000"]).characters > 12000);
});

test("coordinator continuation tells to open a request instead of pausing and to keep secrets out", t => {
  const f = fixture(t);
  assert.match(promptOf(f).continuation, /request-open.*instead of pausing silently.*never put secrets in requests/);
});
