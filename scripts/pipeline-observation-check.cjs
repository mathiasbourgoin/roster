#!/usr/bin/env node
"use strict";
// Acceptance runner: 0 pass, 1 assertion failure, 2 setup/execution failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts/roster-pipeline.cjs");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const event = (phase = "implement", outcome = "COMPLETED") => ({ phase, outcome });
const ledger = (task = "alpha", events = [event()]) => ({ task, mode: "full", current_phase: events.at(-1).phase, events });
const bytes = 16 * 1024 * 1024;
function api() { return require(CLI); }
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-acceptance-"));
  fs.mkdirSync(path.join(root, "briefs"));
  const write = (name, value) => fs.writeFileSync(path.join(root, "briefs", name), typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  try { return fn(root, write); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function typed(fn, code) { assert.throws(fn, error => error.code === code, `expected ${code}`); }
function command(args, cli = CLI, cwd = ROOT) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function catalog() {
  smoke(); const observer = api();
  fixture((root, write) => {
    write("alpha-state.json", ledger()); write("alpha-intake.md", "# alpha"); write("beta-intake.md", "# beta");
    const first = observer.list(root, { limit: 1 });
    assert.equal(first.data.total, 2); assert.equal(first.data.items[0].task, "alpha"); assert.ok(first.data.next_cursor);
    const next = observer.list(root, { limit: 2, cursor: first.data.next_cursor });
    assert.deepEqual(next.data.items.map(i => i.task), ["beta"]); assert.equal(next.data.next_cursor, null);
    assert.equal(observer.show(root, "beta").data.components.ledger.availability, "absent");
    write("alpha-state.json", ledger("alpha", [event("review", "NO-GO")]));
    assert.equal(observer.list(root, { cursor: first.data.next_cursor }).data.items[0].task, "beta");
    write("unrelated.txt", "not a source"); write("beta-state.json", ledger("beta"));
    assert.equal(observer.list(root, { cursor: first.data.next_cursor }).data.items[0].task, "beta");
    write("gamma-intake.md", "# gamma"); typed(() => observer.list(root, { cursor: first.data.next_cursor }), "stale-cursor");
    const lastCursor = observer.list(root, { limit: 2 }).data.next_cursor;
    fs.unlinkSync(path.join(root, "briefs/beta-state.json")); fs.unlinkSync(path.join(root, "briefs/beta-intake.md")); fs.unlinkSync(path.join(root, "briefs/gamma-intake.md"));
    typed(() => observer.list(root, { cursor: lastCursor }), "stale-cursor");
    for (const limit of [0, -1, 1.5, 101, "1", NaN, Infinity]) typed(() => observer.list(root, { limit }), "invalid-request");
    typed(() => observer.list(root, { wat: true }), "invalid-request");
    for (const cursor of ["bad!", "a".repeat(4097), Buffer.from(JSON.stringify({ version: 1, kind: "catalog", root, offset: -1, fingerprint: "0".repeat(64) })).toString("base64url")]) typed(() => observer.list(root, { cursor }), "invalid-cursor");
    write("alpha-state.json", "broken");
    const corrupt = observer.list(root).data.items.find(i => i.task === "alpha");
    assert.equal(corrupt.ledger.availability, "invalid"); assert.equal(corrupt.ledger.reason, "parse"); assert.equal(corrupt.ledger.digest, sha("broken"));
    const outside = path.join(root, "sentinel"); fs.writeFileSync(outside, "untouched"); fs.symlinkSync(outside, path.join(root, "briefs/linked-state.json"));
    fs.mkdirSync(path.join(root, "briefs/directory-state.json")); write("Unsafe-intake.md", "hidden");
    const safe = observer.list(root); assert.equal(safe.data.items.find(i => i.task === "linked").ledger.availability, "invalid");
    assert.equal(safe.data.items.find(i => i.task === "directory").ledger.availability, "invalid"); assert.ok(safe.data.unsafe_names_count >= 1);
    assert.equal(fs.readFileSync(outside, "utf8"), "untouched");
  });
  fixture(root => {
    fs.rmdirSync(path.join(root, "briefs")); assert.equal(observer.list(root).data.availability, "absent");
    fs.writeFileSync(path.join(root, "briefs"), "not-directory"); assert.equal(observer.list(root).data.availability, "invalid");
    fs.unlinkSync(path.join(root, "briefs")); fs.mkdirSync(path.join(root, "elsewhere")); fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, "briefs"));
    assert.equal(observer.list(root).data.availability, "invalid");
  });
  fixture(root => {
    for (let n = 0; n < 10000; n++) fs.writeFileSync(path.join(root, "briefs", `unrelated-${n}`), "");
    let result = observer.list(root); assert.equal(result.data.availability, "valid"); assert.equal(result.data.total, 0);
    fs.writeFileSync(path.join(root, "briefs/one-more"), ""); result = observer.list(root);
    assert.equal(result.data.availability, "unknown"); assert.equal(result.data.reason, "scan-limit"); assert.equal(result.data.total, null);
    assert.deepEqual(result.data.items, []); assert.equal(result.data.next_cursor, null);
  });
}
function parity(observer) {
  const source = fs.readFileSync(path.join(ROOT, "skills/pipeline/roster-run.md"), "utf8");
  const predicate = source.match(/LEDGER_SCHEMA='([\s\S]*?)'\n/)[1];
  const samples = [ledger(), ledger("alpha", [event("review", "NO-GO"), event()]), { ...ledger(), extra: true, schema_version: 999 }, { ...ledger(), mode: "fast", events: [event("spec", "VALIDATED"), event()] }];
  for (const value of [null, false, 0, [], {}, { ...ledger(), events: [] }, { ...ledger(), task: "beta" }]) samples.push(value);
  for (const mode of ["express-lite", "express", "fast", "full", "constructor", null, 7]) for (const phase of ["implement", "spec", "ship", "bogus"]) samples.push({ ...ledger(), mode, current_phase: phase, events: [event(phase, phase === "spec" ? "VALIDATED" : "COMPLETED")] });
  for (const alteration of [{ by: 7, at: false }, { reason: false }, { reason: "" }, { phase: null }, { outcome: "BLOCKED" }, { outcome: "PARTIAL" }]) samples.push(ledger("alpha", [{ ...event(), ...alteration }]));
  for (const outcome of [["COMPLETED"], ["PARTIAL"], ["COMPLETED", "PARTIAL"],
    ["PARTIAL", "COMPLETED"], [], ["COMPLETED", null], {}, null, 7]) {
    samples.push(ledger("alpha", [{ phase: "implement", outcome }]));
  }
  for (const sample of samples) {
    const jq = spawnSync("jq", ["-e", "--arg", "t", "alpha", predicate], { input: JSON.stringify(sample), encoding: "utf8", timeout: 5000 });
    if (jq.error) throw jq.error;
    assert.equal(observer.validateLedger(sample, "alpha"), jq.status === 0, `canonical parity: ${JSON.stringify(sample)}`);
  }
}
function detail() {
  const observer = api(); parity(observer);
  fixture((root, write) => {
    write("alpha-state.json", ledger());
    // Swap after lstat but before open: opening a FIFO must not block before fstat.
    const probe = `const fs=require('node:fs'),cp=require('node:child_process');
      const source=process.argv[1],root=process.argv[2],target=root+'/briefs/alpha-state.json',open=fs.openSync;
      let swapped=false;
      fs.openSync=function(file,...args){if(file===target&&!swapped){swapped=true;fs.unlinkSync(target);cp.execFileSync('mkfifo',[target]);}return open.call(this,file,...args);};
      process.stdout.write(JSON.stringify(require(source).show(root,'alpha')));`;
    const observed = spawnSync(process.execPath, ["-e", probe, CLI, root], {
      encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.notEqual(observed.error?.code, "ETIMEDOUT", "FIFO replacement must not block observation");
    if (observed.error) throw observed.error;
    assert.equal(observed.status, 0, observed.stderr);
    const value = JSON.parse(observed.stdout).data.components.ledger;
    assert.equal(value.availability, "invalid"); assert.equal(value.reason, "unsafe");
    assert.equal(value.digest, null);
  });
  fixture((root, write) => {
    write("alpha-state.json", ledger("alpha", [{ phase: "implement", outcome: ["COMPLETED"] }]));
    const value = observer.show(root, "alpha");
    assert.equal(value.data.components.ledger.availability, "valid", "router accepts an outcome subarray");
    assert.equal(value.data.latest_completed.outcome, null, "non-scalar display outcome remains unknown");
    assert.equal(value.data.components.ledger.value.latest_completed.outcome, null);
    assert.equal(value.data.history.items[0].outcome, null);
    assert.equal(observer.list(root).data.items[0].latest_completed.outcome, null);
    const { $id, ...assertions } = JSON.parse(fs.readFileSync(path.join(ROOT, "schema/pipeline-observation.schema.json")));
    const checked = require("./lib/review/finding-schema.cjs").compile(assertions).validate(value);
    assert.equal(checked.valid, true, checked.errors.join("\n"));
  });
  fixture((root, write) => {
    const finding = { severity: "MEDIUM", confidence: 100, path: "src/example.js", line: 4,
      category: "correctness", summary: "Canonical operator-visible explanation",
      evidence: "Observed failing example", fix: "Correct the example",
      fingerprint: "canonical-example", specialist: "reviewer" };
    const canonical = require("./lib/review/finding-schema.cjs").compile(
      JSON.parse(fs.readFileSync(path.join(ROOT, "schema/review-finding.schema.json"))));
    assert.equal(canonical.validate(finding).valid, true, "fixture must use the canonical finding contract");
    write("alpha-review.json", { task: "alpha", status: "NO-GO", findings: [finding] });
    const result = observer.show(root, "alpha");
    assert.equal(result.data.components.review.availability, "valid");
    assert.equal(result.data.components.review.value.findings.items[0].summary, finding.summary);
    const { $id, ...assertions } = JSON.parse(fs.readFileSync(path.join(ROOT, "schema/pipeline-observation.schema.json")));
    const checked = require("./lib/review/finding-schema.cjs").compile(assertions).validate(result);
    assert.equal(checked.valid, true, checked.errors.join("\n"));
  });
  fixture((root, write) => {
    const events = Array.from({ length: 201 }, (_, n) => n % 2 ? event("review", "NO-GO") : event());
    events[0] = { ...event(), by: 9, at: "invalid", reason: "r".repeat(2001) }; events[1].by = "skill";
    write("alpha-state.json", ledger("alpha", events));
    let result = observer.show(root, "alpha", { history_limit: 1 });
    assert.equal(result.data.components.ledger.availability, "valid"); assert.equal(result.data.history.total, 201);
    assert.equal(result.data.history.items[0].id, "event:0"); assert.equal(result.data.history.items[0].actor.availability, "unknown");
    assert.equal(result.data.history.items[0].time.availability, "unknown"); assert.equal(result.data.history.items[0].reason.length, 2000);
    assert.equal(result.data.history.items[0].reason_truncated, true); assert.equal(result.data.latest_completed.phase, "implement");
    const cursor = result.data.history.next_cursor;
    result = observer.show(root, "alpha", { history_cursor: cursor, history_limit: 200 });
    assert.equal(result.data.history.items[0].id, "event:1"); assert.equal(result.data.history.items.at(-1).id, "event:200"); assert.equal(result.data.history.next_cursor, null);
    write("alpha-state.json", JSON.stringify(ledger("alpha", events)) + " "); typed(() => observer.show(root, "alpha", { history_cursor: cursor }), "stale-cursor");
    const lateCursor = observer.show(root, "alpha", { history_limit: 200 }).data.history.next_cursor;
    write("alpha-state.json", ledger()); typed(() => observer.show(root, "alpha", { history_cursor: lateCursor }), "stale-cursor");
    for (const history_limit of [0, -1, 1.1, 201, "1"]) typed(() => observer.show(root, "alpha", { history_limit }), "invalid-request");
    for (const task of ["../escape", "Alpha", "a".repeat(121), "", "a/b"]) typed(() => observer.show(root, task), "invalid-request");
    write("alpha-review.json", { task: "alpha", status: "GO", round: 1, cycle: 1, findings: Array.from({ length: 101 }, () => ({ severity: "LOW", path: "file", line: 1, summary: "d".repeat(2001), arbitrary: { forbidden: "nested" } })) });
    write("alpha-qa-state.json", { status: "GO", round: 1, cycle: 1, rounds_audit: [] }); write("alpha-qa.md", "**Status: NO-GO**");
    write("alpha-manifest.txt", "base=revision\n---\n/outside/never-read\n../never-read\n"); write("alpha-intake.md", "**Status: VALIDATED**\n" + "x".repeat(2100));
    result = observer.show(root, "alpha"); const components = result.data.components;
    assert.equal(components.review.availability, "valid"); assert.equal(components.review.value.findings.total, 101); assert.equal(components.review.value.findings.items.length, 100);
    assert.equal(components.review.value.findings.truncated, true); assert.equal(components.review.value.findings.items[0].summary.length, 2000);
    assert.ok(!("arbitrary" in components.review.value.findings.items[0])); assert.equal(components.qa_state.value.qa_no_go_round, null);
    assert.equal(result.data.verdict_disagreement, true); assert.equal(components.intake.truncated, true);
    assert.ok(components.manifest.value.items.includes("/outside/never-read"));
    write("alpha-qa-state.json", "{"); result = observer.show(root, "alpha");
    assert.equal(result.data.components.qa_state.availability, "invalid"); assert.equal(result.data.components.ledger.availability, "valid");
    write("alpha-review.json", { status: "GO", findings: "bad" }); assert.equal(observer.show(root, "alpha").data.components.review.reason, "domain");
    write("alpha-spec.md", Buffer.alloc(bytes, 32)); assert.equal(observer.show(root, "alpha").data.components.spec.availability, "valid");
    write("alpha-spec.md", Buffer.alloc(bytes + 1, 32)); result = observer.show(root, "alpha");
    assert.equal(result.data.components.spec.reason, "oversized"); assert.equal(result.data.components.spec.digest, null);
    assert.equal(observer.show(root, "unknown").data.availability, "absent");
  });
  // Observe a growing descriptor deterministically rather than hope a race occurs.
  fixture((root, write) => {
    write("growth", "small"); const file = path.join(root, "briefs/growth"); const io = require("./roster-artifacts.cjs");
    const original = fs.readSync; let grown = false;
    fs.readSync = function(...args) { if (!grown) { grown = true; fs.appendFileSync(file, Buffer.alloc(bytes + 1)); } return original.apply(this, args); };
    try { assert.throws(() => io.readBytes(file), /oversiz|limit|grow/i); } finally { fs.readSync = original; }
  });
}
function contract() {
  const observer = api(); const { compile } = require("./lib/review/finding-schema.cjs");
  const schemaId = "https://github.com/mathiasbourgoin/roster/schema/pipeline-observation/v1";
  const executable = spawnSync(CLI, ["capabilities"], { encoding: "utf8", timeout: 10000 });
  assert.equal(executable.error, undefined, "registered CLI must be executable directly"); assert.equal(executable.status, 0, executable.stderr);
  assert.equal(JSON.parse(executable.stdout).kind, "pipeline-capabilities");
  const schemaBytes = fs.readFileSync(path.join(ROOT, "schema/pipeline-observation.schema.json"));
  // $id identifies this self-contained schema; it is not an assertion or reference.
  const { $id, ...assertions } = JSON.parse(schemaBytes); assert.equal($id, schemaId);
  const validator = compile(assertions);
  const validate = value => { const report = validator.validate(value); assert.equal(report.valid, true, report.errors.join("\n")); if (value.schema) assert.equal(value.schema.id, schemaId); };
  fixture(root => {
    for (const [target, source] of Object.entries(CLOSURE)) {
      const destination = path.join(root, ".harness", target);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(ROOT, source), destination);
    }
    const installed = path.join(root, ".harness/bin/roster-pipeline.cjs");
    const current = command(["capabilities"], installed, root);
    assert.equal(current.status, 0, current.stderr); validate(JSON.parse(current.stdout));
    const schemaFile = path.join(root, ".harness/roadmap/pipeline-observation.schema.json");
    const experimental = JSON.parse(fs.readFileSync(schemaFile));
    experimental.$id = "https://roster.dev/schema/pipeline-observation/v1";
    fs.writeFileSync(schemaFile, JSON.stringify(experimental));
    const stale = command(["capabilities"], installed, root);
    assert.equal(stale.status, 2); assert.equal(stale.stdout, "");
    assert.equal(JSON.parse(stale.stderr).error.code, "runtime-resource");
  });
  fixture((root, write) => {
    write("alpha-state.json", ledger()); const a = observer.show(root, "alpha"), b = observer.show(root, "alpha");
    validate(a); validate(observer.list(root)); validate(observer.capabilities()); assert.equal(a.version, b.version); assert.equal(a.schema.digest, sha(schemaBytes));
    fixture((otherRoot, otherWrite) => { otherWrite("alpha-state.json", ledger()); const other = observer.show(otherRoot, "alpha"); assert.equal(other.data.components.ledger.digest, a.data.components.ledger.digest); assert.equal(other.version, a.version); assert.notEqual(other.root, a.root); });
    const unicode = '😀"\\\n'.repeat(401);
    write("alpha-review.json", { status: "GO", findings: [{ summary: unicode }] });
    const projected = observer.show(root, "alpha").data.components.review;
    assert.equal(projected.value.findings.items[0].summary, unicode.slice(0, 2000)); assert.equal(projected.truncated, true);
    assert.equal(a.data.components.ledger.digest, sha(fs.readFileSync(path.join(root, "briefs/alpha-state.json"))));
    write("alpha-review.json", { status: "GO" }); assert.notEqual(observer.show(root, "alpha").version, a.version);
    for (const method of [() => observer.list(root, { schema_version: 2 }), () => observer.show(root, "alpha", { schema_version: 2 }), () => observer.capabilities({ schema_version: 2 })]) typed(method, "unsupported-version");
    const caps = observer.capabilities(); assert.equal(caps.schema_version, 1);
    for (const id of ["live-execution", "session", "attempt", "full-report-history", "standalone-acceptance"]) assert.equal(caps.coverage.find(item => item.id === id).availability, "unsupported");
    write("alpha-manifest.txt", "base=revision\n---\n/forbidden/declaration-target\n../not-a-source\n");
    const before = fs.readFileSync(path.join(root, "briefs/alpha-state.json")); const mutationNames = ["writeFileSync", "appendFileSync", "renameSync", "unlinkSync", "mkdirSync", "rmSync", "rmdirSync", "truncateSync"];
    const child = require("node:child_process"), originals = new Map(), effects = [], opened = [];
    for (const [target, names] of [[fs, mutationNames], [child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]]]) for (const name of names) { originals.set([target, name], target[name]); target[name] = () => { effects.push(name); throw new Error(`observer side effect: ${name}`); }; }
    const open = fs.openSync; fs.openSync = function(file, flags, ...rest) { const readOnly = typeof flags === "number" ? !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC)) : flags === "r"; if (!readOnly) effects.push("open-writer"); opened.push(String(file)); assert.ok(readOnly, "observer opened writer"); return open.call(this, file, flags, ...rest); };
    try { assert.equal(observer.list(root).data.items[0].ledger.availability, "valid"); assert.equal(observer.show(root, "alpha").data.components.ledger.availability, "valid"); observer.capabilities(); } finally { fs.openSync = open; for (const [[target, name], original] of originals) target[name] = original; }
    assert.deepEqual(effects, []); assert.ok(!opened.some(file => file.includes("declaration-target") || file.includes("not-a-source")));
    assert.deepEqual(fs.readFileSync(path.join(root, "briefs/alpha-state.json")), before);
    for (const args of [["list", "--limit", "1.5"], ["list", "--limit", "1e2"], ["list", "--task", "alpha"], ["show", "--task", "alpha", "--limit", "1"], ["capabilities", "--wat"], ["list", "--schema-version", "999"]]) {
      const result = command([...args, ...(args[0] === "capabilities" ? [] : ["--root", root])]); assert.equal(result.status, 2); assert.equal(result.stdout, ""); validate(JSON.parse(result.stderr));
    }
    write("alpha-state.json", "bad-json"); const result = command(["show", "--root", root, "--task", "alpha"]); assert.equal(result.status, 0); validate(JSON.parse(result.stdout)); assert.equal(result.stderr, "");
  });
  const cap = 2 * 1024 * 1024; const overhead = Buffer.byteLength(JSON.stringify({ text: "" }));
  const exact = observer.serialize({ text: "x".repeat(cap - overhead) }); assert.equal(Buffer.byteLength(exact), cap);
  typed(() => observer.serialize({ text: "x".repeat(cap - overhead + 1) }), "output-limit");
  ordinaryEnvelopeBoundary(observer, cap);
}
function ordinaryEnvelopeBoundary(observer, cap) {
  fixture((root, write) => {
    write("alpha-state.json", ledger("alpha", Array.from({ length: 201 }, () => event())));
    const findings = Array.from({ length: 100 }, () => ({ severity: "s".repeat(1800), path: "p".repeat(1800), summary: "d".repeat(1800), status: "s".repeat(1800), specialist: "r".repeat(1800), line: 1 }));
    function reports(budget) {
      for (const suffix of ["review.json", "qa-state.json"]) {
        const cross_runtime = {};
        for (let index = 0; index < 30; index++) {
          const item = {};
          for (const field of ["status", "reason", "config_digest"]) { const count = Math.min(2000, budget); item[field] = "x".repeat(count); budget -= count; }
          cross_runtime[`r${index}`] = item;
        }
        write(`alpha-${suffix}`, { status: "GO", round: 1, cycle: 1, rounds_audit: [], findings, cross_runtime });
      }
      assert.equal(budget, 0, "fixture must fit within bounded scalar capacity");
    }
    reports(0); const base = Buffer.byteLength(observer.serialize(observer.show(root, "alpha", { history_limit: 200 })));
    const fill = cap - base; assert.ok(fill > 0 && fill < 360000);
    reports(fill);
    const exact = command(["show", "--root", root, "--task", "alpha", "--history-limit", "200"]);
    assert.equal(exact.status, 0, exact.stderr); assert.equal(Buffer.byteLength(exact.stdout), cap); assert.equal(exact.stderr, "");
    const value = JSON.parse(exact.stdout); assert.equal(value.data.history.items.length, 200); assert.ok(value.data.history.next_cursor);
    reports(fill + 1);
    typed(() => observer.show(root, "alpha", { history_limit: 200 }), "output-limit");
    const overflow = command(["show", "--root", root, "--task", "alpha", "--history-limit", "200"]);
    assert.equal(overflow.status, 2); assert.equal(overflow.stdout, ""); assert.equal(JSON.parse(overflow.stderr).error.code, "output-limit");
  });
}
const CLOSURE = {
  "bin/roster-pipeline.cjs": "scripts/roster-pipeline.cjs",
  "bin/roster-pipeline-ledger.cjs": "scripts/roster-pipeline-ledger.cjs",
  "bin/roster-artifacts.cjs": "scripts/roster-artifacts.cjs",
  "bin/lib/review/finding-schema.cjs": "scripts/lib/review/finding-schema.cjs",
  "roadmap/pipeline-observation.schema.json": "schema/pipeline-observation.schema.json",
  "roadmap/pipeline-coverage.json": "schema/pipeline-coverage.json",
  "roadmap/qa-state.schema.json": "schema/qa-state.schema.json",
};
function sync(root, check = false) {
  const result = spawnSync("bash", [path.join(ROOT, "scripts/sync-harness.sh"), root, ...(check ? ["--check"] : [])], { encoding: "utf8", timeout: 120000 });
  if (result.error) throw result.error; return result;
}
function install() {
  fixture((root, write) => {
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
    fs.mkdirSync(path.join(root, ".harness"));
    fs.writeFileSync(path.join(root, ".harness/harness.json"), JSON.stringify({ version: "1.0.0", profile: "core", runtimes: [], project: { name: "fixture" }, layers: { agents: [], rules: [], skills: [], hooks: [] } }));
    const initial = sync(root); assert.equal(initial.status, 0, initial.stderr + initial.stdout);
    const cli = path.join(root, ".harness/bin/roster-pipeline.cjs");
    for (const [target, source] of Object.entries(CLOSURE)) assert.deepEqual(fs.readFileSync(path.join(root, ".harness", target)), fs.readFileSync(path.join(ROOT, source)));
    write("alpha-state.json", ledger()); write("alpha-intake.md", "**Status: VALIDATED**");
    for (const args of [["list", "--root", root], ["show", "--root", root, "--task", "alpha"], ["capabilities"]]) {
      const source = command(args), installed = command(args, cli, root); assert.equal(source.status, 0, source.stderr); assert.equal(installed.status, 0, installed.stderr);
      const left = JSON.parse(source.stdout), right = JSON.parse(installed.stdout); delete left.generated_at; delete right.generated_at; assert.deepEqual(left, right);
    }
    assert.equal(fs.existsSync(path.join(root, "node_modules")), false); assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"))).type, "module");
    assert.equal(sync(root, true).status, 0);
    for (const target of Object.keys(CLOSURE)) {
      const location = path.join(root, ".harness", target), original = fs.readFileSync(location);
      fs.unlinkSync(location); assert.notEqual(sync(root, true).status, 0, `missing closure ${target}`);
      fs.writeFileSync(location, original); fs.appendFileSync(location, "\nchanged\n"); assert.notEqual(sync(root, true).status, 0, `stale closure ${target}`);
      fs.unlinkSync(location); fs.symlinkSync(path.join(root, "package.json"), location); assert.notEqual(sync(root, true).status, 0, `linked closure ${target}`);
      fs.unlinkSync(location); fs.writeFileSync(location, original);
    }
    for (const target of ["roadmap/pipeline-observation.schema.json", "roadmap/pipeline-coverage.json", "roadmap/qa-state.schema.json"]) {
      const location = path.join(root, ".harness", target), original = fs.readFileSync(location); fs.writeFileSync(location, "{");
      const result = command(["capabilities"], cli, root); assert.equal(result.status, 2); assert.equal(JSON.parse(result.stderr).error.code, "runtime-resource");
      fs.writeFileSync(location, original);
    }
    const nested = path.join(root, ".harness/bin/lib/review"); fs.rmSync(nested, { recursive: true });
    fs.mkdirSync(path.join(root, "outside")); fs.symlinkSync(path.join(root, "outside"), nested);
    assert.notEqual(sync(root).status, 0); assert.deepEqual(fs.readdirSync(path.join(root, "outside")), []);
    fs.unlinkSync(nested); fs.writeFileSync(nested, "non-directory ancestor"); assert.notEqual(sync(root).status, 0);
  });
}
const categories = { catalog, detail, contract, install };
function run(category) { assert.ok(Object.hasOwn(categories, category), "unknown acceptance category"); categories[category](); }
function smoke() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-check-"));
  try {
    fs.mkdirSync(path.join(root, "briefs"));
    fs.writeFileSync(path.join(root, "briefs/alpha-state.json"), JSON.stringify({ task: "alpha", mode: "full", current_phase: "intake", events: [{ phase: "intake", outcome: "VALIDATED" }] }));
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/roster-pipeline.cjs"), "list", "--root", root], { encoding: "utf8", timeout: 10000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `supported catalog CLI must succeed: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).data.items[0].task, "alpha");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
if (require.main === module) {
  try { const category = process.argv[2]; if (!Object.hasOwn(categories, category)) throw new Error("usage: pipeline-observation-check.cjs catalog|detail|contract|install"); run(category); process.stdout.write(`${category} acceptance passed\n`); }
  catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = error.code === "ERR_ASSERTION" ? 1 : 2; }
}
module.exports = { run, CLOSURE };
