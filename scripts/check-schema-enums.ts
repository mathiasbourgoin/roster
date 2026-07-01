/**
 * One-way enum-documentation check: every enum value USED by skills, agents, or the
 * harness manifest must be documented in the corresponding schema/*.md enum line.
 * Unused documented values are a WARNING only — never a failure.
 *
 * PARSED CONVENTION — schema enum lines (anchored strictly to this notation; angle
 * brackets elsewhere in the schema docs are type placeholders like `<string>` and
 * are NOT treated as enums):
 *
 *     domain: <kb|media|meta|pipeline|shared|testing|workflow>
 *     phase: <intake|question|research|spec|plan|implement|review|qa|ship|null>
 *       - name: <claude-code|codex|codex-global|opencode|copilot>
 *
 *   i.e. `field: <a|b|c>` with optional indentation / list dash, where the bracket
 *   content contains at least one `|` and every alternative is a bare token
 *   ([a-z0-9_:*-]+). Generic unions like `<string|null>` are excluded because
 *   "string" alternatives never appear in checked fields' enum lines. Only the
 *   fields listed per schema file below are consulted.
 *
 * Checked surfaces (USED values):
 *   skills/*[star]/*.md frontmatter          → schema/skill-schema.md
 *     - `domain:` scalar, `phase:`, `human_gate:` (token before any " — ")
 *   .harness/harness.json                    → schema/harness-schema.md
 *     - layers.skills[].domain / .phase, layers.rules[].category, runtimes[].name
 *   agents/**[star]/*.md + governor/governor.md + recruiter/recruiter.md frontmatter
 *     - `pipeline_role.human_gate:` leading token → schema/agent-schema.md
 *
 * Sample used-value lines:
 *     phase: intake                (skill frontmatter)
 *     human_gate: after — human validates decomposition quiz   → token "after"
 *
 * Flags: --report  → print findings but always exit 0 (debug mode).
 * Exit 0 = clean (warnings allowed). Exit 1 = an undocumented used value was found.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");

// Fields consulted per schema file. Everything else in the docs is out of scope.
const SCHEMA_FIELDS: Record<string, string[]> = {
  "schema/skill-schema.md": ["domain", "phase", "human_gate"],
  "schema/harness-schema.md": ["name", "domain", "phase", "category"],
  "schema/agent-schema.md": ["human_gate"],
};

const TOKEN_RE = /^[a-z0-9_:*-]+$/;

type EnumDoc = Map<string, Set<string>>; // field → documented values
type Used = { schema: string; field: string; value: string; where: string; line: string };

const errors: string[] = [];
const warnings: string[] = [];

/** Parse `field: <a|b|c>` lines from one schema doc, restricted to the given fields. */
function parseEnumDoc(schemaRel: string, fields: string[]): EnumDoc {
  const doc: EnumDoc = new Map();
  const text = fs.readFileSync(path.join(REPO_ROOT, schemaRel), "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:- )?([a-z_]+):\s*<([^<>]+)>/);
    if (!m || !fields.includes(m[1])) continue;
    const alts = m[2].split("|");
    if (alts.length < 2 || !alts.every((a) => TOKEN_RE.test(a)) || alts.includes("string")) continue;
    const set = doc.get(m[1]) ?? new Set<string>();
    for (const a of alts) set.add(a);
    doc.set(m[1], set);
  }
  return doc;
}

function frontmatterOf(content: string): string | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

function fmLine(fm: string, key: string, indented: boolean): string | null {
  const prefix = indented ? "\\s+" : "";
  const m = fm.match(new RegExp(`^${prefix}${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[0].trim() : null;
}

/** value part of a `key: value` line, stripped of quotes and any " — <prose>" suffix. */
function leadingToken(line: string): string {
  const value = line.replace(/^[a-z_]+\s*:\s*/, "").replace(/^['"]|['"]$/g, "");
  return value.split(" — ")[0].trim().split(/\s+/)[0];
}

function collectSkillUsage(used: Used[]): void {
  const skillsDir = path.join(REPO_ROOT, "skills");
  for (const domainDir of fs.readdirSync(skillsDir)) {
    const dir = path.join(skillsDir, domainDir);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const rel = `skills/${domainDir}/${file}`;
      const fm = frontmatterOf(fs.readFileSync(path.join(dir, file), "utf-8"));
      if (!fm) continue;
      for (const field of ["domain", "phase", "human_gate"]) {
        const line = fmLine(fm, field, false);
        if (!line || line.endsWith(":") || /:\s*\[/.test(line)) continue; // absent or list
        used.push({ schema: "schema/skill-schema.md", field, value: leadingToken(line), where: rel, line });
      }
    }
  }
}

function collectAgentUsage(used: Used[]): void {
  const agentFiles: string[] = ["governor/governor.md", "recruiter/recruiter.md"];
  const agentsDir = path.join(REPO_ROOT, "agents");
  for (const domainDir of fs.readdirSync(agentsDir)) {
    const dir = path.join(agentsDir, domainDir);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      agentFiles.push(`agents/${domainDir}/${f}`);
    }
  }
  for (const rel of agentFiles) {
    const fm = frontmatterOf(fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8"));
    if (!fm) continue;
    const line = fmLine(fm, "human_gate", true); // nested under pipeline_role:
    if (!line) continue;
    used.push({ schema: "schema/agent-schema.md", field: "human_gate", value: leadingToken(line), where: rel, line });
  }
}

function collectHarnessUsage(used: Used[]): void {
  const rel = ".harness/harness.json";
  const manifestPath = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const push = (field: string, value: unknown, where: string) => {
    if (value === undefined) return;
    const v = value === null ? "null" : String(value);
    used.push({ schema: "schema/harness-schema.md", field, value: v, where, line: `${field}: ${v}` });
  };
  for (const s of manifest.layers?.skills ?? []) {
    push("domain", s.domain, `${rel} layers.skills[${s.name}]`);
    if ("phase" in s) push("phase", s.phase, `${rel} layers.skills[${s.name}]`);
  }
  for (const r of manifest.layers?.rules ?? []) {
    push("category", r.category, `${rel} layers.rules[${r.name}]`);
  }
  for (const rt of manifest.runtimes ?? []) {
    push("name", rt.name, `${rel} runtimes[]`);
  }
}

function main(): void {
  const reportOnly = process.argv.includes("--report");
  const docs = new Map<string, EnumDoc>();
  for (const [schemaRel, fields] of Object.entries(SCHEMA_FIELDS)) {
    const doc = parseEnumDoc(schemaRel, fields);
    for (const field of fields) {
      if (!doc.has(field)) {
        errors.push(`${schemaRel}: no \`${field}: <a|b|c>\` enum line found — schema notation changed?`);
      }
    }
    docs.set(schemaRel, doc);
  }

  const used: Used[] = [];
  collectSkillUsage(used);
  collectAgentUsage(used);
  collectHarnessUsage(used);

  const seen = new Map<string, Set<string>>(); // `${schema}#${field}` → used values
  for (const u of used) {
    const documented = docs.get(u.schema)?.get(u.field);
    if (!documented) continue; // missing enum line already reported above
    const key = `${u.schema}#${u.field}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(u.value);
    if (!documented.has(u.value)) {
      errors.push(`${u.where}: "${u.value}" is not documented for ${u.field} in ${u.schema} — offending line: ${u.line}`);
    }
  }

  for (const [schemaRel, doc] of docs) {
    for (const [field, values] of doc) {
      const usedValues = seen.get(`${schemaRel}#${field}`) ?? new Set();
      for (const v of values) {
        if (!usedValues.has(v)) warnings.push(`${schemaRel}: documented ${field} value "${v}" is currently unused`);
      }
    }
  }

  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (errors.length === 0) {
    console.log(`✓ schema-enums: all ${used.length} used enum values are documented (${warnings.length} unused-value warning(s))`);
    process.exit(0);
  }
  console.error(`\nschema-enum violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} violation(s) found.`);
  process.exit(reportOnly ? 0 : 1);
}

main();
