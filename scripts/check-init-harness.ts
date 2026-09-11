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
 *   fs.mkdtempSync dir (never inside the repo), with HOME and CODEX_HOME redirected
 *   into a fresh throwaway home (sync-harness.sh resolves ~/.codex through these), and
 *   assert:
 *     - exit code 0
 *     - .harness/{agents,skills,rules}/*.md counts == counts derived from the SAME
 *       arrays per profile (agents: core; core+developer; core+developer+security;
 *       full = union incl. FULL_EXTRA. skills: none for core, DEVELOPER_SKILLS for
 *       developer/security, +FULL_EXTRA_SKILLS for full. rules: CORE_RULES always —
 *       union by basename, because copy_files overwrites duplicates like recruiter.md)
 *     - .harness/hooks exists non-empty (CORE_HOOKS is copied for every profile) and
 *       its *.md count matches CORE_HOOKS(+DEVELOPER_HOOKS for developer+)
 *     - .harness/harness.json `.profile` field == the requested profile
 *     - for the full profile, adding a skill hook and re-syncing installs the
 *       self-contained hook runner, which accepts the canonical intake status
 *       and rejects the legacy status spelling without target node_modules
 *     - the REAL home's ~/.codex gained no entries (env-sandbox leak tripwire)
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
const SKILL_ARRAYS = ["DEVELOPER_SKILLS", "FULL_EXTRA_SKILLS"];
const RULE_ARRAYS = ["CORE_RULES"];
const HOOK_ARRAYS = ["CORE_HOOKS", "DEVELOPER_HOOKS"];

/** Which script arrays land in each .harness/<layer> dir, per profile (mirrors init-harness.sh copy_files calls). */
const LAYER_TIERS: Record<string, Record<string, string[]>> = {
  agents: {
    core: ["CORE_AGENTS"],
    developer: ["CORE_AGENTS", "DEVELOPER_AGENTS"],
    security: ["CORE_AGENTS", "DEVELOPER_AGENTS", "SECURITY_AGENTS"],
    full: AGENT_ARRAYS,
  },
  skills: {
    core: [],
    developer: ["DEVELOPER_SKILLS"],
    security: ["DEVELOPER_SKILLS"],
    full: SKILL_ARRAYS,
  },
  rules: {
    core: RULE_ARRAYS,
    developer: RULE_ARRAYS,
    security: RULE_ARRAYS,
    full: RULE_ARRAYS,
  },
  hooks: {
    core: ["CORE_HOOKS"],
    developer: HOOK_ARRAYS,
    security: HOOK_ARRAYS,
    full: HOOK_ARRAYS,
  },
};

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
  for (const name of [...AGENT_ARRAYS, ...SKILL_ARRAYS, ...RULE_ARRAYS, ...HOOK_ARRAYS]) {
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
function expectedCount(arrays: Map<string, string[]>, layer: string, profile: string): number {
  const basenames = new Set<string>();
  for (const arrayName of LAYER_TIERS[layer][profile]) {
    for (const rel of arrays.get(arrayName) ?? []) basenames.add(path.basename(rel));
  }
  return basenames.size;
}

function countMdFiles(dir: string): number {
  if (!fs.existsSync(dir)) return -1;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length;
}

/** Entries directly under <home>/.codex (empty list if the dir does not exist). */
function codexEntries(home: string): string[] {
  const dir = path.join(home, ".codex");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function checkPortableSkillHook(tmp: string, sandboxHome: string): void {
  const sourceHook = path.join(REPO_ROOT, ".harness/hooks/skills/roster-spec/pre.md");
  const targetHook = path.join(tmp, ".harness/hooks/skills/roster-spec/pre.md");
  fs.mkdirSync(path.dirname(targetHook), { recursive: true });
  fs.copyFileSync(sourceHook, targetHook);

  const sync = spawnSync("bash", [path.join(REPO_ROOT, "scripts/sync-harness.sh"), tmp], {
    encoding: "utf-8",
    env: { ...process.env, HOME: sandboxHome, CODEX_HOME: path.join(sandboxHome, ".codex") },
  });
  if (sync.status !== 0) {
    errors.push(
      `profile full: sync with a skill hook exited ${sync.status} — stderr: ${(sync.stderr || "").trim().split("\n").slice(-3).join(" | ")}`
    );
    return;
  }

  const runner = path.join(tmp, ".harness/bin/run-hook.js");
  if (!fs.existsSync(runner)) {
    errors.push("profile full: skill hook sync did not install .harness/bin/run-hook.js");
    return;
  }

  const brief = path.join(tmp, "briefs/portable-intake.md");
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  const runHook = () => spawnSync(process.execPath, [runner, "pre", "roster-spec"], {
    cwd: tmp,
    encoding: "utf-8",
    env: { ...process.env, HOME: sandboxHome, TASK: "portable" },
  });

  fs.writeFileSync(brief, "# Intake\n\n**Status: VALIDATED**\n", "utf-8");
  const canonical = runHook();
  if (canonical.status !== 0) {
    errors.push(
      `profile full: installed hook runner rejected canonical intake status — stderr: ${(canonical.stderr || "").trim().split("\n").slice(-3).join(" | ")}`
    );
  }

  fs.writeFileSync(brief, "# Intake\n\n**Status:** VALIDATED\n", "utf-8");
  const legacy = runHook();
  if (legacy.status === 0) {
    errors.push("profile full: installed hook runner accepted legacy intake status spelling");
  }
}

function checkProfile(arrays: Map<string, string[]>, profile: string): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `init-harness-${profile}-`));
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), `init-harness-home-${profile}-`));
  try {
    // Sandboxed env: HOME/CODEX_HOME point into a fresh throwaway home, so any
    // global-entrypoint write (e.g. a future codex-global toggle resolving ~/.codex
    // through sync-harness.sh) lands in the sandbox, never in the real home.
    const run = spawnSync("bash", [INIT_SCRIPT, tmp, profile], {
      encoding: "utf-8",
      env: { ...process.env, HOME: sandboxHome, CODEX_HOME: path.join(sandboxHome, ".codex") },
    });
    if (run.status !== 0) {
      errors.push(
        `profile ${profile}: init-harness.sh exited ${run.status} — stderr: ${(run.stderr || "").trim().split("\n").slice(-3).join(" | ")}`
      );
      return;
    }
    if (!fs.existsSync(sandboxHome)) {
      errors.push(`profile ${profile}: sandbox HOME ${sandboxHome} vanished during bootstrap`);
    }
    for (const layer of ["agents", "skills", "rules"]) {
      const expected = expectedCount(arrays, layer, profile);
      const actual = countMdFiles(path.join(tmp, `.harness/${layer}`));
      if (actual !== expected) {
        errors.push(`profile ${profile}: expected ${expected} ${layer} files in .harness/${layer} (derived from script arrays), found ${actual}`);
      }
    }
    // Hooks are installed for every profile (CORE_HOOKS always copied) — the dir must
    // exist and carry the array-derived count.
    const expectedHooks = expectedCount(arrays, "hooks", profile);
    const actualHooks = countMdFiles(path.join(tmp, ".harness/hooks"));
    if (actualHooks < 1) {
      errors.push(`profile ${profile}: .harness/hooks is missing or empty although the script installs hooks for every profile`);
    } else if (actualHooks !== expectedHooks) {
      errors.push(`profile ${profile}: expected ${expectedHooks} hook files in .harness/hooks (derived from script arrays), found ${actualHooks}`);
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
    if (profile === "full") checkPortableSkillHook(tmp, sandboxHome);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  }
}

function main(): void {
  const reportOnly = process.argv.includes("--report");
  const arrays = parseArrays(fs.readFileSync(INIT_SCRIPT, "utf-8"));

  checkStatic(arrays);
  // Dynamic pass only makes sense if the static universe is coherent.
  // Tripwire: the real home's ~/.codex must not gain entries — bootstraps run with
  // HOME/CODEX_HOME redirected into a sandbox, so any new entry here is a leak.
  const realHome = os.homedir();
  const codexBefore = new Set(codexEntries(realHome));
  for (const profile of ["core", "developer", "security", "full"]) {
    checkProfile(arrays, profile);
    const leaked = codexEntries(realHome).filter((e) => !codexBefore.has(e));
    if (leaked.length > 0) {
      errors.push(`profile ${profile}: bootstrap leaked into the REAL home's .codex — new entries: ${leaked.join(", ")}`);
    }
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
