// scripts/review-bundle-install.test.js — node:test, CommonJS.
//
// The scratch consumer-install integration test (US-3, CHECK-2). Runs the REAL
// scripts/review-bundle-install.sh end to end in throwaway directories created OUTSIDE the
// repo (FR-146) — install, upgrade, remove, partial-fetch, collision/--force, shared-wrapper
// survival, modified/missing-file warnings, and a closure smoke + functional tier proving the
// distributed tools actually run once installed.
//
// F-10: this file is deliberately NOT part of the `npm test` chain (test-install.sh precedent)
// — it is heavier (spawns curl/file:// fetches and real tool invocations). Run standalone via
// `npm run test:review-bundle`, or the dedicated ci.yml step.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const INSTALLER = path.resolve(__dirname, "review-bundle-install.sh");
const MANIFEST_REL = "scripts/review-bundle.manifest.json";

function mkScratch(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `review-bundle-${prefix}-`));
}

// spawnSync (not execFileSync) — it returns stdout/stderr regardless of exit code, which
// execFileSync only does on failure (on success it returns bare stdout, discarding stderr).
// Several assertions below need the WARN lines a successful (exit 0) run still prints.
function run(args, opts = {}) {
  const r = spawnSync("bash", [INSTALLER, ...args], { encoding: "utf8", ...opts });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function readManifest(target) {
  return JSON.parse(fs.readFileSync(path.join(target, MANIFEST_REL), "utf8"));
}

// Mirrors bounty-skills' tracked-file personal-handle policy. The exact public upstream
// repository identifier is allowed; any suffix (for example a branch embedded in a raw URL)
// turns the token into a consumer-visible personal handle and must fail the installed bundle.
function trackedPersonalHandleLeaks(target) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: target })
    .toString()
    .split("\0")
    .filter(Boolean);
  const leaks = [];
  for (const rel of tracked) {
    const lines = fs.readFileSync(path.join(target, rel), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const token of line.match(/mathiasbourgoin[A-Za-z0-9._/-]*/g) || []) {
        if (token !== "mathiasbourgoin/roster") leaks.push(`${rel}:${index + 1}:${token}`);
      }
    });
  }
  return leaks;
}

/** Scan a tree for any *.bak file — the F-8 no-.bak tripwire, scoped to the installer's own
 *  behavior (install.sh's separate .bak idiom is explicitly out of scope, F-8). */
function findBakFiles(root) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".bak")) hits.push(p);
    }
  };
  walk(root);
  return hits;
}

// ── Closure smoke tier (FR-148): each JS tool entry loads cleanly ──────────

test("closure smoke: each JS tool entry require()s without throwing", () => {
  for (const rel of [
    "scripts/xruntime-review.js",
    "scripts/review-normalize.js",
    "scripts/check-review-convergence.js",
    "scripts/review-bundle-verify.js",
  ]) {
    assert.doesNotThrow(() => require(path.resolve(REPO_ROOT, rel)));
  }
});

// ── AC-01: staged install happy path (--from-checkout) ─────────────────────

test("install --from-checkout: all 18 files land, shas match, manifest committed-shaped", () => {
  const target = mkScratch("install");
  const r = run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  assert.equal(r.code, 0, r.stderr);
  const manifest = readManifest(target);
  assert.equal(manifest.files.length, 18);
  for (const f of manifest.files) {
    assert.ok(fs.existsSync(path.join(target, f.path)), `${f.path} missing after install`);
  }
  assert.equal(findBakFiles(target).length, 0, "no .bak files after install (F-8)");
});

test("installed consumer verifies locally without owning the lifecycle installer", () => {
  const target = mkScratch("portable-verify");
  const installed = run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(fs.existsSync(path.join(target, "scripts/review-bundle-install.sh")), false);

  const verifier = path.join(target, "scripts/review-bundle-verify.js");
  assert.equal(fs.existsSync(verifier), true, "portable verifier must be installed in the consumer");
  const clean = spawnSync("node", [verifier], { cwd: target, encoding: "utf8" });
  assert.equal(clean.status, 0, clean.stderr);

  fs.appendFileSync(path.join(target, "scripts/review-normalize.js"), "\n// consumer drift\n");
  const drifted = spawnSync("node", [verifier], { cwd: target, encoding: "utf8" });
  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /SHA MISMATCH scripts\/review-normalize\.js/);

  const runbook = fs.readFileSync(path.join(target, "scripts/REVIEW-BUNDLE.md"), "utf8");
  const reviewSkill = fs.readFileSync(path.join(REPO_ROOT, "skills/pipeline/roster-review.md"), "utf8");
  for (const consumerInstruction of [runbook, reviewSkill]) {
    assert.match(consumerInstruction, /node scripts\/review-bundle-verify\.js/);
    assert.doesNotMatch(consumerInstruction, /bash scripts\/review-bundle-install\.sh verify/);
  }
});

test("verify: happy path after install", () => {
  const target = mkScratch("verify-ok");
  run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  const r = run(["verify", "--target", target]);
  assert.equal(r.code, 0, r.stderr);
});

test("installed tracked bundle satisfies the consumer personal-handle leak gate", () => {
  const target = mkScratch("tracked-leak-gate");
  const installed = run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  assert.equal(installed.code, 0, installed.stderr);
  gitRepo(target);
  execFileSync("git", ["add", "-A"], { cwd: target });
  assert.deepEqual(trackedPersonalHandleLeaks(target), []);
});

test("verify: a deleted bundle file yields a non-zero exit with a runbook", () => {
  const target = mkScratch("verify-missing");
  run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  fs.unlinkSync(path.join(target, "scripts/xruntime-review.js"));
  const r = run(["verify", "--target", target]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /MISSING scripts\/xruntime-review\.js/);
  assert.match(r.stderr, /review-bundle-install\.sh install/); // runbook text
});

// ── AC-01 via --from-raw (file:// mock, FR-146) ─────────────────────────────

test("install --from-raw (file:// mock RAW): mirrors --from-checkout", () => {
  const mockRoot = mkScratch("rawsrc");
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_REL), "utf8"));
  fs.mkdirSync(path.join(mockRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(mockRoot, MANIFEST_REL), JSON.stringify(manifest));
  for (const f of manifest.files) {
    const dest = path.join(mockRoot, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f.path), dest);
  }
  const target = mkScratch("rawdst");
  const r = run(["install", "--from-raw", `file://${mockRoot}`, "--target", target]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readManifest(target).files.length, 18);
});

test("partial fetch: a source missing one bundle file aborts, target untouched, staging-only residue (FR-131/153)", () => {
  const mockRoot = mkScratch("rawsrc-partial");
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_REL), "utf8"));
  fs.mkdirSync(path.join(mockRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(mockRoot, MANIFEST_REL), JSON.stringify(manifest));
  for (const f of manifest.files) {
    if (f.path === "scripts/check-scope-diff.sh") continue; // simulate one missing fetch
    const dest = path.join(mockRoot, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f.path), dest);
  }
  const target = mkScratch("rawdst-partial");
  const r = run(["install", "--from-raw", `file://${mockRoot}`, "--target", target]);
  assert.notEqual(r.code, 0);
  assert.equal(fs.existsSync(path.join(target, MANIFEST_REL)), false, "manifest must not be written on partial failure");
  const targetFiles = fs.existsSync(target) ? fs.readdirSync(target) : [];
  assert.deepEqual(targetFiles.filter((f) => f !== ".review-bundle-staging"), [], "target must stay untouched");
  assert.ok(fs.existsSync(path.join(target, ".review-bundle-staging")), "partial residue must remain in staging");
});

// ── AC-05: collision refusal + --force ──────────────────────────────────────

test("collision: a pre-existing unrelated file at a bundle path aborts install; --force overrides; message carries recovery guidance (FIX-2/F-5)", () => {
  const target = mkScratch("collision");
  fs.mkdirSync(path.join(target, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(target, "scripts/check-scope-diff.sh"), "not the bundle file\n");
  const refused = run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  assert.notEqual(refused.code, 0);
  assert.equal(fs.existsSync(path.join(target, MANIFEST_REL)), false);
  assert.match(refused.stderr, /--force/);
  assert.match(refused.stderr, /restore/i);
  const forced = run(["install", "--from-checkout", REPO_ROOT, "--target", target, "--force"]);
  assert.equal(forced.code, 0, forced.stderr);
});

test("verify: a modified shared wrapper reports recovery guidance with --force (F-5/FIX-2)", () => {
  const target = mkScratch("verify-modified-wrapper");
  run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  fs.appendFileSync(path.join(target, "scripts/xruntime-exec.sh"), "\n# consumer edit\n");
  const r = run(["verify", "--target", target]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /SHA MISMATCH scripts\/xruntime-exec\.sh/);
  assert.match(r.stderr, /--force/);
  assert.match(r.stderr, /restore/i);
});

// ── AC-07/AC-08: upgrade orphan cleanup, generated via the REAL generator run twice (FR-147) ─

const GENERATOR = path.resolve(__dirname, "review-bundle-manifest.js");
const ORPHAN_REL = "scripts/lib/orphan-lib.js";

function copyRepoTree(dest) {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_REL), "utf8"));
  for (const f of manifest.files) {
    const target = path.join(dest, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f.path), target);
  }
}

/** FR-147: the upgrade fixture is produced by running the REAL generator twice on mutated
 *  trees, never hand-written. "old" tree = a copy of the current tools, MUTATED so one tool
 *  requires an extra lib (the closure the old version shipped); "new" tree = the same copy
 *  WITHOUT that mutation (the closure the new version ships, one file smaller) — upgrade must
 *  delete the now-orphaned lib. bundle_version is a human act (FR-128), applied after
 *  generation, not invented by the generator. */
function buildUpgradeFixture() {
  const oldSrc = mkScratch("fixture-old-src");
  copyRepoTree(oldSrc);
  fs.writeFileSync(path.join(oldSrc, ORPHAN_REL), "module.exports = {};\n");
  fs.appendFileSync(path.join(oldSrc, "scripts/review-normalize.js"), '\nrequire("./lib/orphan-lib");\n');
  execFileSync("node", [GENERATOR, "--root", oldSrc], { stdio: "pipe" });

  const newSrc = mkScratch("fixture-new-src");
  copyRepoTree(newSrc);
  execFileSync("node", [GENERATOR, "--root", newSrc], { stdio: "pipe" });
  const newManifest = readManifest(newSrc);
  newManifest.bundle_version = "1.0.1"; // closure shrank vs. old -> forced bump (FR-128)
  fs.writeFileSync(path.join(newSrc, MANIFEST_REL), JSON.stringify(newManifest, null, 2) + "\n");

  return { oldSrc, newSrc, orphanRel: ORPHAN_REL };
}

test("upgrade: deletes the old-manifest-only orphan, keeps shared, bumps version", () => {
  const { oldSrc, newSrc, orphanRel } = buildUpgradeFixture();
  const target = mkScratch("upgrade");
  const installed = run(["install", "--from-checkout", oldSrc, "--target", target]);
  assert.equal(installed.code, 0, installed.stderr);
  assert.ok(fs.existsSync(path.join(target, orphanRel)), "orphan must exist after the old install");

  const upgraded = run(["upgrade", "--from-checkout", newSrc, "--target", target]);
  assert.equal(upgraded.code, 0, upgraded.stderr);
  assert.equal(fs.existsSync(path.join(target, orphanRel)), false, "orphan must be deleted on upgrade");
  assert.ok(fs.existsSync(path.join(target, "scripts/xruntime-exec.sh")), "shared wrapper must survive");
  assert.equal(readManifest(target).bundle_version, "1.0.1");
});

test("upgrade: a consumer-modified orphan is skipped with a warning, not deleted (FR-152)", () => {
  const { oldSrc, newSrc, orphanRel } = buildUpgradeFixture();
  const target = mkScratch("upgrade-modified");
  run(["install", "--from-checkout", oldSrc, "--target", target]);
  fs.writeFileSync(path.join(target, orphanRel), "// consumer edit\nmodule.exports = {};\n");
  const upgraded = run(["upgrade", "--from-checkout", newSrc, "--target", target]);
  assert.equal(upgraded.code, 0, upgraded.stderr);
  assert.ok(fs.existsSync(path.join(target, orphanRel)), "modified orphan must survive upgrade");
  assert.match(upgraded.stdout + (upgraded.stderr || ""), /modified by the consumer/);
});

// ── AC-06/AC-08: removal — shared survives, modified skipped, missing continues ─────────────

test("remove: shared wrapper survives while roster-qa's breaker helper is removed (FR-151)", () => {
  const target = mkScratch("remove-shared");
  run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  const r = run(["remove", "--target", target]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(target, "scripts/xruntime-exec.sh")), "wrapper must survive removal");
  assert.equal(
    fs.existsSync(path.join(target, "scripts/xruntime-review.js")),
    false,
    "QA must detect the removed breaker helper as stale-install"
  );
  assert.equal(fs.existsSync(path.join(target, MANIFEST_REL)), false, "manifest must be deleted");
});

test("remove: a modified file is skipped with a warning; a missing file warns and removal continues (FR-136)", () => {
  const target = mkScratch("remove-mixed");
  run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  fs.writeFileSync(path.join(target, "scripts/review-normalize.js"), "// consumer edit\n");
  fs.unlinkSync(path.join(target, "scripts/check-scope-diff.sh"));
  const r = run(["remove", "--target", target]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(target, "scripts/review-normalize.js")), "modified file must survive removal");
  assert.match(r.stdout + (r.stderr || ""), /modified by the consumer/);
  assert.match(r.stdout + (r.stderr || ""), /already missing, continuing/);
});

// ── Functional tier (FR-149): the distributed tools actually work in the scratch consumer ──

function gitRepo(dir) {
  const opts = { cwd: dir, stdio: "pipe" };
  execFileSync("git", ["init", "-q", "."], opts);
  execFileSync("git", ["config", "user.email", "t@t"], opts);
  execFileSync("git", ["config", "user.name", "t"], opts);
  execFileSync("git", ["config", "commit.gpgsign", "false"], opts);
}

test("functional tier: scope-diff, convergence gate --static, xruntime helper, normalizer all run from the installed copies", () => {
  const target = mkScratch("functional");
  run(["install", "--from-checkout", REPO_ROOT, "--target", target]);
  gitRepo(target);
  fs.writeFileSync(path.join(target, "README.md"), "seed\n");
  const runtimeStub = path.join(target, "stub-runtime.sh");
  fs.writeFileSync(
    runtimeStub,
    `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "consumer-stub 1.0.0"; exit 0; fi
if [ "\${STUB_FAIL_IF_RUN:-0}" = "1" ]; then touch runtime-invoked.marker; exit 9; fi
cat >/dev/null
printf '\`\`\`json\\n[]\\n\`\`\`\\n'
`,
    { mode: 0o755 }
  );
  execFileSync("git", ["add", "-A"], { cwd: target });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: target });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }).trim();

  // scope-diff on a seeded diff: an in-manifest change passes. The manifest itself lives
  // OUTSIDE target — inside it, it would show up as an untracked (hence "changed") file and
  // trip its own scope gate.
  fs.mkdirSync(path.join(target, "src"), { recursive: true });
  fs.writeFileSync(path.join(target, "src/a.txt"), "changed\n");
  const manifestTxt = path.join(mkScratch("scope-manifest"), "scope-manifest.txt");
  fs.writeFileSync(manifestTxt, `base=${base}\n---\nsrc/\n`);
  execFileSync("bash", ["scripts/check-scope-diff.sh", manifestTxt], { cwd: target, encoding: "utf8" });

  // gate --static on a minimal fixture review.json.
  const reviewPath = path.join(target, "review.json");
  fs.writeFileSync(reviewPath, JSON.stringify({ task: "t", status: "NO-GO", findings: [] }));
  execFileSync("node", ["scripts/check-review-convergence.js", "review.json", "--static"], { cwd: target });

  // Authentic installed helper success with an XRUNTIME_BIN stub (mirrors
  // xruntime-exec.sh's real consumer boundary).
  const helperOut = execFileSync(
    "node",
    ["scripts/xruntime-review.js", "codex", "--task", "smoke-test"],
    { cwd: target, encoding: "utf8", input: "probe prompt", env: { ...process.env, XRUNTIME_BIN: runtimeStub } }
  ).toString();
  assert.equal(JSON.parse(helperOut).status, "healthy");

  // Authentic installed QA handoff: a GO review's matching degraded state
  // refuses the second provider call, while a malformed handoff fails closed.
  const { computeDigest } = require(path.join(target, "scripts/lib/xruntime-digest.js"));
  const { digest } = computeDigest("codex", runtimeStub, "read-only");
  fs.mkdirSync(path.join(target, "briefs"), { recursive: true });
  fs.writeFileSync(
    path.join(target, "briefs/smoke-test-review.json"),
    JSON.stringify({ status: "GO", cross_runtime: { codex: { status: "degraded", config_digest: digest } } })
  );
  const availability = execFileSync(
    "node",
    [
      "scripts/xruntime-review.js",
      "codex",
      "--task",
      "smoke-test",
      "--phase",
      "qa",
      "--check-availability",
      "--write",
    ],
    {
      cwd: target,
      encoding: "utf8",
      env: { ...process.env, XRUNTIME_BIN: runtimeStub, STUB_FAIL_IF_RUN: "1" },
    }
  );
  assert.equal(JSON.parse(availability).status, "skipped-degraded");
  assert.equal(fs.existsSync(path.join(target, "runtime-invoked.marker")), false);

  fs.writeFileSync(path.join(target, "briefs/corrupt-review.json"), "{not-json");
  const malformed = spawnSync(
    "node",
    ["scripts/xruntime-review.js", "codex", "--task", "corrupt", "--phase", "qa", "--check-availability", "--write"],
    { cwd: target, encoding: "utf8", env: { ...process.env, XRUNTIME_BIN: runtimeStub } }
  );
  assert.equal(malformed.status, 2);
  assert.equal(JSON.parse(malformed.stdout).status, "blocked");

  // normalizer on fixture findings via stdin.
  const normOut = execFileSync("node", ["scripts/review-normalize.js"], { cwd: target, input: "[]", encoding: "utf8" });
  const parsed = JSON.parse(normOut);
  assert.deepEqual(parsed.findings, []);

  // Installed-consumer schema auto-discovery must remain non-tautological:
  // the bundle-owned review schema arrives with both a passing and a failing
  // fixture, and the installed zero-dependency validator agrees with them.
  const { loadFindingSchema } = require(path.join(target, "scripts/lib/finding-schema.js"));
  const findingValidator = loadFindingSchema();
  const fixtureRoot = path.join(target, "tools/data-schema/fixtures/review-finding");
  const validFinding = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "valid/basic.jsonl"), "utf8"));
  const invalidFinding = JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, "invalid/missing-specialist.jsonl"), "utf8")
  );
  assert.equal(findingValidator.validate(validFinding).valid, true);
  assert.equal(findingValidator.validate(invalidFinding).valid, false);
});

// ── F-8: no-.bak/no-stray tripwire, no allowlist (scoped to the installer itself) ───────────

test("F-8: the installer never creates a .bak file across install/upgrade/remove", () => {
  const { oldSrc, newSrc } = buildUpgradeFixture();
  const target = mkScratch("tripwire");
  run(["install", "--from-checkout", oldSrc, "--target", target]);
  run(["upgrade", "--from-checkout", newSrc, "--target", target]);
  run(["remove", "--target", target]);
  assert.equal(findBakFiles(target).length, 0);
});

// ── FR-137: extension-converge no-clash — bundle paths never appear in extension registry data ─

test("extension converge ignores bundle paths (no clash between the two manifest conventions)", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, MANIFEST_REL), "utf8"));
  const bundlePaths = new Set(manifest.files.map((f) => f.path));
  const extensionsJson = path.resolve(REPO_ROOT, ".harness/extensions.json");
  if (fs.existsSync(extensionsJson)) {
    const text = fs.readFileSync(extensionsJson, "utf8");
    for (const p of bundlePaths) assert.ok(!text.includes(p), `${p} must not appear in .harness/extensions.json`);
  }
});
