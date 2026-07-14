// scripts/review-bundle.test.js — node:test, CommonJS.
// Unit tests for the review-bundle generator (scripts/review-bundle-manifest.js) and the
// data-driven CI check functions (scripts/lib/bundle/review-bundle-check.js). Runs in the npm test
// chain (CHECK-1) — the heavy scratch install/upgrade/removal integration test lives in
// scripts/review-bundle-install.test.js, run standalone (F-10), NOT here.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildManifest, computeBundlePaths, sha256 } = require("./review-bundle-manifest");
const {
  checkFilesPresentAndSha,
  checkClosureEscape,
  checkForcedBump,
  resolveBaselineRef,
} = require("./lib/bundle/review-bundle-check");

const ROOT = path.resolve(__dirname, "..");

// ── Generator: closure shape (FR-124) ───────────────────────────────────────

test("generator: closure has 14 code files, portable verifier, consumer doc, and schema fixtures", () => {
  const manifest = buildManifest(null);
  assert.equal(manifest.files.length, 18);
  const wrapper = manifest.files.find((f) => f.path === "scripts/xruntime-exec.sh");
  assert.ok(wrapper, "wrapper must be in the closure");
  assert.equal(wrapper.shared, true);
  const doc = manifest.files.find((f) => f.path === "scripts/REVIEW-BUNDLE.md");
  assert.ok(doc, "the consumer doc must be in the manifest");
  assert.equal(doc.kind, "doc");
  const verifier = manifest.files.find((f) => f.path === "scripts/review-bundle-verify.js");
  assert.ok(verifier, "the portable consumer verifier must be in the manifest");
  assert.equal(verifier.kind, "verifier");
  const fixtures = manifest.files.filter((f) => f.kind === "fixture");
  assert.equal(fixtures.length, 2);
  assert.ok(fixtures.some((f) => f.path.includes("/valid/")));
  assert.ok(fixtures.some((f) => f.path.includes("/invalid/")));
  assert.ok(!manifest.files.some((f) => f.path === "scripts/review-bundle.manifest.json"), "manifest must never self-list");
  assert.equal(manifest.schema_version, "1.0");
  assert.equal(manifest.bundle_version, "1.0.0"); // default when no existing manifest supplied
});

test("generator: preserves bundle_version/channel/source_ref from an existing manifest", () => {
  const existing = { bundle_version: "1.2.0", channel: "beta", source_ref: "next" };
  const manifest = buildManifest(existing);
  assert.equal(manifest.bundle_version, "1.2.0");
  assert.equal(manifest.channel, "beta");
  assert.equal(manifest.source_ref, "next");
});

test("generator: computeBundlePaths is deterministic (sorted, stable across calls)", () => {
  const first = computeBundlePaths();
  const second = computeBundlePaths();
  assert.deepEqual(first, second);
  assert.deepEqual(first, [...first].sort());
});

// ── FR-126: disk-vs-manifest sha drift ──────────────────────────────────────

test("checkFilesPresentAndSha: clean tree produces no errors", () => {
  const manifest = buildManifest(null);
  assert.deepEqual(checkFilesPresentAndSha(ROOT, manifest), []);
});

test("checkFilesPresentAndSha: flags a sha mismatch with the bundle-sha-drift tag", () => {
  const manifest = buildManifest(null);
  const mutated = JSON.parse(JSON.stringify(manifest));
  mutated.files[0].sha256 = "0".repeat(64);
  const errors = checkFilesPresentAndSha(ROOT, mutated);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^bundle-sha-drift:/);
});

test("checkFilesPresentAndSha: flags a missing file with the bundle-sha-drift tag", () => {
  const manifest = buildManifest(null);
  const mutated = JSON.parse(JSON.stringify(manifest));
  mutated.files.push({ path: "scripts/does-not-exist.js", sha256: "0".repeat(64) });
  const errors = checkFilesPresentAndSha(ROOT, mutated);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^bundle-sha-drift:.*missing on disk/);
});

// ── FR-127: closure escape (the "15th file" case) ───────────────────────────

test("checkClosureEscape: clean manifest has no escape", () => {
  const manifest = buildManifest(null);
  assert.deepEqual(checkClosureEscape(ROOT, manifest), []);
});

test("checkClosureEscape: a require()'d file missing from the manifest is caught (review-lifecycle.js proof)", () => {
  const manifest = buildManifest(null);
  const trimmed = JSON.parse(JSON.stringify(manifest));
  trimmed.files = trimmed.files.filter((f) => f.path !== "scripts/lib/review/review-lifecycle.js");
  const errors = checkClosureEscape(ROOT, trimmed);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^bundle-closure-escape:.*review-lifecycle\.js/);
});

test("checkClosureEscape: fixture-driven — a fake tool requiring an unlisted lib is caught", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-bundle-fixture-"));
  try {
    fs.writeFileSync(path.join(dir, "tool.js"), 'require("./unlisted");\n');
    fs.writeFileSync(path.join(dir, "unlisted.js"), "module.exports = {};\n");
    const manifest = { files: [{ path: "tool.js", sha256: sha256(path.join(dir, "tool.js")) }] };
    const errors = checkClosureEscape(dir, manifest, ["tool.js"]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^bundle-closure-escape: unlisted\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── FR-128/F-2: forced bump ──────────────────────────────────────────────────

test("checkForcedBump: no baseline (introducing commit) is tolerated", () => {
  const current = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "x" }] };
  assert.deepEqual(checkForcedBump(current, null), []);
});

test("checkForcedBump: sha changed, version bumped — clean", () => {
  const baseline = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "old" }] };
  const current = { bundle_version: "1.0.1", files: [{ path: "a", sha256: "new" }] };
  assert.deepEqual(checkForcedBump(current, baseline), []);
});

test("checkForcedBump: sha changed, version NOT bumped — flagged", () => {
  const baseline = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "old" }] };
  const current = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "new" }] };
  const errors = checkForcedBump(current, baseline);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^bundle-forced-bump:/);
});

test("checkForcedBump: file added or removed without a bump is flagged", () => {
  const baseline = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "x" }] };
  const currentAdded = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "x" }, { path: "b", sha256: "y" }] };
  assert.equal(checkForcedBump(currentAdded, baseline).length, 1);
  const currentRemoved = { bundle_version: "1.0.0", files: [] };
  assert.equal(checkForcedBump(currentRemoved, baseline).length, 1);
});

test("checkForcedBump: unchanged content never flags regardless of version", () => {
  const baseline = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "x" }] };
  const current = { bundle_version: "1.0.0", files: [{ path: "a", sha256: "x" }] };
  assert.deepEqual(checkForcedBump(current, baseline), []);
});

// ── F-2: baseline resolution (injected `run`, no real git calls) ───────────

test("resolveBaselineRef: shallow/unresolvable clone skips loudly (no candidate resolves)", () => {
  const run = () => null;
  const result = resolveBaselineRef(ROOT, run);
  assert.equal(result.shallow, true);
  assert.equal(result.sha, null);
});

test("resolveBaselineRef: falls back through origin/main -> main -> HEAD~1", () => {
  const run = (_root, args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") return "headsha";
    if (args.join(" ") === "rev-parse --verify --quiet origin/main^{commit}") return null;
    if (args.join(" ") === "rev-parse --verify --quiet main^{commit}") return "mainsha";
    if (args.join(" ") === "merge-base main HEAD") return "basesha";
    return null;
  };
  const result = resolveBaselineRef(ROOT, run);
  assert.equal(result.shallow, false);
  assert.equal(result.sha, "basesha");
});

test("resolveBaselineRef: a candidate whose merge-base equals HEAD is skipped (nothing to diff)", () => {
  const run = (_root, args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") return "headsha";
    if (args.join(" ") === "rev-parse --verify --quiet origin/main^{commit}") return "originsha";
    if (args.join(" ") === "merge-base origin/main HEAD") return "headsha"; // == HEAD, skip
    if (args.join(" ") === "rev-parse --verify --quiet main^{commit}") return null;
    if (args.join(" ") === "rev-parse --verify --quiet HEAD~1^{commit}") return "parentsha";
    if (args[0] === "rev-parse" && args[1] === "HEAD~1") return "parentsha";
    return null;
  };
  const result = resolveBaselineRef(ROOT, run);
  assert.equal(result.sha, "parentsha");
});

// ── F-9: filter-pinning — each check's tag prefix is independent ───────────
// Pins the ✓/✗ independence contract that replaced the substring-filter bug (the message
// originally at check-pipeline-install.js's line 247 escaped a plain `.includes()` filter).
// Every check here must be gate-able by `errors.some(e => e.startsWith(tag))` alone, and one
// check's errors must never satisfy another check's tag test.

test("F-9: bundle check tags never cross-match each other's startsWith gate", () => {
  const shaErr = "bundle-sha-drift: x sha256 on disk does not match";
  const escapeErr = "bundle-closure-escape: y is required but not listed";
  const bumpErr = "bundle-forced-bump: z changed without a bump";
  const gateErr = "gate-script: scripts/foo.js not found — cannot verify it references scripts/bar.js";
  const all = [shaErr, escapeErr, bumpErr, gateErr];
  const tags = ["bundle-sha-drift:", "bundle-closure-escape:", "bundle-forced-bump:", "gate-script:"];
  for (const tag of tags) {
    const matching = all.filter((e) => e.startsWith(tag));
    assert.equal(matching.length, 1, `tag ${tag} must match exactly its own message`);
  }
});

test("F-9: the historical escape (a message with neither known substring) is now caught by tag, not lost", () => {
  // Reproduces the exact escaping message shape from the pre-fix code (no "pipeline gate
  // script" substring, no "no longer references" substring) — it must still gate correctly
  // once tagged.
  const escapingMessage = "gate-script: skills/pipeline/roster-run.md not found — cannot verify it references scripts/check-review-convergence.js";
  assert.equal(escapingMessage.includes("pipeline gate script"), false);
  assert.equal(escapingMessage.includes("no longer references"), false);
  assert.equal([escapingMessage].some((e) => e.startsWith("gate-script:")), true);
});
