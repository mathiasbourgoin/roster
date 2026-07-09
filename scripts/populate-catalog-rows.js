#!/usr/bin/env node
/**
 * populate-catalog-rows.js — regenerate AGENTS.md skill-catalog rows from skill frontmatter.
 * Usage: node scripts/populate-catalog-rows.js [--check]
 *
 * Motivated by: friction "manual AGENTS.md version-row edit after any skill version bump"
 * (3 logged occurrences: schema-doc-drift 2026-07-01, drift-checkers 2026-07-02,
 * skill-category-vocabulary 2026-07-08 — plus 12 unlogged repetitions in the 2026-07-08 batch).
 * Added: 2026-07-09
 *
 * Writer counterpart of scripts/check-catalog-sync.ts (which stays the verifier):
 * for every pipe-table row `| <skill-name> | <version> | <purpose> |` in AGENTS.md whose
 * name matches a skill under skills/ (excluding skills/shared/preamble*), rewrite the
 * Version and Purpose cells from that skill's frontmatter (`version:`, `description:`,
 * trailing period stripped to match catalog style). Rows are updated in place; no rows
 * are added or removed (check-catalog-sync flags missing/extra rows).
 *
 * --check: exit 1 if any row would change, without writing (CI-friendly).
 * Deterministic: same frontmatter → same rows. Exit 0 = success/no-op, 1 = drift (--check)
 * or missing inputs.
 *
 * Tested: nominal update (row drift → rewritten, exit 0); --check on drift (exit 1,
 * no write); no-op run (exit 0, file untouched); missing AGENTS.md (exit 1, stderr).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(REPO_ROOT, "AGENTS.md");

function frontmatterField(file, field) {
  const content = fs.readFileSync(file, "utf-8");
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(new RegExp(`^${field}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function collectSkills() {
  const skills = new Map();
  const skillsDir = path.join(REPO_ROOT, "skills");
  for (const domain of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(skillsDir, domain.name))) {
      if (!f.endsWith(".md")) continue;
      const rel = `skills/${domain.name}/${f}`;
      if (rel.startsWith("skills/shared/preamble")) continue;
      const full = path.join(skillsDir, domain.name, f);
      const name = frontmatterField(full, "name") || path.basename(f, ".md");
      skills.set(name, {
        version: frontmatterField(full, "version") || "",
        purpose: (frontmatterField(full, "description") || "").replace(/\.$/, ""),
      });
    }
  }
  return skills;
}

function main() {
  const check = process.argv.includes("--check");
  if (!fs.existsSync(CATALOG)) {
    console.error(`populate-catalog-rows: ${CATALOG} not found`);
    process.exit(1);
  }
  const skills = collectSkills();
  const lines = fs.readFileSync(CATALOG, "utf-8").split("\n");
  const changed = [];
  const ROW = /^\| ([a-z0-9-]+) \| (\d+\.\d+\.\d+) \| (.+) \|$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ROW);
    if (!m || !skills.has(m[1])) continue;
    const t = skills.get(m[1]);
    const next = `| ${m[1]} | ${t.version} | ${t.purpose} |`;
    if (next !== lines[i]) {
      changed.push(`${m[1]}: ${m[2]} -> ${t.version}`);
      lines[i] = next;
    }
  }
  if (changed.length === 0) {
    console.log(`✓ catalog-rows: AGENTS.md skill rows match frontmatter (${skills.size} skills).`);
    process.exit(0);
  }
  if (check) {
    console.error(`✗ catalog-rows: ${changed.length} stale row(s):\n  ${changed.join("\n  ")}`);
    console.error("  Run: node scripts/populate-catalog-rows.js");
    process.exit(1);
  }
  fs.writeFileSync(CATALOG, lines.join("\n"));
  console.log(`✓ catalog-rows: updated ${changed.length} AGENTS.md row(s):\n  ${changed.join("\n  ")}`);
  process.exit(0);
}

main();
