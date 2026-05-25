#!/usr/bin/env node
// check-kb-links.js — CommonJS
// Walks a kb/ directory, validates:
//   1. All relative markdown links [text](path) resolve to real files.
//   2. All YAML frontmatter `superseded-by` and `supersedes` paths resolve to real files.
// Exits 0 if clean or kb/ missing, exits 1 on broken links.
//
// Usage: node scripts/check-kb-links.js [kb-dir]
//   kb-dir defaults to "kb/" relative to cwd.

"use strict";

const fs = require("fs");
const path = require("path");

const kbDir = path.resolve(process.cwd(), process.argv[2] || "kb");

if (!fs.existsSync(kbDir)) {
  console.log(`✓ No kb/ directory found at ${kbDir} — skipping link check.`);
  process.exit(0);
}

// Regex: matches [text](target) — non-greedy.
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
// Frontmatter field: superseded-by or supersedes with a non-null path value.
const FM_PATH_RE = /^(?:superseded-by|supersedes)\s*:\s*(.+)$/gm;

/** Collect all .md files under a directory recursively. Skip hidden dirs (e.g. .index/). */
function collectMdFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // skip .index/, .git/, etc.
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/** Extract all relative markdown link targets from content. Returns { raw, target } pairs. */
function extractMarkdownLinks(content) {
  const links = [];
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(content)) !== null) {
    const target = m[1].trim();
    if (target.startsWith("http://") || target.startsWith("https://")) continue;
    if (target.startsWith("#")) continue;
    if (!target) continue;
    const withoutAnchor = target.split("#")[0];
    if (!withoutAnchor) continue;
    links.push({ raw: target, target: withoutAnchor });
  }
  return links;
}

/** Extract frontmatter block (between first --- markers). */
function extractFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

/** Extract superseded-by / supersedes path values from frontmatter. Skips null/empty. */
function extractFrontmatterPaths(frontmatter) {
  const paths = [];
  let m;
  FM_PATH_RE.lastIndex = 0;
  while ((m = FM_PATH_RE.exec(frontmatter)) !== null) {
    const val = m[1].trim().replace(/^['"]|['"]$/g, "");
    if (!val || val === "null") continue;
    paths.push(val);
  }
  return paths;
}

// Single read pass: collect all files and their content.
const files = collectMdFiles(kbDir);
const fileContents = files.map(f => ({ file: f, content: fs.readFileSync(f, "utf-8") }));

const broken = [];
let totalLinks = 0;

for (const { file, content } of fileContents) {
  const dir = path.dirname(file);
  const rel = path.relative(process.cwd(), file);

  // Check markdown links.
  const mdLinks = extractMarkdownLinks(content);
  totalLinks += mdLinks.length;
  for (const { raw, target } of mdLinks) {
    const absolute = path.resolve(dir, target);
    if (!fs.existsSync(absolute)) {
      broken.push({ file: rel, link: raw, resolved: path.relative(process.cwd(), absolute), source: "link" });
    }
  }

  // Check frontmatter path fields (superseded-by, supersedes).
  const fm = extractFrontmatter(content);
  const fmPaths = extractFrontmatterPaths(fm);
  totalLinks += fmPaths.length;
  for (const fmPath of fmPaths) {
    const absolute = path.resolve(dir, fmPath);
    if (!fs.existsSync(absolute)) {
      broken.push({ file: rel, link: fmPath, resolved: path.relative(process.cwd(), absolute), source: "frontmatter" });
    }
  }
}

if (broken.length === 0) {
  console.log(`✓ ${totalLinks} link(s) checked across ${files.length} file(s) — all valid.`);
  process.exit(0);
} else {
  console.error(`\nBroken KB links (${broken.length}):\n`);
  for (const { file, link, resolved, source } of broken) {
    console.error(`  ${file}: [${source}] ${link} → ${resolved} (not found)`);
  }
  console.error(`\n${broken.length} broken link(s) found.`);
  process.exit(1);
}

