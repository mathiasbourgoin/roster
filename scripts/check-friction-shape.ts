/**
 * Lint the Friction Log JSONL templates embedded in skill files: every JSON record
 * must carry the canonical field set, so friction entries stay machine-clusterable
 * by roster-skill-health.
 *
 * PARSED CONVENTION — inside every skills/*[star]/*.md (skills/shared/preamble.md
 * exempt), fenced ```jsonl (or ```json) blocks under a `## Friction Log` heading
 * (section ends at the next `## ` heading). Sample:
 *
 *     ## Friction Log
 *
 *     ```jsonl
 *     {
 *       "date": "<ISO-8601>",
 *       "skill": "roster-intake",
 *       ...
 *     }
 *     ```
 *
 *   Each non-empty line must JSON.parse as an object (JSONL); the shipped templates
 *   are single PRETTY-PRINTED objects, so if line-parsing fails the whole block is
 *   parsed as one JSON object instead.
 *
 *   A `## Friction Log` section with ZERO fenced json/jsonl blocks is an ERROR — an
 *   empty section would otherwise pass vacuously. (A file with no Friction Log
 *   heading at all is still check-skill-structure's job, not ours.)
 *
 * REQUIRED KEYS (canonical set from the shared friction-log schema; extras allowed):
 *   date, skill, task, frictions, methods, suggestion_type, suggestion, effort_estimate
 *
 * Flags: --report  → print findings but always exit 0 (debug mode).
 * Exit 0 = clean. Exit 1 = violations found (offending block/line printed).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const EXEMPT = new Set(["skills/shared/preamble.md"]);
const REQUIRED_KEYS = [
  "date",
  "skill",
  "task",
  "frictions",
  "methods",
  "suggestion_type",
  "suggestion",
  "effort_estimate",
];

const errors: string[] = [];

function skillFiles(): string[] {
  const out: string[] = [];
  const skillsDir = path.join(REPO_ROOT, "skills");
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(skillsDir, entry.name))) {
      const rel = `skills/${entry.name}/${f}`;
      if (f.endsWith(".md") && !EXEMPT.has(rel)) out.push(rel);
    }
  }
  return out.sort();
}

/** The `## Friction Log` section body (until the next `## ` heading), or null. */
function frictionSection(content: string): string | null {
  // Matches the skill-level `## Friction Log` heading and the preamble fragment's
  // `### Friction Log` (skills/shared/preamble-friction.md carries the canonical template).
  const m = content.match(/^##+ Friction Log\s*$/m);
  if (!m || m.index === undefined) return null;
  const bodyStart = content.indexOf("\n", m.index) + 1;
  const nextSection = content.indexOf("\n## ", bodyStart);
  return nextSection === -1 ? content.slice(bodyStart) : content.slice(bodyStart, nextSection);
}

/** Fenced ```jsonl / ```json block bodies within a section. */
function fencedBlocks(section: string): string[] {
  const blocks: string[] = [];
  const re = /^```jsonl?\s*\n([\s\S]*?)^```\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) blocks.push(m[1]);
  return blocks;
}

/** Parse block as JSONL; fall back to one pretty-printed JSON object. */
function parseRecords(block: string): { records: unknown[]; badLine: string | null } {
  const lines = block.split("\n").filter((l) => l.trim() !== "");
  const records: unknown[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      try {
        return { records: [JSON.parse(block)], badLine: null };
      } catch {
        return { records: [], badLine: line };
      }
    }
  }
  return { records, badLine: null };
}

function checkFile(rel: string): void {
  const content = fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
  const section = frictionSection(content);
  if (!section) return; // section presence is check-skill-structure's job, not ours
  const blocks = fencedBlocks(section);
  if (blocks.length === 0) {
    // Deduplicated form: the section may carry a pointer to the canonical template
    // (skills/shared/preamble-friction.md) instead of an inline block.
    if (section.includes("preamble-friction.md")) return;
    errors.push(`${rel}: "## Friction Log" section contains no fenced json/jsonl block and no pointer to the canonical template (preamble-friction.md)`);
    return;
  }
  for (const block of blocks) {
    const { records, badLine } = parseRecords(block);
    if (badLine !== null) {
      errors.push(`${rel}: Friction Log block is neither JSONL nor a single JSON object — offending line: ${badLine.trim()}`);
      continue;
    }
    for (const record of records) {
      if (typeof record !== "object" || record === null || Array.isArray(record)) {
        errors.push(`${rel}: Friction Log record is not a JSON object — offending record: ${JSON.stringify(record)}`);
        continue;
      }
      const missing = REQUIRED_KEYS.filter((k) => !(k in (record as Record<string, unknown>)));
      if (missing.length > 0) {
        errors.push(`${rel}: Friction Log record missing required key(s) [${missing.join(", ")}] — offending record: ${JSON.stringify(record)}`);
      }
    }
  }
}

function main(): void {
  const reportOnly = process.argv.includes("--report");
  const files = skillFiles();
  for (const rel of files) checkFile(rel);

  if (errors.length === 0) {
    console.log(`✓ friction-shape: all Friction Log templates in ${files.length} skill files carry the canonical key set`);
    process.exit(0);
  }
  console.error(`\nfriction-shape violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} violation(s) found.`);
  process.exit(reportOnly ? 0 : 1);
}

main();
