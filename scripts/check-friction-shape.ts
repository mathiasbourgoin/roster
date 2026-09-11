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
 *   date, skill, task, frictions, classes, methods, suggestion_type, suggestion, effort_estimate
 *
 * LOG MODE — `--log <path>` validates a REAL skills-meta/friction.jsonl instead of the
 * templates. Templates carry placeholders, so only this mode checks VALUES:
 *   - every required key present;
 *   - `classes` is an array whose every value is in the closed vocabulary, which is
 *     parsed out of schema/skill-schema.md (single source of truth — the doc and this
 *     checker cannot drift, because the checker has no second copy of the list);
 *   - `classes` is empty iff `frictions` is empty (a clean run has no classes, and a
 *     friction with no class is exactly the unclassifiable entry this field exists to
 *     eliminate);
 *   - `classes` containing "other" requires a non-empty `class_note`.
 *
 *   `--since <ISO-date>` (log mode only) checks entries dated on or after it and
 *   skips older ones, printing both counts. This lets the gate block NEW entries in a
 *   repo whose historical log predates the `classes` field, without a retroactive
 *   re-classification from memory. An entry with a missing or empty `date` is always
 *   checked — dropping the field must not be a way out of the gate.
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
  "classes",
  "methods",
  "suggestion_type",
  "suggestion",
  "effort_estimate",
];
const SCHEMA_DOC = "schema/skill-schema.md";

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

/**
 * The closed `classes` vocabulary, read from schema/skill-schema.md's enum line
 * (house notation: `classes: <a|b|c>`). Deliberately NOT duplicated here — a second
 * copy is a schema-drift generator, which is one of the classes it lists.
 */
export function frictionClasses(repoRoot: string = REPO_ROOT): Set<string> {
  const text = fs.readFileSync(path.join(repoRoot, SCHEMA_DOC), "utf-8");
  const m = text.match(/^\s*classes:\s*<([^<>]+)>\s*$/m);
  if (!m) {
    throw new Error(`${SCHEMA_DOC}: no \`classes: <a|b|c>\` enum line found — schema notation changed?`);
  }
  return new Set(m[1].split("|").map((s) => s.trim()));
}

/**
 * Validate a real friction.jsonl. Returns violations plus the checked/skipped counts.
 *
 * `since` (ISO date) restricts checking to entries dated on or after it. This is the
 * migration seam: a log written before the `classes` field existed cannot be validated
 * retroactively without re-classifying its entries from memory — which is the exact
 * failure this field was added to stop. So old entries are skipped BY DATE, loudly
 * (the counts are printed), and new ones are gated from day one.
 */
export function checkLog(
  logPath: string,
  vocabulary: Set<string>,
  since?: string,
): { violations: string[]; checked: number; skipped: number } {
  const found: string[] = [];
  let checked = 0;
  let skipped = 0;
  const raw = fs.readFileSync(logPath, "utf-8");
  const lines = raw.split("\n");
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    const where = `${logPath}:${i + 1}`;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      found.push(`${where}: not valid JSON`);
      return;
    }
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      found.push(`${where}: entry is not a JSON object`);
      return;
    }
    const entry = record as Record<string, unknown>;
    if (since !== undefined) {
      const date = entry.date;
      // An entry with no usable date is CHECKED, never skipped — otherwise dropping the
      // date field would be a way to opt out of the gate.
      if (typeof date === "string" && date !== "" && date < since) {
        skipped++;
        return;
      }
    }
    checked++;
    const missing = REQUIRED_KEYS.filter((k) => !(k in entry));
    if (missing.length > 0) found.push(`${where}: missing required key(s) [${missing.join(", ")}]`);

    const { classes, frictions } = entry;
    if (!("classes" in entry)) return; // already reported
    if (!Array.isArray(classes)) {
      found.push(`${where}: "classes" must be an array`);
      return;
    }
    for (const c of classes) {
      if (typeof c !== "string" || !vocabulary.has(c)) {
        found.push(`${where}: class ${JSON.stringify(c)} is not in the closed vocabulary (${SCHEMA_DOC})`);
      }
    }
    if (Array.isArray(frictions)) {
      if (frictions.length > 0 && classes.length === 0) {
        found.push(`${where}: ${frictions.length} friction(s) with an empty "classes" — every friction must carry a class`);
      }
      if (frictions.length === 0 && classes.length > 0) {
        found.push(`${where}: "classes" is non-empty on a clean run (frictions: []) — a clean run has no classes`);
      }
    }
    if (classes.includes("other")) {
      const note = entry.class_note;
      if (typeof note !== "string" || note.trim() === "") {
        found.push(`${where}: class "other" requires a non-empty "class_note"`);
      }
    }
  });
  return { violations: found, checked, skipped };
}

function runLogMode(logPath: string, reportOnly: boolean, since?: string): void {
  if (!fs.existsSync(logPath)) {
    // NOT a checkmark: an absent log is an unvalidated log, and printing "✓" here would
    // make this command read identically whether it checked 200 entries or zero.
    console.log(`- friction-shape: ${logPath} absent — nothing to validate (log NOT checked)`);
    process.exit(0);
  }
  const { violations, checked, skipped } = checkLog(logPath, frictionClasses(), since);
  const scope = since ? ` (${checked} checked, ${skipped} pre-${since} entries skipped)` : ` (${checked} entries)`;
  if (violations.length === 0) {
    console.log(`✓ friction-shape: ${logPath} conforms to the entry schema and the closed class vocabulary${scope}`);
    process.exit(0);
  }
  console.error(`\nfriction-log violations (${violations.length})${scope}:\n`);
  for (const e of violations) console.error(`  ✗ ${e}`);
  console.error(`\n${violations.length} violation(s) found.`);
  process.exit(reportOnly ? 0 : 1);
}

function main(): void {
  const reportOnly = process.argv.includes("--report");
  const logFlag = process.argv.indexOf("--log");
  if (logFlag !== -1) {
    const logPath = process.argv[logFlag + 1];
    if (!logPath || logPath.startsWith("--")) {
      console.error("--log requires a path argument");
      process.exit(2);
    }
    const sinceFlag = process.argv.indexOf("--since");
    let since: string | undefined;
    if (sinceFlag !== -1) {
      since = process.argv[sinceFlag + 1];
      if (!since || since.startsWith("--")) {
        console.error("--since requires an ISO date argument");
        process.exit(2);
      }
    }
    runLogMode(logPath, reportOnly, since);
    return;
  }

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

if (require.main === module) main();
