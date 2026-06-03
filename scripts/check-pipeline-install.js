#!/usr/bin/env node
// check-pipeline-install.js — CommonJS
// Guards the install-path invariants that are otherwise only exercised by live LLM-prose
// flows (the recruiter installing skills, Codex loading agent TOMLs) — the kind of drift
// that silently broke the documented happy path before. Two checks:
//   1. The recruiter's "Skills to install" list is in EXACT sync with skills/pipeline +
//      skills/meta on disk — no skill that exists would be skipped (drift), and no listed
//      path is missing on disk (broken fetch at install time).
//   2. Every roster-managed .codex/agents/*.toml carries the marker + the three required
//      Codex custom-agent fields (name / description / developer_instructions).
// Exits 0 if clean, 1 on any mismatch.
//
// Usage: node scripts/check-pipeline-install.js

"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const errors = [];

// ── Check 1: recruiter install-list ↔ disk ──────────────────────────────────
const recruiter = path.resolve(root, "recruiter/recruiter.md");
if (fs.existsSync(recruiter)) {
  const text = fs.readFileSync(recruiter, "utf8");
  // Scope to the "Skills to install:" list only (up to the next blank line) — a skill path
  // mentioned elsewhere in prose must not mask a missing list entry, nor cause a false fail.
  const section = (text.match(/Skills to install:\s*\n([\s\S]*?)(?:\n\s*\n|\s*$)/) || [, ""])[1];
  const listed = new Set((section.match(/skills\/(?:pipeline|meta)\/[a-z0-9-]+\.md/g) || []));

  const onDisk = new Set();
  for (const dom of ["pipeline", "meta"]) {
    const dir = path.resolve(root, "skills", dom);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".md")) onDisk.add(`skills/${dom}/${f}`);
    }
  }

  const missingFromList = [...onDisk].filter((p) => !listed.has(p)).sort();
  const missingOnDisk = [...listed].filter((p) => !onDisk.has(p)).sort();

  if (missingFromList.length) {
    errors.push(
      `recruiter "Skills to install" list is missing ${missingFromList.length} skill(s) that exist on disk ` +
        `(they would NOT be installed on first run): ${missingFromList.join(", ")}`
    );
  }
  if (missingOnDisk.length) {
    errors.push(
      `recruiter "Skills to install" list references ${missingOnDisk.length} path(s) that do not exist on disk ` +
        `(install-time fetch would fail): ${missingOnDisk.join(", ")}`
    );
  }
  if (!missingFromList.length && !missingOnDisk.length) {
    console.log(`✓ pipeline-install: recruiter install-list matches ${onDisk.size} skill(s) on disk.`);
  }
} else {
  console.log("✓ pipeline-install: no recruiter/recruiter.md — skipping install-list check.");
}

// ── Check 2: roster-managed Codex agent TOMLs carry required fields ──────────
const CODEX_MARKER = "# roster-managed";
const codexDir = path.resolve(root, ".codex/agents");
if (fs.existsSync(codexDir)) {
  const REQUIRED = ["name", "description", "developer_instructions"];
  let checked = 0;
  for (const f of fs.readdirSync(codexDir)) {
    if (!f.endsWith(".toml")) continue;
    const body = fs.readFileSync(path.join(codexDir, f), "utf8");
    if (!body.startsWith(CODEX_MARKER)) continue; // user-authored agent — not ours to validate
    checked++;
    // Only inspect the TOML header — everything BEFORE the `developer_instructions = """`
    // multiline value — so a `name = ` / `description = ` line INSIDE the instruction body
    // can't masquerade as the top-level key (false negative).
    const header = body.split(/^developer_instructions\s*=/m)[0];
    const hasDI = /^developer_instructions\s*=/m.test(body);
    for (const key of REQUIRED) {
      const present = key === "developer_instructions" ? hasDI : new RegExp(`^${key}\\s*=`, "m").test(header);
      if (!present) {
        errors.push(`.codex/agents/${f} missing required Codex custom-agent field: ${key}`);
      }
    }
  }
  if (checked && !errors.some((e) => e.includes(".codex/agents/"))) {
    console.log(`✓ pipeline-install: ${checked} roster-managed Codex agent TOML(s) carry name/description/developer_instructions.`);
  }
} else {
  console.log("✓ pipeline-install: no .codex/agents/ — skipping Codex TOML check.");
}

// ── Check 3: plugin marketplace + plugin manifests are valid ────────────────
const marketplace = path.resolve(root, ".claude-plugin/marketplace.json");
if (fs.existsSync(marketplace)) {
  try {
    const mk = JSON.parse(fs.readFileSync(marketplace, "utf8"));
    if (!mk.name) errors.push(".claude-plugin/marketplace.json missing required field: name");
    if (!mk.owner || !mk.owner.name) errors.push(".claude-plugin/marketplace.json missing required field: owner.name");
    if (!Array.isArray(mk.plugins) || mk.plugins.length === 0) {
      errors.push(".claude-plugin/marketplace.json: plugins must be a non-empty array");
    } else {
      mk.plugins.forEach((p, i) => {
        if (!p.name || !p.source) errors.push(`.claude-plugin/marketplace.json plugins[${i}] missing name or source`);
        // Relative same-repo source must exist on disk.
        if (typeof p.source === "string" && p.source.startsWith(".") && !fs.existsSync(path.resolve(root, p.source))) {
          errors.push(`.claude-plugin/marketplace.json plugins[${i}].source "${p.source}" does not exist`);
        }
      });
    }
    // Each relative plugin source dir should carry a plugin.json with a name.
    for (const p of mk.plugins || []) {
      if (typeof p.source !== "string" || !p.source.startsWith(".")) continue;
      const pj = path.resolve(root, p.source, ".claude-plugin/plugin.json");
      if (fs.existsSync(pj)) {
        try {
          if (!JSON.parse(fs.readFileSync(pj, "utf8")).name) errors.push(`${path.relative(root, pj)} missing required field: name`);
        } catch (e) {
          errors.push(`${path.relative(root, pj)} is not valid JSON: ${(e).message}`);
        }
      }
    }
    if (!errors.some((e) => e.includes(".claude-plugin/"))) {
      console.log("✓ pipeline-install: plugin marketplace + plugin manifests are valid.");
    }
  } catch (e) {
    errors.push(`.claude-plugin/marketplace.json is not valid JSON: ${(e).message}`);
  }
} else {
  console.log("✓ pipeline-install: no .claude-plugin/marketplace.json — skipping plugin-manifest check.");
}

if (errors.length) {
  console.error(`\n✗ pipeline-install: ${errors.length} issue(s):`);
  for (const e of errors) console.error(`    - ${e}`);
  console.error(
    "\n  The install-path prose flows (recruiter skill install, Codex agent load) reference these;\n" +
      "  keep the recruiter list in sync with skills/ and regenerate Codex TOMLs via sync-harness.sh."
  );
  process.exit(1);
}
