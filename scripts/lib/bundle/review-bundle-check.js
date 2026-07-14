// scripts/lib/review-bundle-check.js — CommonJS, zero-dep.
//
// Pure, fixture-testable check functions backing the review-bundle CI gate (FR-125..128):
//   - checkFilesPresentAndSha   FR-126: disk sha must match the manifest's declared sha.
//   - checkClosureEscape        FR-127: no require() edge may reach a file outside the manifest.
//   - checkForcedBump           FR-128/F-2: sha changed since baseline → bundle_version must bump.
//   - resolveBaselineRef        F-2: git merge-base origin/main→main→HEAD~1 baseline resolution,
//                                mirroring check-leak-diff.sh; shallow/unresolvable → loud warn.
//
// Every function takes plain data (manifest objects, a root dir, an injectable `run` for git
// calls) so scripts/review-bundle.test.js can pin each check's ✓/✗ independently on fixtures
// without shelling out to real git — the F-9 filter-pinning requirement.

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { computeClosure } = require("./review-bundle-closure");
const { sha256 } = require("../../review-bundle-manifest");

const JS_TOOL_ENTRIES = [
  "scripts/xruntime-review.js",
  "scripts/review-normalize.js",
  "scripts/check-review-convergence.js",
];

/** FR-126: every manifest file must exist on disk with a matching sha256. */
function checkFilesPresentAndSha(root, manifest) {
  const errors = [];
  for (const f of manifest.files) {
    const abs = path.resolve(root, f.path);
    if (!fs.existsSync(abs)) {
      errors.push(`bundle-sha-drift: ${f.path} is listed in the manifest but missing on disk`);
      continue;
    }
    const actual = sha256(abs);
    if (actual !== f.sha256) {
      errors.push(`bundle-sha-drift: ${f.path} sha256 on disk (${actual}) does not match the manifest (${f.sha256})`);
    }
  }
  return errors;
}

/** FR-127: the require graph from the tool entries must not reach a file outside the manifest.
 *  FIX-4: compares against CODE manifest entries only — a `kind: "doc"` entry (the consumer-
 *  facing scripts/REVIEW-BUNDLE.md) is never reachable via require() and is exempt from this
 *  equality; it is still sha-verified/installed/removed like any other file elsewhere. */
function checkClosureEscape(root, manifest, toolEntries) {
  const entries = (toolEntries || JS_TOOL_ENTRIES).map((p) => path.resolve(root, p));
  const closure = computeClosure(entries);
  const codeFiles = manifest.files.filter((f) => f.kind !== "doc");
  const manifestSet = new Set(codeFiles.map((f) => path.resolve(root, f.path)));
  const escaped = [...closure]
    .filter((abs) => !manifestSet.has(abs))
    .map((abs) => path.relative(root, abs));
  return escaped.map(
    (rel) => `bundle-closure-escape: ${rel} is required by a bundle tool but is not listed in the manifest`
  );
}

/** FR-128/F-2: sha-changed-without-bump, given the current and baseline manifest (or null). */
function checkForcedBump(current, baseline) {
  if (!baseline) return []; // absent at baseline is tolerated (introducing commit)
  const baseShas = new Map(baseline.files.map((f) => [f.path, f.sha256]));
  const curPaths = new Set(current.files.map((f) => f.path));
  let changed = false;
  for (const f of current.files) {
    if (!baseShas.has(f.path) || baseShas.get(f.path) !== f.sha256) changed = true;
  }
  for (const p of baseShas.keys()) if (!curPaths.has(p)) changed = true;
  if (changed && current.bundle_version === baseline.bundle_version) {
    return [
      `bundle-forced-bump: bundle content changed since the baseline but bundle_version was not bumped (still ${current.bundle_version})`,
    ];
  }
  return [];
}

function defaultRun(root, args) {
  try {
    // stderr is deliberately swallowed: a failing `git show <ref>:<path>` (file absent at that
    // ref — the tolerated "introducing commit" case) or an unresolvable rev is an EXPECTED
    // outcome here, not a real problem worth printing.
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function refResolves(root, ref, run) {
  return run(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

/** F-2: origin/main → main → HEAD~1, mirroring check-leak-diff.sh; skip a candidate equal to HEAD. */
function resolveBaselineRef(root, run) {
  run = run || defaultRun;
  const headSha = run(root, ["rev-parse", "HEAD"]);
  for (const candidate of ["origin/main", "main"]) {
    if (!refResolves(root, candidate, run)) continue;
    const mergeBase = run(root, ["merge-base", candidate, "HEAD"]);
    if (!mergeBase || mergeBase === headSha) continue;
    return { sha: mergeBase, shallow: false };
  }
  if (refResolves(root, "HEAD~1", run)) {
    const sha = run(root, ["rev-parse", "HEAD~1"]);
    if (sha && sha !== headSha) return { sha, shallow: false };
  }
  return { sha: null, shallow: true };
}

/** Read scripts/review-bundle.manifest.json as it existed at `ref`, or null if absent there. */
function readManifestAtRef(root, ref, manifestRelPath, run) {
  run = run || defaultRun;
  const text = run(root, ["show", `${ref}:${manifestRelPath}`]);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = {
  checkFilesPresentAndSha,
  checkClosureEscape,
  checkForcedBump,
  resolveBaselineRef,
  readManifestAtRef,
  JS_TOOL_ENTRIES,
};
