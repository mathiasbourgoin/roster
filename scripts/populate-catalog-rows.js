#!/usr/bin/env node
/**
 * populate-catalog-rows.js — regenerate AGENTS.md + docs/agents.md catalog rows (skills AND
 * agents) from component frontmatter.
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
 *
 * 2026-07-10 (health P3): also rewrites agent rows `| <name> | <version> | <model> | <purpose> |`
 * in BOTH catalogs (AGENTS.md, docs/agents.md) from agents/*\/*.md + governor/governor.md +
 * recruiter/recruiter.md frontmatter (version + model cells; purpose cell left as-is — it is
 * hand-curated and not verified by check-catalog-sync). Motivated by friction "manual agent
 * version-row edits after bumps" (6 occurrences incl. PR #47).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOGS = ["AGENTS.md", "docs/agents.md"];

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

function collectAgents() {
  const agents = new Map();
  const files = [];
  const agentsDir = path.join(REPO_ROOT, "agents");
  for (const domain of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!domain.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(agentsDir, domain.name))) {
      if (f.endsWith(".md")) files.push(path.join(agentsDir, domain.name, f));
    }
  }
  for (const legacy of ["governor/governor.md", "recruiter/recruiter.md"]) {
    const full = path.join(REPO_ROOT, legacy);
    if (fs.existsSync(full)) files.push(full);
  }
  for (const full of files) {
    const name = frontmatterField(full, "name") || path.basename(full, ".md");
    agents.set(name, {
      version: frontmatterField(full, "version") || "",
      model: frontmatterField(full, "model") || "",
    });
  }
  return agents;
}

function main() {
  const check = process.argv.includes("--check");
  const skills = collectSkills();
  const agents = collectAgents();
  // Agent rows carry 4 cells (name|version|model|purpose); skill rows carry 3.
  // Match the stricter agent shape first so the greedy skill regex cannot swallow it.
  const AGENT_ROW = /^\| ([a-z0-9-]+) \| (\d+\.\d+\.\d+) \| ([a-z0-9.-]+) \| (.+) \|$/;
  const SKILL_ROW = /^\| ([a-z0-9-]+) \| (\d+\.\d+\.\d+) \| (.+) \|$/;
  const changed = [];
  for (const rel of CATALOGS) {
    const catalog = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(catalog)) {
      console.error(`populate-catalog-rows: ${catalog} not found`);
      process.exit(1);
    }
    const lines = fs.readFileSync(catalog, "utf-8").split("\n");
    let fileChanged = false;
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i].match(AGENT_ROW);
      if (a && agents.has(a[1])) {
        const t = agents.get(a[1]);
        const next = `| ${a[1]} | ${t.version} | ${t.model} | ${a[4]} |`;
        if (next !== lines[i]) {
          changed.push(`${rel} agent ${a[1]}: ${a[2]}/${a[3]} -> ${t.version}/${t.model}`);
          lines[i] = next;
          fileChanged = true;
        }
        continue;
      }
      const m = lines[i].match(SKILL_ROW);
      if (!m || !skills.has(m[1])) continue;
      const t = skills.get(m[1]);
      const next = `| ${m[1]} | ${t.version} | ${t.purpose} |`;
      if (next !== lines[i]) {
        changed.push(`${rel} skill ${m[1]}: ${m[2]} -> ${t.version}`);
        lines[i] = next;
        fileChanged = true;
      }
    }
    if (fileChanged && !check) fs.writeFileSync(catalog, lines.join("\n"));
  }
  if (changed.length === 0) {
    console.log(`✓ catalog-rows: catalog rows match frontmatter (${skills.size} skills, ${agents.size} agents).`);
    process.exit(0);
  }
  if (check) {
    console.error(`✗ catalog-rows: ${changed.length} stale row(s):\n  ${changed.join("\n  ")}`);
    console.error("  Run: node scripts/populate-catalog-rows.js");
    process.exit(1);
  }
  console.log(`✓ catalog-rows: updated ${changed.length} row(s):\n  ${changed.join("\n  ")}`);
  process.exit(0);
}

main();
