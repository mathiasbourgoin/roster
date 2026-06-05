#!/usr/bin/env node
// check-recruiter-sync.js — CommonJS
// Guards against recruiter source-of-truth drift.
//
// The recruiter exists as TWO independently-maintained source files that MUST stay
// byte-identical:
//   - recruiter/recruiter.md          (legacy path hardcoded by scripts/install.sh — AGENTS.md:54)
//   - .harness/agents/recruiter.md    (canonical harness source projected by sync-harness.sh:378)
//
// install.sh fetches the first; sync-harness.sh projects the second. If they diverge,
// running sync-harness.sh silently regenerates every runtime recruit artifact from the
// stale copy — which is exactly how the v2.5.2 auto-update feature got dropped from the
// Codex projection. This check makes that invariant explicit and CI-enforced.
//
// It ALSO enforces a second invariant (specs/roster-auto-update.md Q-1): the root VERSION file
// mirrors the recruiter frontmatter `version:`. The v2.6.2 release bumped VERSION but not the
// recruiter version and shipped green precisely because nothing enforced this — now something does.
//
// Exits 0 if all invariants hold, exits 1 on any divergence with a remediation hint.
//
// Usage: node scripts/check-recruiter-sync.js

"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const LEGACY = path.resolve(root, "recruiter/recruiter.md");
const CANONICAL = path.resolve(root, ".harness/agents/recruiter.md");

// Runtime recruit projections rendered by sync-harness.sh. A load-bearing marker
// present in canonical MUST survive into every projection that exists — this is the
// exact invariant that broke when the version feature was dropped from the Codex
// projection. We assert the marker rather than byte-equality because each projection
// rewrites the frontmatter.
const PROJECTIONS = [
  ".agents/skills/recruit/SKILL.md",
  ".claude/commands/recruit.md",
  ".opencode/skills/recruit/SKILL.md",
  ".pi/skills/recruit/SKILL.md",
];
const MARKER = "Step 0: Version Check";

function checkProjections(canonicalText) {
  if (!canonicalText.includes(MARKER)) return; // marker not in source → nothing to enforce
  let drift = false;
  for (const rel of PROJECTIONS) {
    const p = path.resolve(root, rel);
    if (!fs.existsSync(p)) continue; // that runtime is not installed here
    if (!fs.readFileSync(p, "utf8").includes(MARKER)) {
      console.error(`✗ recruiter-sync: projection ${rel} is missing "${MARKER}" — stale projection.`);
      drift = true;
    }
  }
  if (drift) {
    console.error("    A runtime recruit projection is out of date. Re-run scripts/sync-harness.sh to refresh it.");
    process.exit(1);
  }
  console.log(`✓ recruiter-sync: all present recruit projections carry "${MARKER}".`);
}

// Extract the `version:` value from a markdown file's leading YAML frontmatter block.
function frontmatterVersion(text, label) {
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) {
    console.error(`✗ recruiter-sync: ${label} has no YAML frontmatter block.`);
    process.exit(1);
  }
  const field = block[1].match(/^version:\s*(.+?)\s*$/m);
  if (!field) {
    console.error(`✗ recruiter-sync: ${label} frontmatter has no 'version:' field.`);
    process.exit(1);
  }
  return field[1].trim();
}

// Enforce the release invariant from specs/roster-auto-update.md (Q-1): the root VERSION file
// mirrors the recruiter frontmatter version. A release that bumps one but not the other (as the
// v2.6.2 release did) is internally inconsistent — install.sh stamps VERSION, but the recruiter's
// own declared version is the documented source of truth. canonical === legacy is already enforced
// above, so checking canonical's frontmatter covers both recruiter copies.
function checkVersionMirror(canonicalText) {
  const versionFile = path.resolve(root, "VERSION");
  if (!fs.existsSync(versionFile)) return; // no VERSION file → nothing to mirror
  const fileVersion = fs.readFileSync(versionFile, "utf8").trim();
  const frontVersion = frontmatterVersion(canonicalText, ".harness/agents/recruiter.md");
  if (fileVersion !== frontVersion) {
    console.error("✗ recruiter-sync: VERSION↔recruiter frontmatter mirror broken.");
    console.error(`    VERSION file:                 ${JSON.stringify(fileVersion)}`);
    console.error(`    .harness/agents/recruiter.md: version: ${JSON.stringify(frontVersion)}`);
    console.error("    These MUST match (specs/roster-auto-update.md Q-1). A release bumps VERSION,");
    console.error("    both recruiter copies' frontmatter, the Update Notes, recruiter/CHANGELOG.md,");
    console.error("    and the install.sh fallback — then re-run scripts/sync-harness.sh.");
    process.exit(1);
  }
  console.log(`✓ recruiter-sync: VERSION mirrors recruiter frontmatter (${fileVersion}).`);
}

function readOrFail(file) {
  if (!fs.existsSync(file)) {
    console.error(`✗ recruiter-sync: expected file not found: ${path.relative(root, file)}`);
    process.exit(1);
  }
  return fs.readFileSync(file, "utf8");
}

const legacy = readOrFail(LEGACY);
const canonical = readOrFail(CANONICAL);

if (legacy === canonical) {
  console.log("✓ recruiter-sync: recruiter/recruiter.md and .harness/agents/recruiter.md are identical.");
  checkProjections(canonical);
  checkVersionMirror(canonical);
  process.exit(0);
}

// Report the first differing line to make the drift actionable.
const a = legacy.split("\n");
const b = canonical.split("\n");
let firstDiff = -1;
const max = Math.max(a.length, b.length);
for (let i = 0; i < max; i++) {
  if (a[i] !== b[i]) {
    firstDiff = i + 1;
    break;
  }
}

console.error("✗ recruiter-sync: recruiter source-of-truth drift detected.");
console.error(`    recruiter/recruiter.md:       ${a.length} lines`);
console.error(`    .harness/agents/recruiter.md: ${b.length} lines`);
if (firstDiff !== -1) {
  console.error(`    first divergence at line ${firstDiff}:`);
  console.error(`      recruiter/recruiter.md:       ${JSON.stringify(a[firstDiff - 1] ?? "<EOF>")}`);
  console.error(`      .harness/agents/recruiter.md: ${JSON.stringify(b[firstDiff - 1] ?? "<EOF>")}`);
}
console.error("    These two files must be byte-identical. Reconcile them (the file with the");
console.error("    newer/complete content is canonical), then re-run sync-harness.sh to refresh");
console.error("    the runtime recruit projections.");
process.exit(1);
