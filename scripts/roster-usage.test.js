"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const CLI = path.join(__dirname, "roster-usage.cjs");
const NULL_TOTALS = { input_tokens: null, output_tokens: null, cache_creation_tokens: null, cache_read_tokens: null, cost_usd: null };
function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-usage-private-project-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
function totals(input = 10, cost = 0.1) { return { input_tokens: input, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 4, cost_usd: cost }; }
function normalized(stream = "private-stream", runtime = "codex", overrides = {}) {
  return { schema_version: 1, runtime, source: "runtime-observed", stream_id: stream, captured_at: "2026-11-12T09:00:00Z", model: "model-a", totals: totals(), ...overrides };
}
function legacy(task = "private-task", since = "2026-11-12T08:00:00Z", until = "2026-11-12T09:00:00Z", overrides = {}) {
  return { task, captured_at: "2026-11-12T10:00:00Z", runtime: "codex", join_method: "time-window-ledger", window: { since, until }, attribution: "approximate", cost_mode: "auto", offline: true, totals: totals(100, 1), ...overrides };
}
function jsonl(file, records) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, records.map(r => typeof r === "string" ? r : JSON.stringify(r)).join("\n") + "\n"); }
function run(cwd, args = [], cli = CLI, env = {}) {
  const result = spawnSync(process.execPath, [cli, "report", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: result.status, data: JSON.parse(result.stdout), stdout: result.stdout, stderr: result.stderr };
}
function report(cwd, args = [], cli = CLI) { const out = run(cwd, args, cli); assert.equal(out.code, 0, out.stdout + out.stderr); return out.data; }

test("manual report with no files yields no-data and unknown totals, never zero", t => {
  const dir = root(t), result = report(dir);
  assert.equal(result.status, "no-data"); assert.deepEqual(result.totals, NULL_TOTALS);
  assert.equal(result.coverage.records, 0); assert.equal(result.coverage.input_files, 0);
});

test("cumulative streams use latest snapshot only and identical duplicates are idempotent", t => {
  const dir = root(t), file = path.join(dir, ".harness/.local/usage.jsonl");
  const newer = normalized("private-stream", "codex", { captured_at: "2026-11-12T10:00:00Z", totals: totals(30, 0.3) });
  jsonl(file, [newer, normalized(), newer]);
  const result = report(dir);
  assert.equal(result.status, "ok"); assert.equal(result.totals.input_tokens, 30); assert.equal(result.totals.cost_usd, 0.3);
  assert.equal(result.coverage.normalized_streams, 1); assert.equal(result.groups.length, 1);
});

test("independent mixed-runtime streams include Pi without a native decoder", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, ["claude-code", "codex", "opencode", "pi"].map(runtime => normalized("same-opaque-id", runtime)));
  const result = report(dir, ["--input", file]);
  assert.equal(result.totals.input_tokens, 40); assert.equal(result.groups.length, 4);
  assert.deepEqual(result.provenance.runtimes, ["claude-code", "codex", "opencode", "pi"]);
  assert.ok(result.limitations.includes("producer-asserted-stream-independence"));
});

test("unknown token buckets and cost stay unknown without invented zero or pricing", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized("a"), normalized("b", "codex", { totals: { ...totals(), cache_read_tokens: null, cost_usd: null } })]);
  const result = report(dir, ["--input", file]);
  assert.equal(result.status, "partial"); assert.equal(result.totals.input_tokens, 20);
  assert.equal(result.totals.cache_read_tokens, null); assert.equal(result.totals.cost_usd, null);
  assert.equal(result.coverage.metrics.cache_read_tokens, "unknown");
});

test("genuine measured zero remains distinct from missing data", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized("a", "pi", { totals: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0 } })]);
  const result = report(dir, ["--input", file]);
  assert.equal(result.status, "ok"); assert.equal(result.totals.cost_usd, 0); assert.equal(result.totals.input_tokens, 0);
});

for (const [name, records] of [
  ["known counter regression", [normalized(), normalized("private-stream", "codex", { captured_at: "2026-11-12T10:00:00Z", totals: totals(9) })]],
  ["conflicting equal-time snapshots", [normalized(), normalized("private-stream", "codex", { totals: totals(11) })]],
  ["cost regression", [normalized(), normalized("private-stream", "codex", { captured_at: "2026-11-12T10:00:00Z", totals: totals(11, 0.01) })]],
]) test(`${name} refuses a green total`, t => {
  const dir = root(t), file = path.join(dir, "private-export.jsonl"); jsonl(file, records);
  const out = run(dir, ["--input", file]);
  assert.equal(out.code, 1); assert.equal(out.data.status, "invalid"); assert.deepEqual(out.data.totals, NULL_TOTALS);
  assert.doesNotMatch(out.stdout, /private-export|private-stream|private-project/);
});

test("missing latest counter does not inherit stale earlier coverage", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized(), normalized("private-stream", "codex", { captured_at: "2026-11-12T10:00:00Z", totals: { ...totals(20), output_tokens: null } })]);
  assert.equal(report(dir, ["--input", file]).totals.output_tokens, null);
});

test("a model change in a cumulative stream does not attribute earlier usage to the latest model", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized(), normalized("private-stream", "codex", { model: "model-b", captured_at: "2026-11-12T10:00:00Z", totals: totals(20) })]);
  const result = report(dir, ["--input", file]);
  assert.equal(result.groups[0].model, "unknown"); assert.equal(result.totals.input_tokens, 20);
  assert.ok(result.limitations.includes("model-attribution-unknown"));
});

test("same legacy project/runtime/window is deduplicated across task captures", t => {
  const dir = root(t), file = path.join(dir, "skills-meta/cost.jsonl");
  jsonl(file, [legacy("private-task-a"), legacy("private-task-b", undefined, undefined, { captured_at: "2026-11-12T11:00:00Z" })]);
  const result = report(dir);
  assert.equal(result.totals.input_tokens, 100); assert.equal(result.coverage.legacy_windows, 1);
  assert.equal(result.groups[0].source, "ccusage"); assert.equal(result.groups[0].coverage.attribution, "approximate");
  assert.ok(result.limitations.includes("legacy-time-window-attribution-approximate"));
});

test("overlapping legacy windows across tasks are never blindly summed", t => {
  const dir = root(t), file = path.join(dir, "skills-meta/cost.jsonl");
  jsonl(file, [legacy("a"), legacy("b", "2026-11-12T08:30:00Z", "2026-11-12T09:30:00Z")]);
  const result = report(dir);
  assert.equal(result.status, "partial"); assert.deepEqual(result.totals, NULL_TOTALS);
  assert.ok(result.limitations.includes("legacy-window-overlap"));
});

test("disjoint bounded legacy windows preserve the existing approximate baseline", t => {
  const dir = root(t), file = path.join(dir, "skills-meta/cost.jsonl");
  jsonl(file, [legacy("a"), legacy("b", "2026-11-12T11:00:00Z", "2026-11-12T12:00:00Z")]);
  const result = report(dir); assert.equal(result.totals.input_tokens, 200); assert.equal(result.totals.cost_usd, 2);
});

test("unknown legacy window bounds produce unknown aggregate coverage", t => {
  const dir = root(t), file = path.join(dir, "skills-meta/cost.jsonl");
  jsonl(file, [legacy("a", null, "2026-11-12T09:00:00Z", { join_method: "time-window-ledger-partial" })]);
  const result = report(dir); assert.deepEqual(result.totals, NULL_TOTALS);
  assert.ok(result.limitations.includes("legacy-window-bounds-unknown"));
});

test("legacy and normalized observations remain separate when overlap cannot be excluded", t => {
  const dir = root(t);
  jsonl(path.join(dir, "skills-meta/cost.jsonl"), [legacy()]);
  jsonl(path.join(dir, ".harness/.local/usage.jsonl"), [normalized()]);
  const result = report(dir); assert.deepEqual(result.totals, NULL_TOTALS); assert.equal(result.groups.length, 2);
  assert.ok(result.limitations.includes("mixed-format-coverage-unproven"));
});

test("different provenance for one runtime is not proof of independent coverage", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized("a"), normalized("a", "codex", { source: "agent-reported" })]);
  const result = report(dir, ["--input", file]); assert.deepEqual(result.totals, NULL_TOTALS);
  assert.ok(result.limitations.includes("cross-source-coverage-unproven")); assert.equal(result.groups.length, 2);
});

test("cross-runtime aggregate overlapping a named runtime cannot be added", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized("a", "cross-runtime"), normalized("a", "codex")]);
  const result = report(dir, ["--input", file]); assert.deepEqual(result.totals, NULL_TOTALS);
  assert.ok(result.limitations.includes("runtime-coverage-unproven"));
});

test("explicit project roots aggregate independently without exposing their names", t => {
  const dir = root(t), first = path.join(dir, "PRIVATE_FIRST_PROJECT"), second = path.join(dir, "PRIVATE_SECOND_PROJECT");
  jsonl(path.join(first, ".harness/.local/usage.jsonl"), [normalized("same")]);
  jsonl(path.join(second, ".harness/.local/usage.jsonl"), [normalized("same")]);
  const out = run(dir, ["--project", first, "--project", second]);
  assert.equal(out.code, 0); assert.equal(out.data.totals.input_tokens, 20); assert.equal(out.data.coverage.projects, 2);
  assert.doesNotMatch(out.stdout, /PRIVATE_|private-project|same/);
});

test("repeated explicit inputs and canonical file aliases never double count", t => {
  const dir = root(t), file = path.join(dir, ".harness/.local/usage.jsonl"), alias = path.join(dir, "alias.jsonl");
  jsonl(file, [normalized()]); fs.symlinkSync(file, alias);
  const result = report(dir, ["--input", file, "--input", alias]);
  assert.equal(result.totals.input_tokens, 10); assert.equal(result.coverage.input_files, 1);
});

test("privacy whitelist drops identifiers and maps unsafe model/category values to unknown", t => {
  const dir = root(t), file = path.join(dir, "PRIVATE_INPUT_PATH.jsonl");
  jsonl(file, [normalized("SECRET_STREAM", "private-runtime / secret", { model: "/private/path with prompts and secret", source: "runtime-observed" })]);
  const out = run(dir, ["--input", file]); assert.equal(out.code, 0);
  assert.equal(out.data.groups[0].runtime, "unknown"); assert.equal(out.data.groups[0].model, "unknown");
  assert.doesNotMatch(out.stdout, /SECRET_|PRIVATE_|private-runtime|private\/path|prompts|private-project/);
});

for (const [name, records] of [
  ["malformed JSON", ["{bad-private-secret"]],
  ["unexpected raw prompt field", [{ ...normalized(), prompt: "PRIVATE_PROMPT" }]],
  ["negative counters", [normalized("a", "pi", { totals: totals(-1) })]],
  ["missing bucket", [normalized("a", "pi", { totals: { input_tokens: 1, cost_usd: null } })]],
  ["invalid timestamp", [normalized("a", "pi", { captured_at: "2026-02-30T09:00:00Z" })]],
]) test(`explicit ${name} is invalid without echoing raw input`, t => {
  const dir = root(t), file = path.join(dir, "PRIVATE_FILE.jsonl"); jsonl(file, records);
  const out = run(dir, ["--input", file]);
  assert.equal(out.code, 1); assert.equal(out.data.status, "invalid"); assert.deepEqual(out.data.totals, NULL_TOTALS);
  assert.doesNotMatch(out.stdout + out.stderr, /PRIVATE_|private-secret|private-project/);
});

test("a missing explicit file is invalid, missing defaults are ordinary no-data", t => {
  const dir = root(t), out = run(dir, ["--input", path.join(dir, "PRIVATE_MISSING.jsonl")]);
  assert.equal(out.code, 1); assert.equal(out.data.status, "invalid"); assert.doesNotMatch(out.stdout, /PRIVATE_MISSING/);
});

test("report is read-only and never scans HOME or native transcripts", t => {
  const dir = root(t), home = path.join(dir, "private-home"), file = path.join(dir, ".harness/.local/usage.jsonl");
  jsonl(file, [normalized("a", "pi")]);
  jsonl(path.join(home, ".claude/projects/secret/transcript.jsonl"), ["PRIVATE_INVALID_TRANSCRIPT"]);
  const before = fs.readFileSync(file), mtime = fs.statSync(file).mtimeMs;
  const out = run(dir, [], CLI, { HOME: home });
  assert.equal(out.code, 0); assert.equal(out.data.totals.input_tokens, 10);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["usage.jsonl"]);
  assert.equal(fs.existsSync(path.join(dir, "skills-meta")), false);
});

test("installed standalone CJS works inside an ESM project without repository dependencies", t => {
  const dir = root(t), cli = path.join(dir, "roster-usage.cjs");
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}'); fs.copyFileSync(CLI, cli);
  jsonl(path.join(dir, ".harness/.local/usage.jsonl"), [normalized("a", "pi")]);
  assert.equal(report(dir, [], cli).totals.input_tokens, 10);
});

test("touching legacy bounds stay conservatively overlapping", t => {
  const dir = root(t), file = path.join(dir, "skills-meta/cost.jsonl");
  jsonl(file, [legacy("a"), legacy("b", "2026-11-12T09:00:00Z", "2026-11-12T10:00:00Z")]);
  assert.deepEqual(report(dir).totals, NULL_TOTALS);
});

test("unknown latest measurements do not hide an earlier known regression", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized(), normalized("private-stream", "codex", { captured_at: "2026-11-12T10:00:00Z", totals: { ...totals(), input_tokens: null } }), normalized("private-stream", "codex", { captured_at: "2026-11-12T11:00:00Z", totals: totals(9) })]);
  assert.equal(run(dir, ["--input", file]).data.status, "invalid");
});

test("unsafe numeric aggregate becomes unknown rather than an imprecise token count", t => {
  const dir = root(t), file = path.join(dir, "export.jsonl");
  jsonl(file, [normalized("a", "pi", { totals: totals(Number.MAX_SAFE_INTEGER) }), normalized("b", "pi", { totals: totals(1) })]);
  const result = report(dir, ["--input", file]); assert.equal(result.totals.input_tokens, null);
  assert.ok(result.limitations.includes("numeric-aggregate-overflow"));
});

test("malformed present default is invalid instead of silently absent", t => {
  const dir = root(t); jsonl(path.join(dir, "skills-meta/cost.jsonl"), ["PRIVATE_BAD_DEFAULT"]);
  const out = run(dir); assert.equal(out.code, 1); assert.equal(out.data.status, "invalid");
  assert.doesNotMatch(out.stdout + out.stderr, /PRIVATE_BAD_DEFAULT|private-project/);
});

test("manual inputs outside several selected projects require an unambiguous project", t => {
  const dir = root(t), first = path.join(dir, "PRIVATE_A"), second = path.join(dir, "PRIVATE_B"), file = path.join(dir, "PRIVATE_EXPORT.jsonl");
  fs.mkdirSync(first); fs.mkdirSync(second); jsonl(file, [normalized()]);
  const out = run(dir, ["--project", first, "--project", second, "--input", file]);
  assert.equal(out.code, 1); assert.equal(out.data.status, "invalid"); assert.doesNotMatch(out.stdout, /PRIVATE_/);
});

test("invalid CLI arguments produce only generic aggregate diagnostics", t => {
  const dir = root(t), out = run(dir, ["--PRIVATE_SECRET_OPTION", "PRIVATE_VALUE"]);
  assert.equal(out.code, 1); assert.equal(out.data.status, "invalid");
  assert.doesNotMatch(out.stdout + out.stderr, /PRIVATE_/);
});
