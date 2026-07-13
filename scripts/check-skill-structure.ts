/**
 * Lint all skill markdown files for required structure and metadata.
 *
 * Checks enforced:
 *   ALL skills:
 *     1. YAML frontmatter exists (--- ... ---)
 *     2. frontmatter has `name` or `description` field (non-empty)
 *     3. frontmatter has `version` field matching bare semver (X.Y.Z, no "v" prefix)
 *     4. `## Steps` section exists
 *
 *   PIPELINE / META skills (frontmatter has `phase:`, `preamble: true`, or `friction_log: true`):
 *     5. `## When to Go Back` section exists
 *     6. `## What Next` section exists
 *
 *   SKILLS with `friction_log: true`:
 *     7. `## Friction Log` section exists
 *     8. Friction Log section contains a ```jsonl fence
 *
 *   SIZE RATCHET (specs/review-skill-slimming.md US-4, FR-117..122): budgeted
 *   files (see BUDGETS below) are word-counted with the pinned counter
 *   (CRLF normalized, frontmatter/fenced-code/Friction-Log stripped) and must
 *   stay under budget. A budget-map entry matching zero files on disk fails
 *   closed (guards a silent rename). This ratchet is upstream-only — it MUST
 *   NOT be added to the portable scripts/check-skill-contract.js (FR-121).
 *
 * Skipped: skills/shared/preamble.md (injected fragment, not a standalone skill)
 *
 * Exit 0 = clean. Exit 1 = violations found.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";

// SKILLS_DIR injection (D-5): overridable via env var so the ratchet's fixture
// test can point at a scratch directory instead of the repo's real skills/.
export const SKILLS_DIR = process.env.SKILLS_DIR
  ? path.resolve(process.env.SKILLS_DIR)
  : path.resolve(__dirname, "../../skills");
const SKIP_FILES = new Set(["preamble.md", "preamble-pipeline.md", "preamble-friction.md"]);

// Budget map keyed by repo-relative path (FR-118). Raising a budget requires
// commit-message justification (FR-120, EC-10) — this is not a knob to bump
// silently when a file grows.
export const BUDGETS: Record<string, number> = {
  "skills/pipeline/roster-review.md": 4000,
};

// FR-117: normalize CRLF -> LF, strip frontmatter, strip fenced code blocks,
// strip the `## Friction Log` section, split on whitespace filtering empties.
// V-1: fence-stripping MUST fail loudly (throw) on an unbalanced fence count —
// silently tolerating it would undercount by stripping past the real boundary.
export function countSkillWords(raw: string): number {
  const normalized = raw.replace(/\r\n/g, "\n");
  const noFrontmatter = normalized.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const noFences = stripFencedBlocks(noFrontmatter);
  const noFriction = stripFrictionLogSection(noFences);
  return noFriction.split(/\s+/).filter(Boolean).length;
}

function stripFencedBlocks(text: string): string {
  const markers = text.match(/```/g) || [];
  if (markers.length % 2 !== 0) {
    throw new Error(`unbalanced fenced code blocks (found ${markers.length} \`\`\` markers — must be even)`);
  }
  return text.replace(/```[\s\S]*?```/g, "");
}

function stripFrictionLogSection(text: string): string {
  const marker = "\n## Friction Log";
  const start = text.indexOf(marker);
  if (start === -1) return text;
  const next = text.indexOf("\n## ", start + marker.length);
  return next === -1 ? text.slice(0, start) : text.slice(0, start) + text.slice(next);
}

// FR-119: a budget-map entry matching zero files fails the check (fail-closed
// against renames) rather than silently skipping. FR-120: exceeding a budget
// states that raising it requires commit-message justification.
export async function checkBudgetForRepo(repoRoot: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const [relPath, budget] of Object.entries(BUDGETS)) {
    const full = path.resolve(repoRoot, relPath);
    let raw: string;
    try {
      raw = await fs.readFile(full, "utf-8");
    } catch {
      violations.push({
        file: relPath,
        message: `word-count ratchet budget entry matches no file on disk (fail-closed against a silent rename) — budget: ${budget} words`,
      });
      continue;
    }
    let words: number;
    try {
      words = countSkillWords(raw);
    } catch (e) {
      violations.push({ file: relPath, message: `word-count ratchet: ${(e as Error).message}` });
      continue;
    }
    if (words > budget) {
      violations.push({
        file: relPath,
        message:
          `word-count ratchet: ${words} words exceeds the budget of ${budget} (FR-118) — ` +
          "raising the budget requires commit-message justification (FR-120); compress the file " +
          "deliberately rather than silently raising the number",
      });
    }
  }
  return violations;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export type Violation = { file: string; message: string };

function parseFrontmatter(content: string): { raw: string; body: string } | null {
  // Match --- ... --- at the very start of the file (CRLF-safe)
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  return { raw: m[0], body: m[1] };
}

function fmField(fm: string, key: string): string | null {
  // Match `key: value` (simple scalar, not block)
  const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function fmBool(fm: string, key: string): boolean {
  const val = fmField(fm, key);
  return val === "true";
}

function isPipelineOrMeta(fm: string): boolean {
  // phase: <anything> (including empty/null) counts
  const hasPhase = /^phase\s*:/m.test(fm);
  const hasPreamble = fmBool(fm, "preamble");
  const hasFrictionLog = fmBool(fm, "friction_log");
  return hasPhase || hasPreamble || hasFrictionLog;
}

function hasSection(content: string, heading: string): boolean {
  // ## heading (exact, case-sensitive, at line start)
  return new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(
    content
  );
}

function hasStepsSection(content: string): boolean {
  // Accept: "## Steps", "## Steps (qualifier)", "## Step N — ...", "## Routing" (router skills)
  return /^## Steps?(?:\s|$)/m.test(content) || /^## Routing\s*$/m.test(content);
}

function frictionLogSection(content: string): string {
  const sectionMark = "\n## Friction Log";
  let sectionStart = content.indexOf(sectionMark);
  if (sectionStart === -1) {
    if (!content.startsWith("## Friction Log")) return "";
    sectionStart = -1;
  }
  const headingEnd = sectionStart === -1 ? content.indexOf("\n") : content.indexOf("\n", sectionStart + 1);
  if (headingEnd === -1) return "";
  const bodyStart = headingEnd + 1;
  const nextSection = content.indexOf("\n## ", bodyStart);
  return nextSection === -1 ? content.slice(bodyStart) : content.slice(bodyStart, nextSection);
}

function hasJsonlFence(content: string): boolean {
  // Find ## Friction Log section boundary using indexOf to avoid regex lookahead pitfalls.
  // Also handle the (theoretical) case where the heading starts at position 0.
  const sectionMark = "\n## Friction Log";
  let sectionStart = content.indexOf(sectionMark);
  if (sectionStart === -1) {
    // Could be at position 0 (start of file — unlikely but safe to handle)
    if (!content.startsWith("## Friction Log")) return false;
    sectionStart = -1; // handled below via headingEnd from position 0
  }
  const headingEnd = sectionStart === -1
    ? content.indexOf("\n")
    : content.indexOf("\n", sectionStart + 1);
  if (headingEnd === -1) return false;
  const bodyStart = headingEnd + 1;
  const nextSection = content.indexOf("\n## ", bodyStart);
  const section = nextSection === -1 ? content.slice(bodyStart) : content.slice(bodyStart, nextSection);
  return section.includes("```jsonl");
}

function checkSkill(content: string): string[] {
  const errors: string[] = [];

  // 1. Frontmatter
  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push("missing YAML frontmatter (expected --- ... --- block at top of file)");
    return errors; // remaining checks need frontmatter
  }

  // 1b. Frontmatter must be valid YAML. The other checks are regex-based and miss real YAML
  // errors — e.g. an unquoted value containing ": " (a colon+space starts a nested mapping),
  // which ships malformed frontmatter that strict runtime parsers reject.
  try {
    yaml.load(fm.body);
  } catch (e) {
    errors.push(`frontmatter is not valid YAML: ${(e as Error).message.split("\n")[0]}`);
  }

  // 2. name or description
  const name = fmField(fm.body, "name");
  const description = fmField(fm.body, "description");
  if (!name && !description) {
    errors.push('frontmatter missing "name" or "description" field');
  }

  // 3. version semver
  const version = fmField(fm.body, "version");
  if (!version) {
    errors.push('frontmatter missing "version" field');
  } else if (!SEMVER_RE.test(version)) {
    errors.push(
      `frontmatter "version" must be bare semver (X.Y.Z) — got: ${version}`
    );
  }

  // 4. ## Steps (flexible: accepts "## Steps", "## Steps (x)", "## Step N —", "## Routing")
  if (!hasStepsSection(content)) {
    errors.push('missing "## Steps" section (or equivalent: "## Steps <qualifier>", "## Step N", "## Routing")');
  }

  // Pipeline / meta checks
  if (isPipelineOrMeta(fm.body)) {
    // 5. ## When to Go Back
    if (!hasSection(content, "When to Go Back")) {
      errors.push('missing "## When to Go Back" section (required for pipeline/meta skills)');
    }

    // 6. ## What Next
    if (!hasSection(content, "What Next")) {
      errors.push('missing "## What Next" section (required for pipeline/meta skills)');
    }
  }

  // Friction log checks
  if (fmBool(fm.body, "friction_log")) {
    // 7. ## Friction Log
    if (!hasSection(content, "Friction Log")) {
      errors.push('missing "## Friction Log" section (required when friction_log: true)');
    } else if (!hasJsonlFence(content) && !frictionLogSection(content).includes("preamble-friction.md")) {
      // 8. jsonl fence, or the deduplicated pointer to the canonical template
      errors.push('## Friction Log section missing a ```jsonl fence or a pointer to the canonical template (preamble-friction.md)');
    }
  }

  return errors;
}

async function collectSkillFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSkillFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      if (!SKIP_FILES.has(entry.name)) {
        files.push(full);
      }
    }
  }
  return files;
}

async function main(): Promise<void> {
  const files = await collectSkillFiles(SKILLS_DIR);
  const violations: Violation[] = [];

  for (const file of files.sort()) {
    const content = await fs.readFile(file, "utf-8");
    const rel = path.relative(path.resolve(__dirname, "../.."), file);

    for (const msg of checkSkill(content)) {
      violations.push({ file: rel, message: msg });
    }
  }

  // US-4 size ratchet (FR-117..122) — runs via this same check-skill-structure
  // invocation, no new npm test chain entry (FR-122).
  violations.push(...(await checkBudgetForRepo(path.resolve(SKILLS_DIR, ".."))));

  if (violations.length === 0) {
    console.log(`✓ all ${files.length} skill files pass structure checks`);
    process.exit(0);
  }

  console.error(`\nSkill structure violations (${violations.length}):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.message}`);
  }
  console.error(`\n${violations.length} violation(s) found.`);
  process.exit(1);
}

// D-5: guarded so this module can be `require()`d by its fixture test
// without re-running main() as a side effect.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
