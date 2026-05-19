/**
 * Lint all agent markdown files for required metadata and structural conventions.
 *
 * Checks enforced:
 *   1. pipeline_role block present with all four sub-fields
 *      (triggered_by, receives, produces, human_gate)
 *   2. ## Output Contract section contains a **Next:** line
 *      (anywhere before the next ## section or end of file)
 *
 * Exit 0 = clean. Exit 1 = violations found.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const AGENTS_DIR = path.resolve(__dirname, "../../agents");

const PIPELINE_ROLE_SUBFIELDS = ["triggered_by", "receives", "produces", "human_gate"] as const;

type Violation = { file: string; message: string };

function checkPipelineRole(content: string): string[] {
  const errors: string[] = [];

  // Check top-level pipeline_role key exists in frontmatter (CRLF-safe)
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    return ["no YAML frontmatter found"];
  }
  const fm = fmMatch[1];

  if (!/^pipeline_role\s*:/m.test(fm)) {
    return ["missing pipeline_role in frontmatter"];
  }

  // Extract the pipeline_role block (all indented lines following the key, CRLF-safe)
  const prBlockMatch = fm.match(/^pipeline_role\s*:\s*\r?\n((?:[ \t]+.+\r?\n?)*)/m);
  const prBlock = prBlockMatch?.[1] ?? "";

  for (const subfield of PIPELINE_ROLE_SUBFIELDS) {
    if (!new RegExp(`^\\s+${subfield}\\s*:`, "m").test(prBlock)) {
      errors.push(`pipeline_role missing sub-field: ${subfield}`);
    }
  }

  return errors;
}

function checkNextAction(content: string): string[] {
  // Find ## Output Contract section (CRLF-safe)
  const outputContractMatch = content.match(/## Output Contract\r?\n([\s\S]*?)(?=\r?\n## |\r?\n---\s*$|$)/);
  if (!outputContractMatch) {
    return ["missing ## Output Contract section"];
  }

  const section = outputContractMatch[1];
  // **Next:** must appear anywhere in the Output Contract section
  if (!/\*\*Next:\*\*/.test(section)) {
    return ["## Output Contract section missing **Next:** line"];
  }

  return [];
}

async function collectAgentFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectAgentFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

async function main(): Promise<void> {
  const files = await collectAgentFiles(AGENTS_DIR);
  const violations: Violation[] = [];

  for (const file of files.sort()) {
    const content = await fs.readFile(file, "utf-8");
    const rel = path.relative(path.resolve(__dirname, "../.."), file);

    for (const msg of checkPipelineRole(content)) {
      violations.push({ file: rel, message: msg });
    }
    for (const msg of checkNextAction(content)) {
      violations.push({ file: rel, message: msg });
    }
  }

  if (violations.length === 0) {
    console.log(`✓ all ${files.length} agent files pass`);
    process.exit(0);
  }

  console.error(`\nAgent lint violations (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.message}`);
  }
  console.error(`\n${violations.length} violation(s) found.`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
