/**
 * Fail-closed CI contract test for skills-meta/cost.jsonl against
 * schema/cost-snapshot.schema.json, mirroring scripts/check-friction-shape.ts's
 * fail-closed posture and files-as-source convention (JSONL source + schema +
 * zero-dependency validator, research Q5).
 *
 * Unlike check-friction-shape.ts (a hand-rolled required-key check), this file
 * is schema-driven via scripts/lib/cost-schema.ts's small JSON-Schema-subset
 * interpreter, which itself fails closed (throws) on any schema keyword it
 * does not implement — so schema/validator drift is impossible.
 *
 * Absent skills-meta/cost.jsonl is NOT an error — cost capture is entirely
 * advisory (FR-160 parity: no ccusage / no snapshot yet must never fail CI).
 *
 * Usage: npx tsx scripts/check-cost-shape.ts [<jsonl-file>] [--schema <schema-file>]
 *   Defaults: <jsonl-file> = skills-meta/cost.jsonl (relative to cwd — run from repo root)
 *             <schema-file> = schema/cost-snapshot.schema.json
 *
 * Flags: --report  → print findings but always exit 0 (debug mode).
 * Exit 0 = clean (or file absent). Exit 1 = schema-compile failure or a line violates the schema.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { compileSchema, SchemaCompileError } from "./lib/cost-schema";

const REPO_ROOT = process.cwd();

function parseArgs(argv: string[]): { file: string; schemaFile: string; reportOnly: boolean } {
  const args = argv.slice(2);
  const reportOnly = args.includes("--report");
  const positional = args.filter((a) => a !== "--report" && a !== "--schema");
  const schemaFlagIndex = args.indexOf("--schema");
  const schemaFile =
    schemaFlagIndex !== -1 && args[schemaFlagIndex + 1]
      ? args[schemaFlagIndex + 1]
      : "schema/cost-snapshot.schema.json";
  const file = positional[0] ?? "skills-meta/cost.jsonl";
  return { file, schemaFile, reportOnly };
}

/** Parse a JSONL file into records, reporting which line (1-based) failed to parse, if any. */
function parseJsonl(content: string): { records: unknown[]; badLine: { n: number; text: string } | null } {
  const lines = content.split("\n");
  const records: unknown[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      return { records: [], badLine: { n: i + 1, text: line } };
    }
  }
  return { records, badLine: null };
}

function main(): number {
  const { file, schemaFile, reportOnly } = parseArgs(process.argv);
  const filePath = path.resolve(REPO_ROOT, file);
  const schemaPath = path.resolve(REPO_ROOT, schemaFile);

  if (!fs.existsSync(filePath)) {
    console.log(`✓ cost-shape: ${file} absent — nothing to validate (cost capture is advisory).`);
    return 0;
  }

  let compiled;
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    compiled = compileSchema(schema);
  } catch (e) {
    if (e instanceof SchemaCompileError) {
      console.error(`✗ cost-shape: schema compile failed — ${e.message}`);
      return reportOnly ? 0 : 1;
    }
    console.error(`✗ cost-shape: could not read/parse ${schemaFile} — ${(e as Error).message}`);
    return reportOnly ? 0 : 1;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const { records, badLine } = parseJsonl(content);
  if (badLine !== null) {
    console.error(`✗ cost-shape: ${file}:${badLine.n} is not valid JSON — ${badLine.text.trim()}`);
    return reportOnly ? 0 : 1;
  }

  const errors: string[] = [];
  records.forEach((record, i) => {
    for (const msg of compiled.validate(record)) {
      errors.push(`${file}:line ${i + 1} — ${msg}`);
    }
  });

  if (errors.length === 0) {
    console.log(`✓ cost-shape: ${records.length} line(s) in ${file} conform to ${schemaFile}`);
    return 0;
  }

  console.error(`\ncost-shape violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} violation(s) found.`);
  return reportOnly ? 0 : 1;
}

if (require.main === module) process.exit(main());

export { main, parseArgs, parseJsonl };
