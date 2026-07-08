#!/usr/bin/env node
// check-skill-contract.js — CommonJS, buildless, dependency-free.
//
// Generic, PER-FILE validator for the roster skill contract. Unlike check-skill-structure.ts (which
// scans roster's own skills/ directory and needs a TS build + js-yaml), this validates whatever
// SKILL.md files you pass it, with no dependencies — so /roster-upgrade can run it as the generic
// CONTRACT half of its gate against ANY target pack (bounty-skills, gstack, …), not just roster's
// own skills. (Closes review finding C2: the contract check was roster-repo-scoped.)
//
// Checks (mirror of check-skill-structure.ts, regex-based for portability):
//   1. YAML frontmatter block (--- … ---) at the top
//   2. name or description present and non-empty
//   3. version is bare semver (X.Y.Z, no "v")
//   4. a `## Steps` section
//   PIPELINE/META skills (frontmatter has `phase:`, `preamble: true`, or `friction_log: true`):
//   5. `## When to Go Back`   6. `## What Next`
//   friction_log: true:
//   7. `## Friction Log` containing a ```jsonl fence
//
// Usage:  node scripts/check-skill-contract.js <SKILL.md> [<SKILL.md> ...]
// Exit:   0 = all valid   1 = one or more contract violations   3 = usage error

"use strict";

const fs = require("fs");

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

// Strip fenced code blocks from text so that section-header checks only match real headings.
function stripCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, (m) => "\n".repeat((m.match(/\n/g) || []).length));
}

// Validate one file → array of error strings (empty = valid).
function checkFile(file) {
  const errors = [];
  const text = fs.readFileSync(file, "utf8");
  const stripped = stripCodeFences(text);

  const fm = frontmatter(text);
  if (fm === null) {
    errors.push("missing YAML frontmatter (expected a --- … --- block at the top)");
    return errors; // every other check needs the frontmatter
  }

  const name = fm.match(/^name\s*:\s*(.+?)\s*$/m);
  const desc = fm.match(/^description\s*:\s*(.+?)\s*$/m);
  if ((!name || !name[1]) && (!desc || !desc[1])) {
    errors.push("frontmatter needs a non-empty `name` or `description`");
  }

  const version = fm.match(/^version\s*:\s*(.+?)\s*$/m);
  if (!version) {
    errors.push("frontmatter missing `version`");
  } else {
    // Strip inline YAML comments before semver check.
    const versionValue = version[1].replace(/#.*$/, "").replace(/^["']|["']$/g, "").trim();
    if (!/^\d+\.\d+\.\d+$/.test(versionValue)) {
      errors.push(`\`version\` must be bare semver X.Y.Z (got ${JSON.stringify(version[1])})`);
    }
  }

  if (!/\n##\s+Steps\b/.test(stripped)) errors.push("missing `## Steps` section");

  const isMeta =
    /^phase\s*:/m.test(fm) || /^preamble\s*:\s*true/m.test(fm) || /^friction_log\s*:\s*true/m.test(fm);
  if (isMeta) {
    if (!/\n##\s+When to Go Back\b/.test(stripped)) errors.push("pipeline/meta skill missing `## When to Go Back`");
    if (!/\n##\s+What Next\b/.test(stripped)) errors.push("pipeline/meta skill missing `## What Next`");
  }

  if (/^friction_log\s*:\s*true/m.test(fm)) {
    // Use original text for Friction Log section detection — this section header and its jsonl
    // fence are never inside a code block, so `text` gives correct character offsets for slicing.
    const i = text.indexOf("\n## Friction Log");
    const section = i === -1 ? "" : text.slice(i, text.indexOf("\n## ", i + 1) === -1 ? undefined : text.indexOf("\n## ", i + 1));
    if (i === -1) errors.push("`friction_log: true` but no `## Friction Log` section");
    else if (!section.includes("```jsonl") && !section.includes("preamble-friction.md"))
      errors.push("`## Friction Log` section missing a ```jsonl fence or a pointer to the canonical template (preamble-friction.md)");
  }

  return errors;
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/check-skill-contract.js <SKILL.md> [<SKILL.md> ...]");
    return 3;
  }
  let bad = 0;
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`✗ check-skill-contract: file not found: ${f}`);
      return 3;
    }
    const errors = checkFile(f);
    if (errors.length) {
      bad++;
      console.error(`✗ check-skill-contract: ${f}`);
      for (const e of errors) console.error(`    - ${e}`);
    }
  }
  if (bad) {
    console.error(`✗ check-skill-contract: ${bad} file(s) violate the roster skill contract.`);
    return 1;
  }
  console.log(`✓ check-skill-contract: ${files.length} file(s) conform to the roster skill contract.`);
  return 0;
}

module.exports = { checkFile, main };

if (require.main === module) process.exit(main(process.argv));
