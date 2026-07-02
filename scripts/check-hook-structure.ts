/**
 * Lint all skill-hook markdown files for required structure and metadata.
 *
 * Checks enforced (errors — exit 1):
 *   1. File has YAML frontmatter (--- ... ---)
 *   2. Frontmatter has `name` (non-empty, kebab-case)
 *   3. Frontmatter has `version` (bare semver X.Y.Z)
 *   4. Frontmatter has `event: pre` or `event: post`
 *   5. Frontmatter has `skill` (non-empty string)
 *   6. Body contains a fenced YAML block with `steps:` key
 *   7. `steps:` value is a non-empty array
 *   8. Each step has exactly one operator key from the allowed set
 *   9. `prompt` steps must have co-occurring `agent` field
 *  10. `include` paths must be resolvable if `.harness/` exists
 *  11. `goto` label values must match a `label:` step in same file
 *  12. `agent` values must resolve to an installed skill or agent (if `.harness/` exists)
 *
 * Warnings (exit 0):
 *   - `loop:` without `until:` key
 *   - `parallel:` step found
 *   - `goto:` from a `pre` hook targets a roster pipeline step (not a label in this file)
 *   - `goto:` targets the hook's own skill — self-loop (EC-3)
 *   - hook targets a skill not installed in the harness (EC-7)
 *   - `break_if:`/`continue_if:` outside a loop body (valid, LLM-deferred — Sc.4C)
 *
 * Entry point: scans directory passed as CLI arg (default: `.harness/hooks/skills/`).
 * If 0 hook files found, prints "0 hook files found — nothing to lint" and exits 0.
 *
 * Exit 0 = clean (or 0 files). Exit 1 = violations found.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { collectStepsWithContext, skillInstalled } from "./lib/hook-lint-helpers";

const DEFAULT_DIR = path.resolve(process.cwd(), ".harness/hooks/skills");
const SCAN_DIR = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DIR;
const HARNESS_DIR = path.resolve(process.cwd(), ".harness");

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Known roster pipeline skill names (used to distinguish pipeline jumps from intra-hook labels)
const PIPELINE_SKILLS = new Set([
  "roster-run",
  "roster-question",
  "roster-research",
  "roster-intake",
  "roster-spec",
  "roster-plan",
  "roster-implement",
  "roster-review",
  "roster-qa",
  "roster-ship",
  "roster-investigate",
  "roster-init",
  "roster-skill-health",
  "roster-skill-evolve",
]);

const ALLOWED_OPERATORS = new Set([
  "run",
  "prompt",
  "test",
  "label",
  "loop",
  "goto",
  "timeout",
  "log",
  "retry",
  "include",
  "output",
  "parallel",
  "break_if",
  "continue_if",
]);

// Supported on_error values — must match what run-hook.ts actually implements.
// (retry is a dedicated step type, not an on_error value.)
const ON_ERROR_VALUES = new Set(["stop", "warn", "skip", "ignore"]);

type Violation = { file: string; message: string };
type Warning = { file: string; message: string };

function parseFrontmatter(content: string): { raw: string; body: string } | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  return { raw: m[0], body: m[1] };
}

function fmField(fm: string, key: string): string | null {
  const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

/**
 * Extract the fenced YAML steps block from hook body (after frontmatter).
 * Looks for a ```yaml fence that contains a `steps:` key.
 */
function extractStepsBlock(content: string): string | null {
  // Remove frontmatter
  const withoutFm = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Find ```yaml ... ``` fences
  const fenceRe = /^```ya?ml\r?\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(withoutFm)) !== null) {
    const block = match[1];
    if (/^\s*steps\s*:/m.test(block)) {
      return block;
    }
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function checkHook(
  content: string,
  file: string
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Frontmatter
  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push("missing YAML frontmatter (expected --- ... --- block at top of file)");
    return { errors, warnings };
  }

  // 2. name (non-empty, kebab-case)
  const name = fmField(fm.body, "name");
  if (!name) {
    errors.push('frontmatter missing "name" field');
  } else if (!KEBAB_RE.test(name)) {
    errors.push(`frontmatter "name" must be kebab-case — got: ${name}`);
  }

  // 3. version semver
  const version = fmField(fm.body, "version");
  if (!version) {
    errors.push('frontmatter missing "version" field');
  } else if (!SEMVER_RE.test(version)) {
    errors.push(`frontmatter "version" must be bare semver (X.Y.Z) — got: ${version}`);
  }

  // 4. event: pre | post
  const event = fmField(fm.body, "event");
  if (!event) {
    errors.push('frontmatter missing "event" field (must be "pre" or "post")');
  } else if (event !== "pre" && event !== "post") {
    errors.push(`frontmatter "event" must be "pre" or "post" — got: ${event}`);
  }

  // 5. skill (non-empty)
  const skill = fmField(fm.body, "skill");
  if (!skill) {
    errors.push('frontmatter missing "skill" field');
  }

  // 5b. on_error (frontmatter default), if present, must be a supported value
  const fmOnError = fmField(fm.body, "on_error");
  if (fmOnError && !ON_ERROR_VALUES.has(fmOnError)) {
    errors.push(
      `frontmatter "on_error" must be one of ${[...ON_ERROR_VALUES].join(", ")} — got: ${fmOnError}`
    );
  }

  // 6. steps: fenced block
  const stepsBlock = extractStepsBlock(content);
  if (!stepsBlock) {
    errors.push("body missing a fenced ```yaml block containing a `steps:` key");
    return { errors, warnings };
  }

  // Parse the YAML block
  let parsed: unknown;
  try {
    parsed = yaml.load(stepsBlock);
  } catch (e) {
    errors.push(`steps YAML block failed to parse: ${(e as Error).message}`);
    return { errors, warnings };
  }

  if (!parsed || typeof parsed !== "object") {
    errors.push("steps YAML block did not parse to an object");
    return { errors, warnings };
  }

  const parsedObj = parsed as Record<string, unknown>;
  const stepsValue = parsedObj["steps"];

  // 7. steps is a non-empty array
  if (!Array.isArray(stepsValue)) {
    errors.push('`steps:` value must be an array');
    return { errors, warnings };
  }

  if (stepsValue.length === 0) {
    errors.push('`steps:` array must not be empty');
    return { errors, warnings };
  }

  // Collect all steps (flat, with loop context) for validation
  const allSteps = collectStepsWithContext(stepsValue);

  // Collect label names defined in this hook
  const labelNames = new Set<string>();
  for (const { step } of allSteps) {
    if (step && typeof step === "object") {
      const s = step as Record<string, unknown>;
      if (typeof s["label"] === "string") {
        labelNames.add(s["label"]);
      }
    }
  }

  // Track harness presence once
  const harnessExists = await pathExists(HARNESS_DIR);

  // EC-7: hook present for a skill that is not installed in the harness → warning
  if (harnessExists && skill && !(await skillInstalled(HARNESS_DIR, skill))) {
    warnings.push(
      `hook targets skill "${skill}" which is not installed in the harness (.harness/skills/ or harness.json layers) — hook has no runtime effect (EC-7)`
    );
  }

  for (let i = 0; i < allSteps.length; i++) {
    const { step, inLoop } = allSteps[i];
    if (!step || typeof step !== "object") {
      errors.push(`step ${i + 1} is not an object`);
      continue;
    }

    const s = step as Record<string, unknown>;
    const stepKeys = Object.keys(s);

    // 8. Each step has exactly one operator key from allowed set
    const operators = stepKeys.filter((k) => ALLOWED_OPERATORS.has(k));
    const unknownOps = stepKeys.filter(
      (k) =>
        !ALLOWED_OPERATORS.has(k) &&
        !["on_error", "agent", "on_true", "on_false", "backoff", "until"].includes(k)
    );

    if (unknownOps.length > 0) {
      errors.push(
        `step ${i + 1} has unknown operator(s): ${unknownOps.map((k) => `"${k}"`).join(", ")} — allowed: ${[...ALLOWED_OPERATORS].join(", ")}`
      );
    }

    // step-level on_error, if present, must be a supported value
    if ("on_error" in s && !ON_ERROR_VALUES.has(String(s["on_error"]))) {
      errors.push(
        `step ${i + 1} has invalid on_error "${String(s["on_error"])}" — allowed: ${[...ON_ERROR_VALUES].join(", ")}`
      );
    }

    if (operators.length === 0) {
      errors.push(`step ${i + 1} has no operator key (expected one of: ${[...ALLOWED_OPERATORS].join(", ")})`);
      continue;
    }

    if (operators.length > 1) {
      errors.push(`step ${i + 1} has multiple operator keys (${operators.join(", ")}) — exactly one allowed`);
    }

    const op = operators[0];

    // 9. prompt steps must have agent field
    if (op === "prompt" && !s["agent"]) {
      errors.push(`step ${i + 1}: "prompt:" step must have co-occurring "agent:" field`);
    }

    // 10. include paths must be resolvable (only if .harness exists)
    if (op === "include" && typeof s["include"] === "string" && harnessExists) {
      const includePath = s["include"] as string;
      const resolvedPath = path.join(HARNESS_DIR, "hooks", "shared", includePath.replace(/^shared\//, ""));
      if (!(await pathExists(resolvedPath))) {
        errors.push(
          `step ${i + 1}: include path "${includePath}" not found at ${resolvedPath}`
        );
      }
    }

    // 11. goto label values must match a label: step in the same file
    //     (only for intra-hook labels — skip if it looks like a pipeline skill name)
    if (op === "goto" && typeof s["goto"] === "string") {
      const target = s["goto"] as string;
      if (!PIPELINE_SKILLS.has(target) && !labelNames.has(target)) {
        // Could be a pipeline step not in our known list — warn rather than error for unknown targets
        // But if it's clearly not a pipeline skill (no roster- prefix) and not a label, it's an error
        if (!target.startsWith("roster-")) {
          errors.push(
            `step ${i + 1}: "goto: ${target}" — target is neither a known label in this file nor a recognized pipeline skill name`
          );
        }
        // else: unknown roster-* step — warn only
      }

      // 11b. Warning: goto to pipeline step from a pre hook
      if (PIPELINE_SKILLS.has(target) && event === "pre") {
        warnings.push(
          `step ${i + 1}: "goto: ${target}" in pre-hook targets a pipeline step — this may bypass pre-hook intent`
        );
      }

      // 11c. EC-3: goto targets the hook's own skill (self-loop) — warning, runtime allowed
      if (skill && target === skill) {
        warnings.push(
          `step ${i + 1}: "goto: ${target}" targets the hook's own skill — self-loop (EC-3); allowed at runtime but creates a loop`
        );
      }
    }

    // Warning: break_if/continue_if outside a loop body — valid, LLM-deferred (Sc.4C)
    if ((op === "break_if" || op === "continue_if") && !inLoop) {
      warnings.push(
        `step ${i + 1}: "${op}:" outside a loop body — valid but LLM-deferred (routed to pending_llm_steps); intended for loop bodies (Sc.4C)`
      );
    }

    // 12. agent values must resolve to an installed skill or agent (if .harness exists)
    if (harnessExists) {
      const agentVal = s["agent"] as string | undefined;
      if (agentVal) {
        const skillPath = path.join(HARNESS_DIR, "skills", `${agentVal}.md`);
        const agentPath = path.join(HARNESS_DIR, "agents", `${agentVal}.md`);
        const skillExists = await pathExists(skillPath);
        const agentExists = await pathExists(agentPath);
        if (!skillExists && !agentExists) {
          errors.push(
            `step ${i + 1}: "agent: ${agentVal}" does not resolve to an installed skill or agent in .harness/`
          );
        }
      }

      // Check parallel agents too
      if (op === "parallel" && s["parallel"] && typeof s["parallel"] === "object") {
        const parallelObj = s["parallel"] as Record<string, unknown>;
        if (Array.isArray(parallelObj["agents"])) {
          for (const a of parallelObj["agents"] as unknown[]) {
            if (typeof a === "string") {
              const skillPath = path.join(HARNESS_DIR, "skills", `${a}.md`);
              const agentPath = path.join(HARNESS_DIR, "agents", `${a}.md`);
              const skillExists = await pathExists(skillPath);
              const agentExists = await pathExists(agentPath);
              if (!skillExists && !agentExists) {
                errors.push(
                  `step ${i + 1}: parallel agent "${a}" does not resolve to an installed skill or agent in .harness/`
                );
              }
            }
          }
        }
      }
    }

    // Warning: loop without until
    if (op === "loop") {
      const loopVal = s["loop"];
      let hasUntil = false;
      if (loopVal && typeof loopVal === "object") {
        hasUntil = "until" in (loopVal as Record<string, unknown>);
      }
      // Also check if until: is a direct sibling key
      if (!hasUntil && !s["until"]) {
        warnings.push(
          `step ${i + 1}: loop without detectable termination — ensure this is intentional (linter warning: loop without "until:" key)`
        );
      }
    }

    // Warning: parallel
    if (op === "parallel") {
      warnings.push(
        `step ${i + 1}: parallel: is a prose-parallelism hint in v1 — agents execute sequentially`
      );
    }
  }

  return { errors, warnings };
}

async function collectHookFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHookFiles(full)));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !entry.name.endsWith(".inlined.md")
    ) {
      files.push(full);
    }
  }
  return files;
}

async function main(): Promise<void> {
  const files = await collectHookFiles(SCAN_DIR);

  if (files.length === 0) {
    console.log("0 hook files found — nothing to lint");
    process.exit(0);
  }

  const violations: Violation[] = [];
  const allWarnings: Warning[] = [];

  for (const file of files.sort()) {
    const content = await fs.readFile(file, "utf-8");
    const rel = path.relative(process.cwd(), file);
    const { errors, warnings } = await checkHook(content, file);

    for (const msg of errors) {
      violations.push({ file: rel, message: msg });
    }
    for (const msg of warnings) {
      allWarnings.push({ file: rel, message: msg });
    }
  }

  // Print warnings (exit 0)
  if (allWarnings.length > 0) {
    console.warn(`\nHook structure warnings (${allWarnings.length}):\n`);
    for (const w of allWarnings) {
      console.warn(`  ⚠ ${w.file}: ${w.message}`);
    }
  }

  if (violations.length === 0) {
    console.log(`✓ all ${files.length} hook file(s) pass structure checks`);
    process.exit(0);
  }

  console.error(`\nHook structure violations (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ✗ ${v.file}: ${v.message}`);
  }
  console.error(`\n${violations.length} violation(s) found.`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
