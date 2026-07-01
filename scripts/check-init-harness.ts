/**
 * Smoke-test scripts/init-harness.sh: static path check + dynamic bootstrap of all profiles.
 *
 * PARSED CONVENTION (coupling to init-harness.sh's array structure — if the script
 * changes how it declares its file lists, this checker must be updated in the same PR):
 *   Bash arrays of repo-relative paths, declared at column 0 as:
 *
 *     CORE_AGENTS=(
 *         "recruiter/recruiter.md"
 *         "agents/management/tech-lead.md"
 *     )
 *
 *   i.e. `NAME=(` on its own line, one double-quoted path per line, closed by `)` at
 *   column 0. Array names checked: CORE_AGENTS, DEVELOPER_AGENTS, SECURITY_AGENTS,
 *   FULL_EXTRA_AGENTS, CORE_RULES, CORE_HOOKS, DEVELOPER_HOOKS, DEVELOPER_SKILLS,
 *   FULL_EXTRA_SKILLS (all must be present — a rename fails loudly here).
 *
 * Checks enforced:
 *   STATIC: every path in every array exists in the repo (closes the 0cdf38f class of
 *   drift where an agent file moves but the bootstrap array keeps the old path).
 *   DYNAMIC: for each profile (core/developer/security/full), bootstrap into a
 *   fs.mkdtempSync dir (never inside the repo) and assert:
 *     - exit code 0
 *     - .harness/agents/*.md count == count derived from the SAME arrays
 *       (core; core+developer; core+developer+security; full = union incl. FULL_EXTRA —
 *       union by basename, because copy_files overwrites duplicates like recruiter.md)
 *     - .harness/harness.json `.profile` field == the requested profile
 *
 * Flags: --report  → print findings but always exit 0 (debug mode).
 * Exit 0 = clean. Exit 1 = violations found.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(__dirname, "../..");
const INIT_SCRIPT = path.join(REPO_ROOT, "scripts/init-harness.sh");

const AGENT_ARRAYS = ["CORE_AGENTS", "DEVELOPER_AGENTS", "SECURITY_AGENTS", "FULL_EXTRA_AGENTS"];
const OTHER_ARRAYS = [
  "CORE_RULES",
  "CORE_HOOKS",
  "DEVELOPER_HOOKS",
  "DEVELOPER_SKILLS",
  "FULL_EXTRA_SKILLS",
];

const errors: string[] = [];

/** Parse `NAME=(` ... `)` blocks; returns array name → repo-relative paths. */
function parseArrays(script: string): Map<string, string[]> {
  const arrays = new Map<string, string[]>();
  const blockRe = /^([A-Z_]+)=\(\n([\s\S]*?)^\)$/gm;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(script)) !== null) {
    const entries: string[] = [];
    for (const line of m[2].split("\n")) {
      const entry = line.match(/^\s*"([^"]+)"\s*$/);
      if (entry) entries.push(entry[1]);
    }
    arrays.set(m[1], entries);
  }
  return arrays;
}

function checkStatic(arrays: Map<string, string[]>): void {
  for (const name of [...AGENT_ARRAYS, ...OTHER_ARRAYS]) {
    const entries = arrays.get(name);
    if (!entries) {
      errors.push(`init-harness.sh: expected array ${name}=( ... ) not found — checker coupling broken?`);
      continue;
    }
    for (const rel of entries) {
      if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
        errors.push(`init-harness.sh: ${name} references a missing file — offending entry: "${rel}"`);
      }
    }
  }
}

/** Union by basename (copy_files flattens into one dir; duplicates overwrite). */
function expectedAgentCount(arrays: Map<string, string[]>, profile: string): number {
  const tiers: Record<string, string[]> = {
    core: ["CORE_AGENTS"],
    developer: ["CORE_AGENTS", "DEVELOPER_AGENTS"],
    security: ["CORE_AGENTS", "DEVELOPER_AGENTS", "SECURITY_AGENTS"],
    full: AGENT_ARRAYS,
  };
  const basenames = new Set<string>();
  for (const arrayName of tiers[profile]) {
    for (const rel of arrays.get(arrayName) ?? []) basenames.add(path.basename(rel));
  }
  return basenames.size;
}

function countMdFiles(dir: string): number {
  if (!fs.existsSync(dir)) return -1;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length;
}

function checkProfile(arrays: Map<string, string[]>, profile: string): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `init-harness-${profile}-`));
  try {
    const run = spawnSync("bash", [INIT_SCRIPT, tmp, profile], { encoding: "utf-8" });
    if (run.status !== 0) {
      errors.push(
        `profile ${profile}: init-harness.sh exited ${run.status} — stderr: ${(run.stderr || "").trim().split("\n").slice(-3).join(" | ")}`
      );
      return;
    }
    const expected = expectedAgentCount(arrays, profile);
    const actual = countMdFiles(path.join(tmp, ".harness/agents"));
    if (actual !== expected) {
      errors.push(`profile ${profile}: expected ${expected} agent files in .harness/agents (derived from script arrays), found ${actual}`);
    }
    const manifestPath = path.join(tmp, ".harness/harness.json");
    if (!fs.existsSync(manifestPath)) {
      errors.push(`profile ${profile}: manifest .harness/harness.json not created`);
    } else {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (manifest.profile !== profile) {
        errors.push(`profile ${profile}: manifest .profile is "${manifest.profile}", expected "${profile}"`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const reportOnly = process.argv.includes("--report");
  const arrays = parseArrays(fs.readFileSync(INIT_SCRIPT, "utf-8"));

  checkStatic(arrays);
  // Dynamic pass only makes sense if the static universe is coherent.
  for (const profile of ["core", "developer", "security", "full"]) {
    checkProfile(arrays, profile);
  }

  if (errors.length === 0) {
    console.log("✓ init-harness: static paths exist and all 4 profiles bootstrap cleanly");
    process.exit(0);
  }
  console.error(`\ninit-harness violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} violation(s) found.`);
  process.exit(reportOnly ? 0 : 1);
}

main();
