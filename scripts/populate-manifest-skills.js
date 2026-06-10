#!/usr/bin/env node
// populate-manifest-skills.js — reads skills/**/*.md frontmatter and emits the
// layers.skills array for .harness/harness.json.
//
// Usage:
//   node scripts/populate-manifest-skills.js          # print JSON to stdout
//   node scripts/populate-manifest-skills.js --update # update .harness/harness.json in-place
//   node scripts/populate-manifest-skills.js --check  # exit 1 if harness.json is stale (CI guard)

"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const HARNESS_JSON = path.join(ROOT, ".harness", "harness.json");

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return yaml.load(match[1]);
  } catch {
    return null;
  }
}

function collectSkills() {
  const skills = [];
  const domains = fs.readdirSync(SKILLS_DIR).filter((d) =>
    fs.statSync(path.join(SKILLS_DIR, d)).isDirectory()
  );
  for (const domain of domains.sort()) {
    const domainDir = path.join(SKILLS_DIR, domain);
    const files = fs.readdirSync(domainDir).filter((f) => f.endsWith(".md")).sort();
    for (const file of files) {
      const filePath = path.join(domainDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm || !fm.name) continue;
      const basename = path.basename(file, ".md");
      const entry = {
        name: fm.name,
        source: "roster",
        version: fm.version || "0.0.0",
        domain,
        phase: fm.phase !== undefined ? fm.phase : null,
        tunables: fm.tunables || {},
      };
      // Only add 'file' when it differs from 'name' (e.g. preamble.md → roster-preamble)
      if (basename !== fm.name) entry.file = basename;
      skills.push(entry);
    }
  }
  return skills;
}

const skills = collectSkills();

if (process.argv.includes("--update")) {
  const harness = JSON.parse(fs.readFileSync(HARNESS_JSON, "utf8"));
  harness.layers.skills = skills;
  fs.writeFileSync(HARNESS_JSON, JSON.stringify(harness, null, 2) + "\n");
  console.log(`Updated ${HARNESS_JSON} with ${skills.length} skills.`);
} else if (process.argv.includes("--check")) {
  const harness = JSON.parse(fs.readFileSync(HARNESS_JSON, "utf8"));
  const current = JSON.stringify(harness.layers.skills ?? []);
  const expected = JSON.stringify(skills);
  if (current !== expected) {
    console.error(
      "✗ skill-manifest: layers.skills in .harness/harness.json is stale.\n" +
        "  Run: node scripts/populate-manifest-skills.js --update && bash scripts/sync-harness.sh\n" +
        "  Then commit the updated .harness/harness.json and its projections."
    );
    process.exit(1);
  }
  console.log(`✓ skill-manifest: layers.skills is current (${skills.length} skills).`);
} else {
  console.log(JSON.stringify(skills, null, 2));
}
