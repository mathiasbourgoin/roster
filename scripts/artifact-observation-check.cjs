#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const producer = path.join(__dirname, "roster-pipeline.cjs");
class SetupError extends Error {
}
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const canonical = (x) => JSON.stringify(sort(x));
function sort(x) {
  return Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x;
}
const token = (x) => Buffer.from(canonical(x)).toString("base64url");
const untoken = (x) => JSON.parse(Buffer.from(x, "base64url").toString());
function write(root, name, body) {
  const p = path.join(root, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
function setup() {
  if (!fs.existsSync(producer)) throw new SetupError("public producer absent");
  const api = require(producer);
  if (!["artifactList", "artifactRead", "artifactCapabilities"].every((k) => typeof api[k] === "function")) throw new SetupError("new public implementation absent");
  return api;
}
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-artifact-"));
  try {
    return fn(root, setup());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function error(fn, code) {
  assert.throws(fn, (e) => e instanceof require(producer).ObservationError && e.code === code, code);
}
function list(api, root, extra = {}) {
  return api.artifactList({ root, scope: "task", task: "build-cache", ...extra });
}
function readAll(api, root, item, scope = "task", task = "build-cache") {
  let cursor = null, text = "", end = 0;
  do {
    const p = api.artifactRead({ root, scope, task, ref: item.body.ref, pageBytes: 71, cursor });
    assert.equal(p.kind, "artifact-page");
    assert.equal(p.data.range.start, end);
    end = p.data.range.end;
    text += p.data.text;
    cursor = p.data.next_cursor;
    if (!cursor) assert.equal(p.data.eof, true);
  } while (cursor);
  assert.equal(Buffer.byteLength(text), item.body.total_bytes);
  assert.equal(sha(Buffer.from(text)), item.body.sha256);
  return text;
}
const cases = {};
cases[1] = () => fixture((root, api) => {
  const body = "CANONICAL\n" + "\xE9\u{1F600}\u6F22\u5B57\r\n".repeat(900);
  write(root, "specs/build-cache.md", body);
  write(root, "briefs/build-cache-spec.md", "MARKER-ONLY");
  const out = list(api, root);
  assert.equal(out.data.total, 14);
  const spec = out.data.items.find((x) => x.kind === "spec"), marker = out.data.items.find((x) => x.kind === "spec-result");
  assert.notEqual(spec.body.ref, marker.body.ref);
  assert.equal(readAll(api, root, spec), body);
  assert.equal(readAll(api, root, marker), "MARKER-ONLY");
});
cases[3] = () => fixture((root, api) => {
  const body = "\uFEFF\u{1F600}\xE9\r\n\0\uFDD0".repeat(70);
  write(root, "specs/build-cache.md", body);
  const item = list(api, root).data.items[0];
  let cursor = null, bytes = [];
  for (let n = 0; ; n++) {
    const out = api.artifactRead({ root, scope: "task", task: "build-cache", ref: item.body.ref, pageBytes: [4, 13, 65536][n % 3], cursor });
    assert.equal(out.source.task, "build-cache");
    bytes.push(Buffer.from(out.data.text));
    cursor = out.data.next_cursor;
    if (cursor === null) break;
  }
  assert.deepEqual(Buffer.concat(bytes), Buffer.from(body));
});
const kinds = [["spec", "specs/build-cache.md"], ["intake", "briefs/build-cache-intake.md"], ["spec-result", "briefs/build-cache-spec.md"], ["plan", "briefs/build-cache-plan.md"], ["plan-data", "briefs/build-cache-plan.json"], ["implementer-brief", "briefs/build-cache-implementer.md"], ["reviewer-brief", "briefs/build-cache-reviewer.md"], ["qa-scope", "briefs/build-cache-qa-scope.md"], ["implementation", "briefs/build-cache-impl.md"], ["review", "briefs/build-cache-review.json"], ["qa-state", "briefs/build-cache-qa-state.json"], ["qa", "briefs/build-cache-qa.md"], ["ledger", "briefs/build-cache-state.json"], ["manifest", "briefs/build-cache-manifest.txt"]];
cases[5] = () => {
  for (const [kind, file] of kinds) fixture((root, api) => {
    write(root, file, "{}");
    const out = api.artifactList({ root, scope: "task", limit: 100 });
    assert.equal(out.data.total, kind === "qa-state" ? 28 : 14, kind);
    const intended = out.data.items.filter((x) => x.task === "build-cache");
    assert.equal(intended.length, 14);
    assert.deepEqual(intended.map((x) => x.kind), kinds.map((x) => x[0]));
    assert.equal(intended.find((x) => x.kind === kind).body.availability, "valid");
    if (kind === "qa-state") {
      const other = out.data.items.find((x) => x.task === "build-cache-qa" && x.kind === "ledger"), current = intended.find((x) => x.kind === kind);
      assert.equal(other.body.availability, "valid");
      assert.notEqual(other.body.ref, current.body.ref);
      assert.notEqual(untoken(other.body.ref).source_id, untoken(current.body.ref).source_id);
      assert.equal(readAll(api, root, other, "task", "build-cache-qa"), "{}");
      error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: other.body.ref }), "invalid_reference");
    }
    const absent = list(api, root, { task: "nonexistent" });
    assert.equal(absent.data.availability.status, "absent");
    assert.equal(absent.data.total, null);
    assert.equal(require(producer).list(root).data.items.length, ["intake", "ledger", "qa-state"].includes(kind) ? 1 : 0);
  });
};
cases[15] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "hello");
  const ref = list(api, root).data.items[0].body.ref;
  error(() => api.artifactRead({ root, scope: "task", task: "other", ref }), "invalid_reference");
  error(() => api.artifactRead({ root, scope: "project", ref }), "invalid_reference");
  error(() => api.artifactRead({ root, scope: "task", ref }), "invalid_request");
});
cases[38] = () => fixture((root, api) => {
  write(root, "briefs/build-cache-review.json", JSON.stringify({ task: "foreign", status: "GO", round: -1, cycle: 1, count: 900, command: "inert" }));
  const i = list(api, root).data.items.find((x) => x.kind === "review");
  assert.equal(i.metadata.availability, "invalid");
  assert.deepEqual(i.metadata.fields.reported, { task: null, status: "GO", round: null, cycle: 1, date: null });
  assert.ok(i.metadata.issues.items.some((x) => x.reason === "task-mismatch"));
  assert.ok(i.metadata.issues.items.some((x) => x.field === "round" && x.reason === "wrong-type"));
  assert.equal(readAll(api, root, i), JSON.stringify({ task: "foreign", status: "GO", round: -1, cycle: 1, count: 900, command: "inert" }));
  write(root, "specs/build-cache.md", "---\ntask: build-cache\nstatus: GO\n---\n**Status: NO-GO**\n");
  const m = list(api, root).data.items[0];
  assert.equal(m.metadata.fields.reported.status, null);
  assert.ok(m.metadata.issues.items.some((x) => x.reason === "contradictory"));
  for (const [status2, reason] of [[[], "wrong-type"], ["\uD800", "ill-formed-string"]]) {
    const body = "---\n" + JSON.stringify({ task: "build-cache", status: status2, date: "safe" }) + "\n---\n**Status: GO**\n";
    write(root, "specs/build-cache.md", body);
    const bad = list(api, root).data.items[0];
    assert.equal(bad.metadata.fields.reported.status, null, "invalid field cannot be restored by marker");
    assert.equal(bad.metadata.fields.reported.date, "safe");
    assert.ok(bad.metadata.issues.items.some((x) => x.field === "status" && x.reason === reason));
    assert.equal(readAll(api, root, bad), body);
  }
  const status = "x".repeat(3e3);
  write(root, "specs/build-cache.md", "---\n" + JSON.stringify({ status }) + "\n---\n**Status: " + status + "**\n");
  const clipped = list(api, root).data.items[0].metadata;
  assert.equal(clipped.fields.reported.status, "x".repeat(2e3));
  assert.equal(clipped.issues.items.some((x) => x.reason === "contradictory"), false);
  assert.equal(clipped.issues.items.filter((x) => x.field === "status" && x.reason === "limit").length, 1);
});
const definition = (name = "reviewer", extra = {}) => "---\n" + JSON.stringify({ name, display_name: "Review", description: "inert instructions", model: "configured", domain: ["testing"], tags: [], compatible_with: ["codex"], complexity: "medium", ...extra }) + "\n---\n" + "INSTRUCTIONS command-like text remains inert\n".repeat(100);
function project(root, names) {
  write(root, ".harness/harness.json", JSON.stringify({ layers: { agents: names } }));
}
cases[2] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer", role: "project-review", version: "1.0.0" }]);
  const body = definition("reviewer", { version: "2.0.0" });
  write(root, ".harness/agents/reviewer.md", body);
  write(root, ".agents/agents/extra.md", "not inventory");
  const out = api.artifactList({ root, scope: "project" });
  assert.equal(out.data.total, 1);
  const i = out.data.items[0];
  assert.equal(i.id, "reviewer");
  assert.equal(i.metadata.fields.declaration.role, "project-review");
  assert.equal(i.metadata.fields.definition.version, "2.0.0");
  assert.equal(i.metadata.fields.declaration.version, "1.0.0");
  assert.deepEqual(i.use, { availability: "unknown", reason: "not-observed", session: null });
  assert.equal(readAll(api, root, i, "project", null), body);
  assert.equal(readAll(api, root, out.data.context.project_manifest, "project", null), JSON.stringify({ layers: { agents: [{ name: "reviewer", role: "project-review", version: "1.0.0" }] } }));
});
function pList(api, root, extra = {}) {
  return api.artifactList({ root, scope: "project", ...extra });
}
function aItem(api, root, name = "reviewer") {
  return pList(api, root).data.items.find((x) => x.id === name);
}
function rawRef(root, kind, id, body, scope = "task", task = "build-cache") {
  return token({ v: 1, source_id: sha(canonical(["artifact-source/v1", path.resolve(root), scope, task])), scope, task, kind, id, sha256: sha(Buffer.from(body)) });
}
function cli(root, args, entry = producer) {
  const r = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: "utf8", timeout: 15e3, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.signal, null);
  return r;
}
function callError(root, args, code) {
  const r = cli(root, args);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  const e = JSON.parse(r.stderr);
  assert.deepEqual(e, { schema_version: 1, kind: "error", error: { code, message: code.replaceAll("_", " ") } });
}
cases[4] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "x");
  const first = list(api, root, { limit: 3 });
  assert.equal(first.data.total, 14);
  let items = first.data.items, c = first.data.next_cursor;
  while (c) {
    const o = list(api, root, { limit: 4, cursor: c });
    items.push(...o.data.items);
    c = o.data.next_cursor;
  }
  assert.deepEqual(items.map((x) => x.kind), kinds.map((x) => x[0]));
  assert.equal(new Set(items.map((x) => canonical([x.scope, x.task, x.kind, x.id]))).size, 14);
  project(root, [{ name: "zebra" }, { name: "alpha" }]);
  const p = pList(api, root);
  assert.deepEqual(p.data.items.map((x) => x.id), ["alpha", "zebra"]);
  assert.equal(p.data.total, 2);
  assert.equal(p.data.context.project_manifest.kind, "agent-manifest");
});
cases[6] = () => fixture((root, api) => {
  let x = list(api, root);
  assert.deepEqual(x.data.availability, { status: "absent", reason: "task-absent" });
  assert.deepEqual(api.artifactList({ root, scope: "task" }).data.availability, { status: "absent", reason: "directories-absent" });
  fs.mkdirSync(path.join(root, "specs"));
  assert.equal(api.artifactList({ root, scope: "task" }).data.total, 0);
  write(root, "specs/build-cache.md", "x");
  assert.equal(list(api, root).data.total, 14);
  fs.renameSync(path.join(root, "specs"), path.join(root, "store"));
  fs.symlinkSync(path.join(root, "store"), path.join(root, "specs"));
  error(() => list(api, root), "unsafe_source");
  fs.unlinkSync(path.join(root, "specs"));
  fs.mkdirSync(path.join(root, "specs"));
  fs.mkdirSync(path.join(root, "briefs"));
  for (let i = 0; i < 6e3; i++) write(root, "briefs/rejected_" + i, "");
  for (let i = 0; i < 5e3; i++) write(root, "specs/rejected_" + i, "");
  error(() => list(api, root), "output_limit");
});
cases[7] = () => fixture((root, api) => {
  assert.equal(pList(api, root).data.availability.status, "absent");
  for (const body of ["{", '{"layers":{"agents":[],"agents":[]}}', JSON.stringify({}), JSON.stringify({ layers: [] }), JSON.stringify({ layers: { agents: {} } }), '{"layers":{"agents":[]},"\\u006cayers":{"agents":[]}}', "{layers:{agents:[]}}", '{"layers":{"agents":[],}}', '{"layers":{"agents":[]}} /*comment*/']) {
    write(root, ".harness/harness.json", body);
    const o2 = pList(api, root);
    assert.equal(o2.data.availability.status, "invalid");
    assert.equal(o2.data.total, null);
    assert.equal(o2.data.context.project_manifest.body.availability, "valid");
    assert.equal(readAll(api, root, o2.data.context.project_manifest, "project", null), body);
  }
  project(root, []);
  const o = pList(api, root);
  assert.equal(o.data.total, 0);
  assert.equal(o.data.availability.status, "valid");
});
cases[8] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer" }, { name: "implementer" }, { name: "reviewer" }, { name: "../bad" }, 17, {}, { name: 8 }]);
  write(root, ".harness/agents/implementer.md", definition("implementer"));
  const o = pList(api, root);
  assert.equal(o.data.total, null);
  assert.deepEqual(o.data.items.map((x) => x.id), ["implementer"]);
  assert.deepEqual(o.data.invalid_entries, { items: [{ source_index: 0, reason: "duplicate-name" }, { source_index: 2, reason: "duplicate-name" }, { source_index: 3, reason: "unsafe-name" }, { source_index: 4, reason: "wrong-type" }, { source_index: 5, reason: "missing-name" }, { source_index: 6, reason: "wrong-type" }], total: 6, truncated: false });
  project(root, Array.from({ length: 103 }, () => ({ name: "reviewer" })));
  assert.equal(pList(api, root).data.invalid_entries.total, 103);
  assert.equal(pList(api, root).data.invalid_entries.items.length, 100);
  assert.equal(pList(api, root).data.invalid_entries.truncated, true);
});
cases[9] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer", source: 42, version: { bad: true }, runtime: { enabled: false }, path: "../outside" }]);
  write(root, ".harness/agents/reviewer.md", definition());
  const i = aItem(api, root);
  assert.equal(i.body.availability, "valid");
  assert.equal(i.metadata.fields.declaration.source, null);
  assert.equal(i.metadata.fields.declaration.version, null);
  assert.equal(i.metadata.availability, "invalid");
  assert.ok(readAll(api, root, i, "project", null).includes("INSTRUCTIONS"));
  fs.unlinkSync(path.join(root, ".harness/agents/reviewer.md"));
  const missing = aItem(api, root);
  assert.equal(missing.body.availability, "absent");
  assert.equal(missing.metadata.fields.declaration.name, "reviewer");
  assert.equal(missing.metadata.fields.definition, null);
});
cases[10] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer", version: "1.0.0" }]);
  write(root, ".harness/agents/reviewer.md", definition("different", { version: "2.0.0" }));
  const i = aItem(api, root);
  assert.equal(i.id, "reviewer");
  assert.equal(i.metadata.fields.definition.name, null);
  assert.equal(i.metadata.fields.definition.version, "2.0.0");
  assert.equal(i.metadata.fields.declaration.version, "1.0.0");
  assert.ok(i.metadata.issues.items.some((x) => x.reason === "name-mismatch"));
  assert.ok(readAll(api, root, i, "project", null).includes("different"));
});
cases[11] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer", source: "catalog", role: "review", version: "configured", tunables: { enabled: true }, extra: "never projected" }]);
  const extra = { version: "1.2.3", author: "author", source: "https://example.invalid/agent", pipeline_role: { triggered_by: "plan", receives: "input", produces: "output", human_gate: "none \u2014 inert" }, tunables: { count: 2 }, requires: ["Read", { name: "tool", type: "cli", check: "inert", install: "inert", optional: true }], runtime_hints: { codex: { model: "label" } }, entrypoints: { codex: { type: "skill" }, "claude-code": { type: "agent" } }, isolation: "none", overlay: "personal", replaces: ["previous"], extra: "inert" };
  write(root, ".harness/agents/reviewer.md", definition("reviewer", extra));
  let i = aItem(api, root);
  assert.equal(i.metadata.availability, "valid");
  assert.equal(Object.hasOwn(i.metadata.fields.definition, "extra"), false);
  for (const [k, v] of Object.entries(extra)) if (k !== "extra") assert.deepEqual(i.metadata.fields.definition[k], v, k);
  write(root, ".harness/agents/reviewer.md", "---\nname: reviewer\nmodel: []\nversion: wrong\n---\nbody");
  i = aItem(api, root);
  assert.equal(i.metadata.fields.definition.model, null);
  assert.equal(i.metadata.fields.definition.version, null);
  assert.equal(i.metadata.fields.definition.author, null);
  assert.ok(i.metadata.issues.items.some((x) => x.field === "description" && x.reason === "missing"));
  assert.equal(i.metadata.issues.items.some((x) => x.field === "author"), false);
  write(root, ".harness/agents/reviewer.md", definition("reviewer", { tunables: JSON.parse('{"__proto__":{"inert":"value"},"constructor":"literal"}') }));
  const safe = aItem(api, root).metadata.fields.definition.tunables;
  assert.equal(Object.getPrototypeOf(safe), Object.prototype);
  assert.equal(Object.hasOwn(safe, "__proto__"), true);
  assert.equal(safe.__proto__.inert, "value");
  assert.equal({}.inert, void 0);
});
cases[13] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer" }]);
  const valid = definition();
  for (const body of [valid, "\uFEFF" + valid, valid.replaceAll("\n", "\r\n"), valid + "\n---\nname: different\n---\n"]) {
    write(root, ".harness/agents/reviewer.md", body);
    assert.equal(aItem(api, root).metadata.availability, "valid");
  }
  const bad = ["body only", "---\nname: reviewer", "---\n[]\n---\n", "---\nname: reviewer\nname: other\n---\n", "---\nname: &unused reviewer\n---\n", "---\nname: *missing\n---\n", "---\nname: ! reviewer\n---\n", "---\nname: !!str reviewer\n---\n", "---\nname: !custom reviewer\n---\n", "---\n%YAML 1.2\n---\nname: reviewer\n---\n", "---\nname: reviewer\n...\n---\nname: other\n---\n", "---\n<<: {name: reviewer}\n---\n", "---\n12: reviewer\n---\n", "---\nnull: reviewer\n---\n", "---\n? [key]\n: reviewer\n---\n", "---\nname: .nan\n---\n", "---\nname: .inf\n---\n", "---\nname: 1e999\n---\n"];
  for (const body of bad) {
    write(root, ".harness/agents/reviewer.md", body);
    const i = aItem(api, root);
    assert.equal(i.metadata.availability, "invalid", body);
    assert.equal(i.body.availability, "valid");
    assert.equal(readAll(api, root, i, "project", null), body);
  }
  for (const extra of ['description: "literal * !"\n', "description: |\n  literal * !\n", '"<<": literal\ndescription: "literal"\n']) {
    const b = "---\nname: reviewer\ndisplay_name: Review\nmodel: label\ndomain: []\ntags: []\ncompatible_with: []\ncomplexity: low\n" + extra + "---\nbody";
    write(root, ".harness/agents/reviewer.md", b);
    assert.equal(aItem(api, root).metadata.availability, "valid", extra);
  }
  write(root, ".harness/agents/reviewer.md", valid);
  const yaml = require("./vendor/yaml-2.9.1.cjs"), original = yaml.parseDocument;
  try {
    for (const fault of [new RangeError("bounded injected stack error"), new Error("bounded injected parser error")]) {
      yaml.parseDocument = () => {
        throw fault;
      };
      const inventory = pList(api, root);
      assert.equal(inventory.data.availability.status, "invalid");
      assert.equal(inventory.data.context.project_manifest.body.availability, "valid");
      yaml.parseDocument = (text, ...args) => {
        if (text.includes('"display_name"')) throw fault;
        return original(text, ...args);
      };
      const i = aItem(api, root);
      assert.equal(i.metadata.availability, "invalid");
      assert.equal(i.body.availability, "valid");
      assert.ok(i.metadata.issues.items.some((x) => x.reason === (fault instanceof RangeError ? "limit" : "parse")));
      assert.equal(readAll(api, root, i, "project", null), valid);
    }
  } finally {
    yaml.parseDocument = original;
  }
});
cases[14] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "");
  let i = list(api, root).data.items[0];
  assert.equal(i.body.total_bytes, 0);
  assert.equal(readAll(api, root, i), "");
  fs.unlinkSync(path.join(root, "specs/build-cache.md"));
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: i.body.ref }), "stale_reference");
  write(root, "briefs/build-cache-intake.md", "x");
  const filename = path.join(root, "specs/build-cache.md");
  for (const type of ["symlink", "directory", "hardlink", "oversize", "utf8"]) {
    if (type === "symlink") fs.symlinkSync(path.join(root, "briefs/build-cache-intake.md"), filename);
    if (type === "directory") fs.mkdirSync(filename);
    if (type === "hardlink") fs.linkSync(path.join(root, "briefs/build-cache-intake.md"), filename);
    if (type === "oversize") {
      fs.writeFileSync(filename, "");
      fs.truncateSync(filename, 16777217);
    }
    if (type === "utf8") fs.writeFileSync(filename, Buffer.from([192, 175]));
    const x = list(api, root).data.items[0];
    assert.equal(x.body.availability, "invalid", type);
    assert.deepEqual([x.body.sha256, x.body.total_bytes, x.body.ref], [null, null, null]);
    const code = type === "oversize" ? "oversized_source" : type === "utf8" ? "invalid_utf8" : "unsafe_source";
    error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: rawRef(root, "spec", "build-cache", "") }), code);
    fs.rmSync(filename, { recursive: true, force: true });
  }
});
cases[16] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "x");
  const a = list(api, root), b = list(api, root + "/./");
  assert.equal(a.source.id, b.source.id);
  const link = root + "-link";
  try {
    fs.symlinkSync(root, link);
    error(() => list(api, link), "unsafe_source");
  } finally {
    fs.unlinkSync(link);
  }
  write(root, "file", "x");
  error(() => list(api, path.join(root, "file")), "unsafe_source");
  error(() => list(api, path.join(root, "missing")), "read_failed");
  for (const name of ["\xE9", "e\u0301"]) {
    fs.mkdirSync(path.join(root, name));
  }
  assert.notEqual(list(api, path.join(root, "\xE9")).source.id, list(api, path.join(root, "e\u0301")).source.id);
});
cases[17] = () => fixture((root, api) => {
  const body = "never listed";
  write(root, "specs/build-cache.md", body);
  const ref = rawRef(root, "spec", "build-cache", body);
  assert.equal(api.artifactRead({ root, scope: "task", task: "build-cache", ref }).data.text, body);
  const bad = { ...untoken(ref), kind: "arbitrary", id: "private" };
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: token(bad) }), "invalid_reference");
});
cases[18] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "\u{1F600}text");
  const ref = list(api, root).data.items[0].body.ref;
  const obj = untoken(ref);
  const variants = [ref + "=", Buffer.from(JSON.stringify(obj, null, 1)).toString("base64url"), Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(obj).reverse()))).toString("base64url"), token({ ...obj, v: 2 }), token({ ...obj, extra: true }), Buffer.from(canonical(obj).replace('"v":1', '"v":1.0')).toString("base64url"), Buffer.from(canonical(obj).replace('"v":1', '"v":1,"v":1')).toString("base64url"), Buffer.from([255]).toString("base64url"), "a".repeat(4097), Buffer.from(canonical(obj).replace("build-cache", "build\\u002dcache")).toString("base64url")];
  for (const x of variants) error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: x }), "invalid_reference");
  error(() => list(api, root, { cursor: "" }), "invalid_cursor");
  assert.deepEqual(list(api, root, { cursor: null }), list(api, root));
  const cursor = api.artifactRead({ root, scope: "task", task: "build-cache", ref, pageBytes: 4 }).data.next_cursor, cur = untoken(cursor);
  for (const bad of [cursor + "=", token({ ...cur, extra: 1 }), token({ ...cur, v: 2 }), Buffer.from(canonical(cur).replace('"v":1', '"v":1,"v":1')).toString("base64url"), Buffer.from(JSON.stringify(cur, null, 1)).toString("base64url"), Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(cur).reverse()))).toString("base64url"), Buffer.from(canonical(cur).replace('"offset":4', '"offset":4.0')).toString("base64url"), Buffer.from([255]).toString("base64url"), "a".repeat(8193)]) error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref, cursor: bad }), "invalid_cursor");
});
cases[19] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "same bytes");
  write(root, "briefs/build-cache-intake.md", "same bytes");
  const items = list(api, root).data.items, ref = items[0].body.ref, c = api.artifactRead({ root, scope: "task", task: "build-cache", ref, pageBytes: 4 }).data.next_cursor;
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: items[1].body.ref, cursor: c }), "stale_cursor");
  error(() => list(api, root, { cursor: c }), "stale_cursor");
  const lc = list(api, root, { limit: 1 }).data.next_cursor;
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref, cursor: lc }), "stale_cursor");
});
cases[20] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "first");
  const c = list(api, root, { limit: 1 }).data.next_cursor;
  write(root, "specs/build-cache.md", "content-only edit");
  assert.equal(list(api, root, { limit: 1, cursor: c }).data.items[0].kind, "intake");
  write(root, "briefs/build-cache-intake.md", "new");
  error(() => list(api, root, { cursor: c }), "stale_cursor");
  const c2 = list(api, root, { limit: 1 }).data.next_cursor;
  fs.rmSync(path.join(root, "briefs/build-cache-intake.md"));
  fs.mkdirSync(path.join(root, "briefs/build-cache-intake.md"));
  error(() => list(api, root, { cursor: c2 }), "stale_cursor");
});
cases[21] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer", role: "old" }, { name: "zebra" }]);
  write(root, ".harness/agents/reviewer.md", definition());
  const first = pList(api, root, { limit: 1 }), ref = first.data.items[0].body.ref;
  project(root, [{ name: "reviewer", role: "new" }, { name: "zebra" }]);
  error(() => pList(api, root, { cursor: first.data.next_cursor }), "stale_cursor");
  assert.ok(api.artifactRead({ root, scope: "project", ref }).data.text.includes("reviewer"));
  project(root, [{ name: "zebra" }]);
  error(() => api.artifactRead({ root, scope: "project", ref }), "stale_reference");
});
cases[22] = () => fixture((root, api) => {
  const body = "a\u{1F600}z";
  write(root, "specs/build-cache.md", body);
  const ref = list(api, root).data.items[0].body.ref, initial = api.artifactRead({ root, scope: "task", task: "build-cache", ref, pageBytes: 4 }), base = untoken(initial.data.next_cursor);
  for (const offset of [-1, 7, 2, 3, 4]) error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref, cursor: token({ ...base, offset }) }), "invalid_cursor");
  for (const offset of [0, 1, 5, 6]) {
    const x = api.artifactRead({ root, scope: "task", task: "build-cache", ref, cursor: token({ ...base, offset }) }).data;
    assert.equal(x.range.start, offset);
    assert.equal(x.text, Buffer.from(body).subarray(offset).toString());
    assert.equal(x.eof, true);
  }
  const eof = api.artifactRead({ root, scope: "task", task: "build-cache", ref, cursor: token({ ...base, offset: 6 }) }).data;
  assert.deepEqual(eof.range, { start: 6, end: 6 });
  assert.equal(eof.text, "");
});
cases[23] = () => fixture((root, api) => {
  const body = "a\u{1F600}\u{1F600}z";
  write(root, "specs/build-cache.md", body);
  const ref = list(api, root).data.items[0].body.ref;
  for (const pageBytes of [4, 65536, 131072]) {
    const x = api.artifactRead({ root, scope: "task", task: "build-cache", ref, pageBytes }).data;
    assert.equal(x.range.end, pageBytes === 4 ? 1 : 10);
  }
  for (const n of [3, 131073, 1.5, -1, "4", NaN, Infinity]) error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref, pageBytes: n }), "invalid_request");
  for (const n of ["+4", "4.0", "4e0", "-4", "3", "131073"]) callError(root, ["artifact-read", "--root", root, "--scope", "task", "--task", "build-cache", "--ref", ref, "--page-bytes", n], "invalid_request");
  const r = cli(root, ["artifact-read", "--root", root, "--scope", "task", "--task", "build-cache", "--ref", ref, "--page-bytes", "0004"]);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).data.text, "a");
});
cases[24] = () => fixture((root, api) => {
  const body = "\uFEFF\r\n\0\uFDD0\u{1F600}\xE9";
  write(root, "specs/build-cache.md", body);
  assert.equal(readAll(api, root, list(api, root).data.items[0]), body);
  write(root, "briefs/build-cache-review.json", '{"task":"build-cache","status":"\\ud800","date":"safe","round":2}');
  let i = list(api, root).data.items.find((x) => x.kind === "review");
  assert.equal(i.metadata.fields.reported.status, null);
  assert.equal(i.metadata.fields.reported.date, "safe");
  assert.equal(i.metadata.fields.reported.round, 2);
  assert.ok(i.metadata.issues.items.some((x) => x.reason === "ill-formed-string"));
  assert.ok(readAll(api, root, i).includes("\\ud800"));
  project(root, [{ name: "reviewer", role: "\uD800" }]);
  write(root, ".harness/agents/reviewer.md", definition());
  i = aItem(api, root);
  assert.equal(i.body.availability, "valid");
  assert.equal(i.metadata.fields.declaration.role, null);
  assert.equal(pList(api, root).data.total, 1);
});
cases[27] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "original");
  const ref = list(api, root).data.items[0].body.ref;
  fs.unlinkSync(path.join(root, "specs/build-cache.md"));
  fs.symlinkSync("missing", path.join(root, "specs/build-cache.md"));
  error(() => api.artifactRead({ root, scope: "task", task: "different", ref: "invalid!", cursor: "invalid!" }), "invalid_reference");
  error(() => api.artifactRead({ root, scope: "task", task: "different", ref }), "invalid_reference");
  fs.unlinkSync(path.join(root, "specs/build-cache.md"));
  write(root, "specs/build-cache.md", "changed");
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref, cursor: token({ v: 1, operation: "artifact-read", source_id: untoken(ref).source_id, fingerprint: "0".repeat(64), offset: 0 }) }), "stale_reference");
});
cases[28] = () => fixture((root, api) => {
  assert.throws(() => api.artifactCapabilities({}), (e) => e instanceof api.ObservationError && e.code === "invalid_request");
  error(() => api.artifactList({ root, scope: "task", extra: true }), "invalid_request");
  for (const limit of [0, 101, 1.1, "1", NaN, Infinity]) error(() => list(api, root, { limit }), "invalid_request");
  error(() => api.artifactList({ root, scope: "project", task: "build-cache" }), "invalid_request");
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: "", extra: true }), "invalid_request");
  for (const args of [["artifact-capabilities", "--extra", "x"], ["artifact-list", "--root", root, "--scope", "task", "--scope", "task"], ["artifact-list", "--root", root, "--scope", "task", "--limit", "1.1"]]) callError(root, args, "invalid_request");
  write(root, "specs/build-cache.md", '<script>inert<\/script>\n"\\\u2028');
  const x = list(api, root);
  assert.deepEqual(Object.keys(x).sort(), ["data", "kind", "schema", "schema_version", "source"]);
  assert.equal(x.schema_version, 1);
  const r = cli(root, ["artifact-list", "--root", root, "--scope", "task", "--task", "build-cache"]);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.stdout), x);
  error(() => api.serialize({ text: "x".repeat(2097153) }), "output-limit");
  const names = Array.from({ length: 100 }, (_, n) => ({ name: "agent-" + n }));
  project(root, names);
  const tunables = Object.fromEntries(Array.from({ length: 20 }, (_, n) => ["field" + n, "v".repeat(2e3)]));
  for (const a of names) write(root, ".harness/agents/" + a.name + ".md", definition(a.name, { tunables }));
  error(() => pList(api, root, { limit: 100 }), "output_limit");
  callError(root, ["artifact-list", "--root", root, "--scope", "project", "--limit", "100"], "output_limit");
});
cases[32] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "");
  const i = list(api, root).data.items[0];
  assert.equal(i.body.availability, "valid");
  assert.equal(readAll(api, root, i), "");
  const missing = rawRef(root, "intake", "build-cache", "");
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: missing }), "stale_reference");
  for (const bytes of [[255], [224, 128, 128], [237, 160, 128], [128], [244, 144, 128, 128]]) {
    write(root, "specs/build-cache.md", Buffer.from(bytes));
    assert.equal(list(api, root).data.items[0].body.reason, "invalid-utf8");
  }
});
cases[33] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "long body".repeat(100));
  const l = list(api, root, { limit: 100 });
  assert.equal(l.data.next_cursor, null);
  assert.ok(l.data.items[0].body.ref);
  const ref = l.data.items[0].body.ref;
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref, cursor: "" }), "invalid_cursor");
  const x = api.artifactRead({ root, scope: "task", task: "build-cache", ref, pageBytes: 4, cursor: null });
  assert.equal(x.data.eof, false);
  assert.ok(x.data.next_cursor);
  assert.ok(x.data.range.end <= 4);
});
cases[34] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "canonical");
  write(root, "briefs/build-cache-intake.md", "intake");
  write(root, "briefs/build-cache-manifest.txt", "base=inert\n---\n../private.txt\n");
  const page = list(api, root, { limit: 1 });
  assert.equal(page.data.items.length, 1);
  assert.equal(api.artifactRead({ root, scope: "task", task: "build-cache", ref: rawRef(root, "intake", "build-cache", "intake") }).data.text, "intake");
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: rawRef(root, "private", "build-cache", "secret") }), "invalid_reference");
  project(root, [{ name: "reviewer", path: "../private" }]);
  write(root, ".harness/agents/reviewer.md", definition());
  assert.equal(pList(api, root).data.items.length, 1);
  project(root, []);
  const ref = rawRef(root, "agent-definition", "reviewer", definition(), "project", null);
  error(() => api.artifactRead({ root, scope: "project", ref }), "stale_reference");
});
cases[35] = () => fixture((root, api) => {
  const c = api.artifactCapabilities();
  assert.equal(c.schema.id, "https://github.com/mathiasbourgoin/roster/schema/artifact-observation/v1");
  assert.equal(c.schema_version, 1);
  assert.equal(c.data.reference_version, 1);
  assert.equal(c.data.cursor_version, 1);
  assert.equal(Object.hasOwn(c, "protocolVersion"), false);
  write(root, "specs/build-cache.md", "x");
  const ref = list(api, root).data.items[0].body.ref;
  error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref: token({ ...untoken(ref), v: 20260728 }) }), "invalid_reference");
});
cases[36] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer", model: "session-label", runtime: { enabled: true }, session: "authenticated" }]);
  write(root, ".harness/agents/reviewer.md", definition("reviewer", { model: "session-label" }));
  write(root, ".agents/agents/generated.md", definition("generated"));
  write(root, "roster/assignments.json", JSON.stringify({ name: "reviewer", session: "session-label", active: true }));
  const i = aItem(api, root);
  assert.deepEqual(i.use, { availability: "unknown", reason: "not-observed", session: null });
  assert.equal(pList(api, root).data.items.length, 1);
  assert.equal(Object.hasOwn(i.metadata.fields.declaration, "session"), false);
});
cases[37] = () => fixture((root, api) => {
  const c = api.artifactCapabilities().data.coverage;
  assert.equal(c.coverage_version, 1);
  assert.equal(c.entries.find((x) => x.id === "task-artifacts").availability, "supported");
  assert.equal(c.entries.find((x) => x.id === "legacy-phase-history").availability, "delegated");
  assert.equal(c.entries.find((x) => x.id === "live-execution").availability, "unsupported");
  project(root, [{ name: "reviewer" }]);
  assert.equal(aItem(api, root).body.availability, "absent");
  write(root, ".harness/agents/reviewer.md", "no frontmatter");
  assert.equal(aItem(api, root).body.availability, "valid");
  assert.equal(aItem(api, root).metadata.availability, "invalid");
  const missing = spawnSync(path.join(root, "absent-producer"), ["artifact-capabilities"]);
  assert.equal(missing.error.code, "ENOENT");
  assert.ok(missing.stdout === null || missing.stdout === void 0);
});
cases[12] = () => fixture((root, api) => {
  project(root, [{ name: "reviewer" }]);
  const stats = (value) => {
    let nodes = 0, depth = 0;
    const pending = [[value, 0]];
    while (pending.length) {
      const [v, d] = pending.pop();
      nodes++;
      depth = Math.max(depth, d);
      if (v !== null && typeof v === "object") for (const child of Object.values(v)) pending.push([child, d + 1]);
    }
    return { nodes, depth };
  };
  const payload = (count) => {
    let left = count;
    return { rows: Array.from({ length: 10 }, () => {
      const n = Math.min(100, left);
      left -= n;
      return Array(n).fill(0);
    }) };
  };
  write(root, ".harness/agents/reviewer.md", definition("reviewer", { tunables: payload(0) }));
  const base = stats(aItem(api, root).metadata).nodes;
  for (const n of [1e3 - base, 1001 - base]) {
    const body = definition("reviewer", { tunables: payload(n) });
    write(root, ".harness/agents/reviewer.md", body);
    const meta = aItem(api, root).metadata;
    if (n === 1e3 - base) {
      assert.equal(stats(meta).nodes, 1e3);
      assert.equal(meta.truncated, false);
      assert.equal(meta.availability, "valid");
    } else {
      assert.ok(stats(meta).nodes <= 1e3, "complete metadata subtree node bound");
      assert.equal(meta.truncated, true);
      assert.ok(meta.issues.items.some((x) => x.reason === "limit"));
    }
    assert.equal(aItem(api, root).body.total_bytes, Buffer.byteLength(body));
  }
  write(root, ".harness/agents/reviewer.md", definition("reviewer", { description: "a".repeat(1999) + "\u{1F600}z", tags: Array.from({ length: 101 }, () => "x"), tunables: Object.fromEntries(Array.from({ length: 65 }, (_, i2) => ["k" + i2, i2])) }));
  let i = aItem(api, root);
  assert.equal(i.metadata.fields.definition.description, "a".repeat(1999));
  assert.equal(i.metadata.fields.definition.tags.length, 100);
  assert.equal(Object.keys(i.metadata.fields.definition.tunables).length, 64);
  assert.equal(i.metadata.truncated, true);
  assert.ok(i.metadata.issues.total >= 3);
  write(root, ".harness/agents/reviewer.md", definition("reviewer", { description: "a".repeat(2e3), tags: Array(100).fill("x"), tunables: Object.fromEntries(Array.from({ length: 64 }, (_, n) => ["key" + n, n])) }));
  i = aItem(api, root);
  assert.equal(i.metadata.truncated, false);
  assert.equal(i.metadata.availability, "valid");
  const nested = (depth) => {
    let x = 1;
    for (let k = 0; k < depth; k++) x = [x];
    return x;
  };
  for (const [depth, valid] of [[31, true], [32, false]]) {
    write(root, "briefs/build-cache-review.json", JSON.stringify({ task: "build-cache", extension: nested(depth) }));
    i = list(api, root).data.items.find((x) => x.kind === "review");
    assert.equal(i.metadata.availability, valid ? "valid" : "invalid", "depth " + depth);
    assert.equal(i.body.availability, "valid");
  }
  for (const [length, valid] of [[99998, true], [99999, false]]) {
    write(root, "briefs/build-cache-review.json", JSON.stringify({ extension: Array(length).fill(0) }));
    i = list(api, root).data.items.find((x) => x.kind === "review");
    assert.equal(i.metadata.availability, valid ? "valid" : "invalid", "nodes " + length);
    assert.equal(i.body.availability, "valid");
  }
  for (const depth of [31, 1e4]) {
    const body = '{"extension":' + "[".repeat(depth) + "0" + "]".repeat(depth) + "}";
    write(root, "briefs/build-cache-review.json", body);
    const r = cli(root, ["artifact-list", "--root", root, "--scope", "task", "--task", "build-cache"]);
    assert.equal(r.status, 0, r.stderr);
    const i2 = JSON.parse(r.stdout).data.items.find((x) => x.kind === "review");
    assert.equal(i2.body.availability, "valid");
    assert.equal(i2.metadata.availability, depth === 31 ? "valid" : "invalid");
  }
  for (const [depth, valid] of [[4, true], [5, false]]) {
    write(root, ".harness/agents/reviewer.md", definition("reviewer", { tunables: { a: nested(depth) } }));
    const meta = aItem(api, root).metadata;
    assert.ok(stats(meta).depth <= 8);
    assert.equal(meta.truncated, !valid);
  }
  for (const n of [1e4, 10001]) {
    project(root, Array.from({ length: n }, (_, index) => ({ name: "agent-" + index })));
    const out = pList(api, root);
    assert.equal(out.data.total, n === 1e4 ? 1e4 : null);
    assert.equal(out.data.availability.status, n === 1e4 ? "valid" : "invalid");
  }
  project(root, [{ name: "reviewer" }]);
  const basic = definition().split("\n---\n")[0].slice(4);
  for (const size of [65536, 65537]) {
    const fm = basic + " ".repeat(size - Buffer.byteLength(basic) - 1) + "\n";
    const body = "---\n" + fm + "---\nbody";
    write(root, ".harness/agents/reviewer.md", body);
    i = aItem(api, root);
    assert.equal(i.metadata.availability, size === 65536 ? "valid" : "invalid", "frontmatter bytes " + size);
    assert.equal(i.body.total_bytes, Buffer.byteLength(body));
  }
  write(root, ".harness/agents/reviewer.md", definition("reviewer", { tunables: { a: nested(9) } }));
  i = aItem(api, root);
  assert.equal(i.metadata.truncated, true);
  assert.ok(i.metadata.issues.items.some((x) => x.reason === "limit"));
  write(root, ".harness/agents/reviewer.md", definition("reviewer", { description: "\uD800", tags: Array(100).fill("\uD800") }));
  i = aItem(api, root);
  assert.equal(i.metadata.issues.total, 101);
  assert.equal(i.metadata.issues.items.length, 100);
  assert.ok(i.metadata.issues.truncated);
});
cases[25] = () => fixture((root, api) => {
  const manifest = JSON.stringify({ layers: { agents: [{ name: "reviewer" }] } }), mbody = manifest + " ".repeat(16777216 - Buffer.byteLength(manifest));
  write(root, ".harness/harness.json", mbody);
  const prefix = definition(), body = prefix + "x".repeat(16777216 - Buffer.byteLength(prefix));
  write(root, ".harness/agents/reviewer.md", body);
  const o = pList(api, root);
  assert.equal(o.data.context.project_manifest.body.total_bytes, 16777216);
  assert.equal(o.data.items[0].body.total_bytes, 16777216);
  assert.equal(o.data.items[0].body.availability, "valid");
  const x = api.artifactRead({ root, scope: "project", ref: o.data.items[0].body.ref, pageBytes: 4 });
  assert.equal(x.data.total_bytes, 16777216);
  assert.equal(x.data.text, body.slice(0, 4));
  for (const file of ["specs/build-cache.md", "briefs/build-cache-intake.md", "briefs/build-cache-spec.md"]) write(root, file, "x".repeat(16777216));
  const originalRead = fs.readSync;
  let physical = 0;
  try {
    fs.readSync = function(fd, b, o2, len, pos) {
      const n = originalRead.call(this, fd, b, o2, len, pos);
      if (n && fs.readlinkSync("/proc/self/fd/" + fd).startsWith(root + path.sep)) physical += n;
      return n;
    };
    api.artifactRead({ root, scope: "project", ref: o.data.items[0].body.ref, pageBytes: 4 });
    assert.equal(physical, 33554432, "maximum pair consumes exact32MiB");
    for (const limit of [3, 100]) {
      physical = 0;
      error(() => list(api, root, { limit }), "output_limit");
      assert.ok(physical <= 33554432, "physical consumption never exceeds32MiB: " + physical);
    }
  } finally {
    fs.readSync = originalRead;
  }
});
cases[26] = () => fixture((root, api) => {
  write(root, "specs/build-cache.md", "original bytes");
  const ref = list(api, root).data.items[0].body.ref, file = path.join(root, "specs/build-cache.md");
  const originalRead = fs.readSync;
  let changed = false;
  try {
    fs.readSync = function(fd, b, o, len, pos) {
      const n = originalRead.call(this, fd, b, o, len, pos);
      if (n && !changed) {
        const name = fs.readlinkSync("/proc/self/fd/" + fd);
        if (name === file) {
          changed = true;
          fs.writeFileSync(file, "mutating bytes");
        }
      }
      return n;
    };
    error(() => api.artifactRead({ root, scope: "task", task: "build-cache", ref }), "stale_reference");
    assert.equal(changed, true);
  } finally {
    fs.readSync = originalRead;
  }
  changed = false;
  try {
    fs.readSync = function(fd, b, o, len, pos) {
      const n = originalRead.call(this, fd, b, o, len, pos);
      if (n && !changed && fs.readlinkSync("/proc/self/fd/" + fd) === file) {
        changed = true;
        fs.writeFileSync(file, "changed again!");
      }
      return n;
    };
    const i = list(api, root).data.items[0];
    assert.equal(i.body.availability, "invalid");
    assert.equal(i.body.reason, "source-changed");
    assert.equal(i.body.ref, null);
  } finally {
    fs.readSync = originalRead;
  }
  write(root, "specs/build-cache.md", "deletion test");
  changed = false;
  try {
    fs.readSync = function(fd, b, o, len, pos) {
      const n = originalRead.call(this, fd, b, o, len, pos);
      if (n && !changed && fs.readlinkSync("/proc/self/fd/" + fd) === file) {
        changed = true;
        fs.unlinkSync(file);
      }
      return n;
    };
    const observed = list(api, root).data.items[0];
    assert.equal(observed.body.availability, "invalid");
    assert.equal(observed.body.reason, "source-changed");
    assert.equal(observed.body.ref, null);
  } finally {
    fs.readSync = originalRead;
  }
  project(root, [{ name: "reviewer" }]);
  write(root, ".harness/agents/reviewer.md", definition());
  const pref = aItem(api, root).body.ref;
  changed = false;
  try {
    fs.readSync = function(fd, b, o, len, pos) {
      const n = originalRead.call(this, fd, b, o, len, pos);
      if (n && !changed && fs.readlinkSync("/proc/self/fd/" + fd) === path.join(root, ".harness/agents/reviewer.md")) {
        changed = true;
        project(root, []);
      }
      return n;
    };
    error(() => api.artifactRead({ root, scope: "project", ref: pref }), "stale_reference");
    assert.equal(changed, true);
  } finally {
    fs.readSync = originalRead;
  }
});
function install(root) {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "artifact-observation.manifest.json")));
  const entries = [...m.members, { logical: "roadmap/artifact-observation.manifest.json", source: "scripts/artifact-observation.manifest.json" }];
  for (const e of entries) {
    const dest = path.join(root, ".harness", e.logical);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", e.source), dest);
  }
  write(root, "package.json", JSON.stringify({ type: "module" }));
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
  return entries;
}
function syncQualification(entries) {
  fixture((root) => {
    write(root, ".harness/harness.json", JSON.stringify({ version: "1.0.0", profile: "core", runtimes: [], project: { name: "fixture" }, layers: { agents: [], skills: [], rules: [], hooks: [] } }));
    const sync = (check) => {
      const r2 = spawnSync("bash", [path.join(__dirname, "sync-harness.sh"), root, ...check ? ["--check"] : []], { encoding: "utf8", timeout: 3e4, maxBuffer: 4 * 1024 * 1024 });
      assert.ifError(r2.error);
      return r2;
    };
    let r = sync(false);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const e of entries) assert.deepEqual(fs.readFileSync(path.join(root, ".harness", e.logical)), fs.readFileSync(path.join(__dirname, "..", e.source)));
    r = sync(true);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const e of entries) {
      const file = path.join(root, ".harness", e.logical), bytes = fs.readFileSync(file);
      fs.unlinkSync(file);
      assert.notEqual(sync(true).status, 0, e.logical + " missing sync check");
      fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from("\nchanged\n")]));
      assert.notEqual(sync(true).status, 0, e.logical + " stale sync check");
      fs.unlinkSync(file);
      fs.symlinkSync(path.join(root, ".harness/harness.json"), file);
      assert.notEqual(sync(true).status, 0, e.logical + " symlink sync check");
      fs.unlinkSync(file);
      fs.writeFileSync(file, bytes);
    }
  });
}
cases[29] = () => fixture((root, api) => {
  const entries = install(root), entry = path.join(root, ".harness/bin/roster-pipeline.cjs");
  assert.equal(entries.length, 15);
  const c = api.artifactCapabilities();
  assert.equal(c.data.limits.source_bytes, 16777216);
  assert.deepEqual(c.data.limits.page_bytes, { min: 4, default: 65536, max: 131072 });
  assert.equal(c.data.limits.metadata.input_nodes, 1e5);
  const schema = fs.readFileSync(path.join(root, ".harness/roadmap/artifact-observation.schema.json"));
  assert.equal(c.schema.digest, sha(schema));
  const r = cli(root, ["artifact-capabilities"], entry);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), c);
  write(root, "specs/build-cache.md", "relocated\u{1F600}body".repeat(300));
  const source = list(api, root, { limit: 1 }), installed = JSON.parse(cli(root, ["artifact-list", "--root", root, "--scope", "task", "--task", "build-cache", "--limit", "1"], entry).stdout);
  assert.deepEqual(installed, source);
  const ref = source.data.items[0].body.ref;
  const esm = spawnSync(process.execPath, ["--input-type=module", "-e", 'import api from "./.harness/bin/roster-pipeline.cjs";process.stdout.write(JSON.stringify(api.artifactRead({root:process.cwd(),scope:"task",task:"build-cache",ref:process.argv[1],pageBytes:4})));', ref], { cwd: root, encoding: "utf8", timeout: 15e3 });
  assert.equal(esm.status, 0, esm.stderr);
  assert.equal(JSON.parse(esm.stdout).data.text, "relo");
  for (const e of entries) {
    const file = path.join(root, ".harness", e.logical), backup = file + ".saved";
    fs.renameSync(file, backup);
    try {
      const bad = cli(root, ["artifact-capabilities"], entry);
      assert.notEqual(bad.status, 0, e.logical);
      if (e.logical !== "bin/roster-pipeline.cjs") assert.equal(JSON.parse(bad.stderr).error.code, "runtime_resource", e.logical);
    } finally {
      fs.renameSync(backup, file);
    }
    {
      const bytes = fs.readFileSync(file);
      try {
        fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from("\n ")]));
        const bad = cli(root, ["artifact-capabilities"], entry);
        assert.notEqual(bad.status, 0, e.logical);
        assert.equal(JSON.parse(bad.stderr).error.code, "runtime_resource", e.logical);
      } finally {
        fs.writeFileSync(file, bytes);
      }
    }
    const linked = file + ".saved.cjs";
    fs.renameSync(file, linked);
    fs.symlinkSync(linked, file);
    try {
      const bad = cli(root, ["artifact-capabilities"], entry);
      assert.notEqual(bad.status, 0, e.logical + " symlink");
      assert.equal(JSON.parse(bad.stderr).error.code, "runtime_resource", e.logical + " symlink");
    } finally {
      fs.unlinkSync(file);
      fs.renameSync(linked, file);
    }
  }
  const resourcePairs = entries.map((e) => [e.logical, sha(fs.readFileSync(path.join(root, ".harness", e.logical)))]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const fp = sha(canonical(resourcePairs));
  const sid = source.source.id, tuples = source.data.items;
  assert.ok(/^[a-f0-9]{64}$/.test(fp));
  const first = api.artifactRead({ root, scope: "task", task: "build-cache", ref, pageBytes: 4 });
  assert.equal(untoken(first.data.next_cursor).fingerprint, sha(canonical(["artifact-read/v1", sid, "task", "build-cache", "spec", "build-cache", sha(Buffer.from("relocated\u{1F600}body".repeat(300))), Buffer.byteLength("relocated\u{1F600}body".repeat(300)), fp])));
  const vendor = path.join(root, ".harness/bin/vendor"), moved = vendor + ".saved";
  fs.renameSync(vendor, moved);
  fs.symlinkSync(moved, vendor);
  try {
    const bad = cli(root, ["artifact-capabilities"], entry);
    assert.equal(bad.status, 2);
    assert.equal(JSON.parse(bad.stderr).error.code, "runtime_resource");
  } finally {
    fs.unlinkSync(vendor);
    fs.renameSync(moved, vendor);
  }
  syncQualification(entries);
});
cases[30] = () => fixture((root, api) => {
  const entries = install(root), entry = path.join(root, ".harness/bin/roster-pipeline.cjs");
  const missing = spawnSync(path.join(root, "missing-node"), [entry, "artifact-capabilities"]);
  assert.equal(missing.error.code, "ENOENT");
  const absent = spawnSync(process.execPath, [path.join(root, "missing-producer.cjs"), "artifact-capabilities"], { encoding: "utf8" });
  assert.notEqual(absent.status, 0);
  assert.equal(absent.stdout, "");
  write(root, "old-producer.cjs", 'process.stderr.write("unknown command");process.exitCode=2;');
  const old = cli(root, ["artifact-capabilities"], path.join(root, "old-producer.cjs"));
  assert.equal(old.status, 2);
  assert.throws(() => JSON.parse(old.stderr));
  fs.writeFileSync(path.join(root, ".harness/roadmap/artifact-coverage.json"), JSON.stringify({ coverage_version: 2, entries: [] }));
  const bad = cli(root, ["artifact-capabilities"], entry);
  assert.equal(JSON.parse(bad.stderr).error.code, "runtime_resource");
  const checker = path.join(root, "artifact-observation-check.cjs");
  fs.copyFileSync(__filename, checker);
  write(root, "roster-pipeline.cjs", "module.exports={};");
  let r = cli(root, ["--case", "AC-1"], checker);
  assert.equal(r.status, 2, "absent implementation is setup2");
  write(root, "roster-pipeline.cjs", 'module.exports={artifactCapabilities(){},artifactList(){throw Error("producer crash after setup");},artifactRead(){}};');
  r = cli(root, ["--case", "AC-1"], checker);
  assert.equal(r.status, 1, "validly set up producer crash is assertion1");
  const pass = cli(root, ["--case", "AC-35"], __filename);
  assert.equal(pass.status, 0, "actual public success is0");
});
cases[31] = () => fixture((root, api) => {
  const entries = install(root), entry = path.join(root, ".harness/bin/roster-pipeline.cjs");
  write(root, "specs/build-cache.md", "canonical only");
  write(root, "briefs/build-cache-intake.md", "legacy".repeat(500));
  const old = api.show(root, "build-cache"), oldlist = api.list(root), oldcaps = api.capabilities();
  assert.equal(old.schema.id, "https://github.com/mathiasbourgoin/roster/schema/pipeline-observation/v1");
  assert.equal(old.data.components.intake.value.text.length, 2e3);
  assert.equal(old.data.components.intake.truncated, true);
  assert.equal(Object.keys(old.data.components).length, 9);
  assert.equal(oldlist.data.items.length, 1);
  assert.equal(oldcaps.kind, "pipeline-capabilities");
  for (const e of entries.filter((e2) => !["bin/roster-pipeline.cjs", "bin/roster-pipeline-ledger.cjs", "bin/roster-artifacts.cjs", "bin/lib/review/finding-schema.cjs", "roadmap/pipeline-observation.schema.json", "roadmap/pipeline-coverage.json", "roadmap/qa-state.schema.json"].includes(e2.logical))) {
    const file = path.join(root, ".harness", e.logical), bytes = fs.readFileSync(file);
    fs.unlinkSync(file);
    try {
      for (const command of ["capabilities", "list", "show"]) {
        const args = command === "show" ? [command, "--root", root, "--task", "build-cache"] : command === "list" ? [command, "--root", root] : [command];
        const r2 = cli(root, args, entry);
        assert.equal(r2.status, 0, e.logical + " " + command);
        const x = JSON.parse(r2.stdout);
        assert.ok(/^[a-f0-9]{64}$/.test(x.version));
        assert.ok(Number.isFinite(Date.parse(x.generated_at)));
        if (command === "show") {
          assert.deepEqual(x.data, old.data);
          assert.equal(x.schema.id, old.schema.id);
        }
        if (command === "list") assert.deepEqual(x.data, oldlist.data);
      }
      const r = cli(root, ["artifact-capabilities"], entry);
      assert.equal(r.status, 2);
      assert.equal(JSON.parse(r.stderr).error.code, "runtime_resource");
    } finally {
      fs.writeFileSync(file, bytes);
    }
  }
});
function run(which) {
  const n = Number(String(which).replace(/^AC-/, ""));
  if (!Number.isInteger(n) || n < 1 || n > 38) throw new SetupError("unknown case");
  if (!cases[n]) throw new SetupError(`AC-${n} not yet delivered`);
  return cases[n]();
}
function main(args) {
  try {
    if (args.length === 1 && args[0] === "--all") {
      for (let n = 1; n <= 38; n++) {
        run(n);
        console.log(`AC-${n} PASS`);
      }
    } else if (args.length === 2 && args[0] === "--case") {
      run(args[1]);
      console.log(`${args[1]} PASS`);
    } else throw new SetupError("use --case AC-N or --all");
  } catch (e) {
    console.error(e.stack);
    process.exitCode = e instanceof SetupError ? 2 : 1;
  }
}
module.exports = { run };
if (require.main === module) main(process.argv.slice(2));
