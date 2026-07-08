/**
 * Keep the two hand-maintained catalogs — AGENTS.md and docs/agents.md — in sync with
 * the filesystem ground truth (component file frontmatter). The catalogs are the
 * checked surface; the files are authoritative.
 *
 * GROUND TRUTH:
 *   agents  = agents/*[star]/*.md + governor/governor.md + recruiter/recruiter.md
 *             (frontmatter `name`, `version`, `model`; human_gate/prose fields NOT checked)
 *   skills  = skills/*[star]/*.md minus skills/shared/preamble.md (frontmatter `version`;
 *             skill name = file basename)
 *   rules   = rules/*[star]/*.md (count only)
 *
 * PARSED CONVENTION — the two catalogs are independently formatted:
 *
 *   Agent rows (SAME grammar in both files) — pipe table whose header row contains
 *   "Agent", "Version" and "Model":
 *     | tech-lead | 1.9.1 | opus | Orchestrates agent teams... |
 *
 *   Skill rows, AGENTS.md — pipe table with header "| Skill | Version | Purpose |",
 *   plain-name first cell, version checked against frontmatter:
 *     | roster-run | 1.7.0 | Pipeline entry point — ... |
 *
 *   Skill rows, docs/agents.md — pipe tables whose header starts with "Skill" but has
 *   NO Version column; first cell is a backticked `/roster-x` or `x` name (existence
 *   checked only):
 *     | `/roster-run` | Entry point | Detects context and routes... |
 *     | `tdd-workflow` | testing | Red-green-refactor with auto language detection |
 *
 *   Skill completeness mirrors the agent-table logic in BOTH catalogs: duplicate rows
 *   for the same skill name fail, and every filesystem skill (skills/*[star]/*.md,
 *   preamble exempt) must have a row in each catalog file.
 *
 *   Section counts — any heading ending in "(N)" (or "(N, qualifier)") must equal the
 *   number of data rows in the tables of its own section (section = until the next
 *   heading of the same or higher level):
 *     ## Agents (26)   ### Management (9)   ### Media (1, experimental)
 *
 *   Filesystem completeness — headings named exactly "Agents (N)", "Skills (N)",
 *   "Rules (N)" additionally have N checked against the ground-truth counts above.
 *
 * Flags: --report  → print findings but always exit 0 (debug mode).
 * Exit 0 = clean. Exit 1 = violations found (offending line printed).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CATALOGS = ["AGENTS.md", "docs/agents.md"];

const errors: string[] = [];

type Heading = { level: number; text: string; line: number };
type Row = { cells: string[]; line: number; raw: string };
type Table = { header: string[]; rows: Row[]; heading: Heading | null };
type Component = { name: string; version: string; model?: string };

function frontmatterField(file: string, key: string): string {
  const content = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const m = fm?.[1].match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
}

function mdFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...mdFilesUnder(rel));
    else if (entry.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

function groundTruthAgents(): Map<string, Component> {
  const files = [...mdFilesUnder("agents"), "governor/governor.md", "recruiter/recruiter.md"];
  const agents = new Map<string, Component>();
  for (const f of files) {
    const name = frontmatterField(f, "name") || path.basename(f, ".md");
    agents.set(name, { name, version: frontmatterField(f, "version"), model: frontmatterField(f, "model") });
  }
  return agents;
}

function groundTruthSkills(): Map<string, Component> {
  const skills = new Map<string, Component>();
  for (const f of mdFilesUnder("skills")) {
    if (f.startsWith("skills/shared/preamble")) continue;
    const name = path.basename(f, ".md");
    skills.set(name, { name, version: frontmatterField(f, "version") });
  }
  return skills;
}

function splitRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

/** Parse a catalog into headings and tables (each table tied to its nearest heading). */
function parseCatalog(text: string): { headings: Heading[]; tables: Table[] } {
  const lines = text.split("\n");
  const headings: Heading[] = [];
  const tables: Table[] = [];
  let current: Table | null = null;
  let sawSeparator = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^(#{2,4}) (.+?)\s*$/);
    if (h) headings.push({ level: h[1].length, text: h[2], line: i + 1 });
    if (line.startsWith("|")) {
      if (!current) {
        current = { header: splitRow(line), rows: [], heading: headings[headings.length - 1] ?? null };
        sawSeparator = false;
      } else if (/^\|[\s:|-]+\|?\s*$/.test(line)) {
        sawSeparator = true;
      } else if (sawSeparator) {
        current.rows.push({ cells: splitRow(line), line: i + 1, raw: line });
      }
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);
  return { headings, tables };
}

function normalizeName(cell: string): string {
  return cell.replace(/`/g, "").replace(/\\/g, "").replace(/^\//, "").trim();
}

function checkAgentTables(catalog: string, tables: Table[], agents: Map<string, Component>): void {
  const seen = new Set<string>();
  for (const t of tables) {
    if (!(t.header.includes("Agent") && t.header.includes("Version") && t.header.includes("Model"))) continue;
    for (const row of t.rows) {
      const [name, version, model] = [normalizeName(row.cells[0] ?? ""), row.cells[1], row.cells[2]];
      const truth = agents.get(name);
      if (!truth) {
        errors.push(`${catalog}:${row.line}: agent row "${name}" has no source file — offending line: ${row.raw}`);
        continue;
      }
      seen.add(name);
      if (version !== truth.version) {
        errors.push(`${catalog}:${row.line}: agent "${name}" version ${version} != frontmatter ${truth.version} — offending line: ${row.raw}`);
      }
      if (model !== truth.model) {
        errors.push(`${catalog}:${row.line}: agent "${name}" model ${model} != frontmatter ${truth.model} — offending line: ${row.raw}`);
      }
    }
  }
  for (const name of agents.keys()) {
    if (!seen.has(name)) errors.push(`${catalog}: agent "${name}" (from filesystem) has no row in any agent table`);
  }
}

function checkSkillTables(catalog: string, tables: Table[], skills: Map<string, Component>): void {
  const seen = new Set<string>();
  for (const t of tables) {
    if (t.header[0] !== "Skill") continue;
    const versionCol = t.header.indexOf("Version");
    for (const row of t.rows) {
      const name = normalizeName(row.cells[0] ?? "");
      const truth = skills.get(name);
      if (!truth) {
        errors.push(`${catalog}:${row.line}: skill row "${name}" has no source file under skills/*/ — offending line: ${row.raw}`);
        continue;
      }
      if (seen.has(name)) {
        errors.push(`${catalog}:${row.line}: duplicate skill row "${name}" — offending line: ${row.raw}`);
      }
      seen.add(name);
      if (versionCol !== -1 && row.cells[versionCol] !== truth.version) {
        errors.push(`${catalog}:${row.line}: skill "${name}" version ${row.cells[versionCol]} != frontmatter ${truth.version} — offending line: ${row.raw}`);
      }
    }
  }
  for (const name of skills.keys()) {
    if (!seen.has(name)) errors.push(`${catalog}: skill "${name}" (from filesystem) has no row in any skill table`);
  }
}

function checkSectionCounts(catalog: string, headings: Heading[], tables: Table[], fsCounts: Record<string, number>): void {
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const m = h.text.match(/^(.*?)\s*\((\d+)(?:,\s*[^)]*)?\)\s*$/);
    if (!m) continue;
    const declared = parseInt(m[2], 10);
    const next = headings.slice(i + 1).find((n) => n.level <= h.level);
    const end = next ? next.line : Infinity;
    const rowCount = tables
      .filter((t) => t.heading && t.heading.line >= h.line && t.heading.line < end)
      .reduce((sum, t) => sum + t.rows.length, 0);
    if (rowCount !== declared) {
      errors.push(`${catalog}:${h.line}: section "${h.text}" declares ${declared} but its tables have ${rowCount} row(s)`);
    }
    const fsCount = fsCounts[m[1]];
    if (fsCount !== undefined && declared !== fsCount) {
      errors.push(`${catalog}:${h.line}: section "${h.text}" declares ${declared} but the filesystem has ${fsCount} ${m[1].toLowerCase()}`);
    }
  }
}

function main(): void {
  const reportOnly = process.argv.includes("--report");
  const agents = groundTruthAgents();
  const skills = groundTruthSkills();
  const fsCounts: Record<string, number> = {
    Agents: agents.size,
    Skills: skills.size,
    Rules: mdFilesUnder("rules").length,
  };

  for (const catalog of CATALOGS) {
    const { headings, tables } = parseCatalog(fs.readFileSync(path.join(REPO_ROOT, catalog), "utf-8"));
    checkAgentTables(catalog, tables, agents);
    checkSkillTables(catalog, tables, skills);
    checkSectionCounts(catalog, headings, tables, fsCounts);
  }

  if (errors.length === 0) {
    console.log(`✓ catalog-sync: AGENTS.md and docs/agents.md match ${agents.size} agents, ${skills.size} skills, ${fsCounts.Rules} rules`);
    process.exit(0);
  }
  console.error(`\ncatalog-sync violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} violation(s) found.`);
  process.exit(reportOnly ? 0 : 1);
}

main();
