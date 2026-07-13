#!/usr/bin/env node
// scripts/review-bundle-manifest.js — CommonJS, zero-dep.
//
// Generates scripts/review-bundle.manifest.json from the review-tool closure — FR-125:
// "node generator regenerates from the closure; never hand-maintained." The closure is derived
// from the require graph (scripts/lib/review-bundle-closure.js) starting at the 4 tool entry
// points, plus the wrapper script marked `shared: true` (FR-124). The manifest is the sole
// committed sentinel (FR-129) — no per-runtime version files.
//
// Usage:
//   node scripts/review-bundle-manifest.js          # write/regenerate the manifest
//   node scripts/review-bundle-manifest.js --check  # exit 1 if the committed manifest is stale
//   node scripts/review-bundle-manifest.js --print  # print the computed manifest, write nothing
//   node scripts/review-bundle-manifest.js --root <dir>  # target an arbitrary tree (same repo
//     layout under <dir>) instead of this checkout — lets FR-147's upgrade fixture run this
//     SAME generator twice against mutated fixture trees, rather than hand-writing manifests.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { computeClosure } = require("./lib/review-bundle-closure");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.resolve(ROOT, "scripts", "review-bundle.manifest.json");
const SCHEMA_VERSION = "1.0";
const DEFAULT_BUNDLE_VERSION = "1.0.0";
const DEFAULT_CHANNEL = "stable";
const DEFAULT_SOURCE_REF = "main";
const WRAPPER_REL = "scripts/xruntime-exec.sh";
// FIX-4: a consumer-facing doc, distributed/installed/removed like any bundle file (sha-
// verified, no special-casing in the installer), but NOT part of the require-graph closure —
// nothing require()s a .md file, so it is appended explicitly, tagged `kind: "doc"`. The
// closure-escape check (scripts/lib/review-bundle-check.js) compares CODE entries only —
// a doc entry can never "escape" a require graph it was never a member of.
const DOC_REL = "scripts/REVIEW-BUNDLE.md";
// Consumer-local integrity check. Lifecycle ownership remains external in
// review-bundle-install.sh; only this zero-dependency verifier ships in the bundle.
const VERIFIER_REL = "scripts/review-bundle-verify.js";
// The finding schema is installed into consumer repos and may be auto-discovered by
// their repo-wide schema gate. Ship one positive and one negative fixture alongside
// it so installing the review bundle cannot turn such a gate tautological or red.
const DATA_CONTRACT_FIXTURES = [
  "tools/data-schema/fixtures/review-finding/valid/basic.jsonl",
  "tools/data-schema/fixtures/review-finding/invalid/missing-specialist.jsonl",
];

// The 3 JS tool entry points the closure is walked from, plus the 1 bash tool that has no
// JS requires of its own (check-scope-diff.sh) — together the 4 tools of FR-124.
const JS_TOOL_ENTRIES = [
  "scripts/xruntime-review.js",
  "scripts/review-normalize.js",
  "scripts/check-review-convergence.js",
];
const BASH_ONLY_TOOL = "scripts/check-scope-diff.sh";

function sha256(absPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

/** Compute the 14-file CODE closure as paths relative to `root` (sorted, deterministic).
 *  Excludes the consumer-facing doc (DOC_REL) — see FIX-4 note above. */
function computeBundlePaths(root) {
  root = root || ROOT;
  const entries = JS_TOOL_ENTRIES.map((p) => path.resolve(root, p));
  const closure = computeClosure(entries);
  const relPaths = new Set([...closure].map((abs) => path.relative(root, abs)));
  relPaths.add(BASH_ONLY_TOOL);
  return [...relPaths].sort();
}

/** Build the manifest object against `root` (defaults to this checkout). `existing` (if
 *  provided) supplies bundle_version/channel/source_ref continuity — the generator never
 *  invents a version bump on its own (FR-128 is a human act). */
function buildManifest(existing, root) {
  root = root || ROOT;
  const files = computeBundlePaths(root).map((rel) => {
    const abs = path.resolve(root, rel);
    const entry = { path: rel, sha256: sha256(abs) };
    if (rel === WRAPPER_REL) entry.shared = true;
    return entry;
  });
  if (fs.existsSync(path.resolve(root, DOC_REL))) {
    files.push({ path: DOC_REL, sha256: sha256(path.resolve(root, DOC_REL)), kind: "doc" });
  }
  if (fs.existsSync(path.resolve(root, VERIFIER_REL))) {
    files.push({ path: VERIFIER_REL, sha256: sha256(path.resolve(root, VERIFIER_REL)), kind: "verifier" });
  }
  for (const rel of DATA_CONTRACT_FIXTURES) {
    if (fs.existsSync(path.resolve(root, rel))) {
      files.push({ path: rel, sha256: sha256(path.resolve(root, rel)), kind: "fixture" });
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    bundle_version: (existing && existing.bundle_version) || DEFAULT_BUNDLE_VERSION,
    channel: (existing && existing.channel) || DEFAULT_CHANNEL,
    source_ref: (existing && existing.source_ref) || DEFAULT_SOURCE_REF,
    files,
  };
}

function readExisting(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const rootFlagIndex = argv.indexOf("--root");
  const root = rootFlagIndex >= 0 ? path.resolve(argv[rootFlagIndex + 1]) : ROOT;
  return { root, print: argv.includes("--print"), check: argv.includes("--check") };
}

function main() {
  const { root, print, check } = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(root, "scripts", "review-bundle.manifest.json");
  const existing = readExisting(manifestPath);
  const manifest = buildManifest(existing, root);
  const serialized = JSON.stringify(manifest, null, 2) + "\n";

  if (print) {
    process.stdout.write(serialized);
    return;
  }

  if (check) {
    const onDisk = existing ? JSON.stringify(existing, null, 2) + "\n" : null;
    if (onDisk !== serialized) {
      console.error("✗ review-bundle-manifest: scripts/review-bundle.manifest.json is stale — run `node scripts/review-bundle-manifest.js` to regenerate.");
      process.exit(1);
    }
    console.log("✓ review-bundle-manifest: manifest is current.");
    return;
  }

  fs.writeFileSync(manifestPath, serialized);
  console.log(`✓ review-bundle-manifest: wrote ${manifest.files.length} file(s) to ${path.relative(root, manifestPath)}.`);
}

if (require.main === module) main();

module.exports = { buildManifest, computeBundlePaths, sha256, MANIFEST_PATH, DATA_CONTRACT_FIXTURES };
