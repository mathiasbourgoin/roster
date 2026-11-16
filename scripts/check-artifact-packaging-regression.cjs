#!/usr/bin/env node
"use strict";
// Standalone release-boundary proof: 0 pass, 1 assertion, 2 acquisition/runtime error.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const scannerSha256 = "d16cfcfb0e7aa89e7154c1c3b919468cd394145c9209e1272e33fc69117c2173";
const enforcerSha256 = "99c14e88d560906e0dc96fe1587740f69e5b42de83866f0f7cdde625cb8addfe";
const originalPolicy = [
  "scripts/check-leak.test.js", "package-lock.json",
  "scripts/review-bundle.manifest.json", ".harness/bin/run-hook.js"
];
const generated = ["scripts/vendor/yaml-2.9.1.cjs", ".harness/bin/vendor/yaml-2.9.1.cjs"];
const builder = "scripts/build-artifact-parser.mjs";
class SetupError extends Error {}
function run(cwd, file, args, statuses = [0]) {
  const env = {...process.env};
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  const r = cp.spawnSync(file, args, {cwd, env, encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024});
  if (r.error) throw r.error;
  if (r.signal !== null || !Number.isInteger(r.status) || !statuses.includes(r.status)) {
    throw new SetupError(`${file} ${args.join(" ")}: exit=${r.status} signal=${r.signal}\n${r.stderr}`);
  }
  return r;
}
function acquire() {
  const root = process.env.ROSTER_ARTIFACT_PACKAGING_SOURCE_ROOT || path.resolve(__dirname, "..");
  const files = ["scripts/check-leak.js", "scripts/check-leak-diff.sh", ".check-leak-ignore", ...generated, builder];
  const bytes = {};
  for (const name of files) {
    const file = path.join(root, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new SetupError(`unsafe source ${name}`);
    bytes[name] = fs.readFileSync(file);
    if (!bytes[name].length) throw new SetupError(`empty source ${name}`);
  }
  for (const [name, expected] of [[files[0], scannerSha256], [files[1], enforcerSha256]]) {
    const digest = crypto.createHash("sha256").update(bytes[name]).digest("hex");
    if (digest !== expected) throw new SetupError(`scanner custody mismatch: ${name}`);
  }
  run(root, "git", ["--version"]);
  run(root, "bash", ["--version"]);
  return bytes;
}
function put(root, name, bytes) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, bytes);
}
function commit(root, message) {
  run(root, "git", ["add", "--all"]);
  run(root, "git", ["commit", "--quiet", "-m", message]);
  return run(root, "git", ["rev-parse", "HEAD"]).stdout.trim();
}
function fixture(root, bytes) {
  run(root, "git", ["init", "--quiet"]);
  // Reject an inherited external hook rather than silently disabling it.
  const hook = run(root, "git", ["config", "--get", "core.hooksPath"], [0, 1]);
  if (hook.status === 0 && hook.stdout.trim()) throw new SetupError("fixture inherited external hooksPath");
  run(root, "git", ["config", "user.name", "Artifact packaging check"]);
  run(root, "git", ["config", "user.email", "artifact-check@example.invalid"]);
  for (const name of ["scripts/check-leak.js", "scripts/check-leak-diff.sh", ".check-leak-ignore"]) put(root, name, bytes[name]);
  return commit(root, "scanner baseline");
}
function gate(root, base, paths) {
  const resolved = run(root, "git", ["rev-parse", "--verify", `${base}^{commit}`]).stdout.trim();
  const head = run(root, "git", ["rev-parse", "HEAD"]).stdout.trim();
  if (resolved !== base || head === base) throw new SetupError("fixture has no distinct exact base/head");
  run(root, "git", ["merge-base", "--is-ancestor", base, head]);
  const changed = run(root, "git", ["diff", "--name-only", "--diff-filter=d", `${base}...HEAD`]).stdout.trim().split("\n").filter(Boolean).sort();
  if (JSON.stringify(changed) !== JSON.stringify([...paths].sort())) throw new SetupError("fixture changed paths differ from required nonempty selection");
  const delta = run(root, "git", ["diff", "--unified=0", `${base}...HEAD`, "--", ...paths]).stdout;
  if (!delta.split("\n").some(line => line.startsWith("+") && !line.startsWith("+++"))) throw new SetupError("fixture has no added lines");
  return run(root, "bash", ["scripts/check-leak-diff.sh", base], [0, 1]);
}
function negative(parent, bytes, name, label) {
  const root = path.join(parent, label);
  fs.mkdirSync(root);
  const base = fixture(root, bytes);
  // Assemble the assignment value at runtime: the committed test contains no secret literal.
  const assignment = ["DB", "PASSWORD"].join("_") + "=\"" + "H".repeat(20) + "\"";
  const digest = crypto.createHash("sha256").update("public fixture checksum").digest("hex");
  put(root, name, `const checksum = "${digest}"; ${assignment};\n`);
  commit(root, "nonexempt detector control");
  const result = gate(root, base, [name]);
  assert.equal(result.status, 1, `${label}: actual strict gate must reject nonexempt assignment`);
  assert.match(result.stdout + result.stderr, /HIGH[\s\S]*secret-assignment|secret-assignment[\s\S]*HIGH/, `${label}: detector-specific refusal required`);
}
function check(root, bytes) {
  const legitimate = path.join(root, "legitimate");
  fs.mkdirSync(legitimate);
  const base = fixture(legitimate, bytes);
  for (const name of [...generated, builder]) put(legitimate, name, bytes[name]);
  commit(legitimate, "legitimate generated distribution");
  const result = gate(legitimate, base, [...generated, builder]);
  // This actual gate is deliberately the first behavioral assertion (old source is red).
  assert.equal(result.status, 0, `legitimate real Git-derived packaging gate: ${result.stdout}${result.stderr}`);
  const entries = bytes[".check-leak-ignore"].toString("utf8").split(/\r?\n/).filter(line => !/^\s*(#|$)/.test(line));
  assert.deepEqual([...entries].sort(), [...originalPolicy, ...generated].sort(), "exact six-entry policy multiset: no extra, duplicate, whitespace or glob entry");
  negative(root, bytes, "scripts/nonexempt-control.cjs", "ordinary-negative");
  negative(root, bytes, generated[0] + ".extra", "adjacent-negative");
}
let root;
try {
  const bytes = acquire();
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "artifact-packaging-regression-"));
  check(root, bytes);
  console.log("PASS: actual Git-derived packaging gate, exact policy and nonexempt detector controls");
} catch (error) {
  console.error(error.stack);
  process.exitCode = error instanceof assert.AssertionError ? 1 : 2;
} finally {
  if (root) {
    try { fs.rmSync(root, {recursive: true, force: true}); }
    catch (error) { console.error(error.message); if (process.exitCode !== 1) process.exitCode = 2; }
  }
}
