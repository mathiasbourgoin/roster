/**
 * Tests for the US-4 size ratchet in scripts/check-skill-structure.ts
 * (spec: specs/review-skill-slimming.md FR-117..122). Imports the compiled
 * sibling directly (no subprocess) — require.main guard (D-5) means loading
 * this module never re-runs main() as a side effect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { countSkillWords, countAssembledWords, BUDGETS, checkBudgetForRepo } from "./check-skill-structure";

test("FR-117: CRLF is normalized before counting (EC-11)", () => {
  const lf = "one two three\n";
  const crlf = "one two three\r\n";
  assert.equal(countSkillWords(lf), countSkillWords(crlf));
});

test("FR-117: frontmatter is stripped before counting", () => {
  const withFm = "---\nname: x\nversion: 1.0.0\n---\n\none two three\n";
  const withoutFm = "one two three\n";
  assert.equal(countSkillWords(withFm), countSkillWords(withoutFm));
});

test("FR-117: fenced code blocks are stripped before counting", () => {
  const raw = "one two\n\n```bash\nthis block has many words that must not count\n```\n\nthree\n";
  assert.equal(countSkillWords(raw), 3);
});

test("FR-117: the ## Friction Log section is stripped before counting (EC-11)", () => {
  const raw = "one two three\n\n## Friction Log\n\nmany words here that should not count at all\n";
  assert.equal(countSkillWords(raw), 3);
});

test("FR-117/EC-11: CRLF + frontmatter + fences + Friction Log together — counter excludes all four", () => {
  const raw =
    "---\r\nname: x\r\nversion: 1.0.0\r\n---\r\n\r\none two three\r\n\r\n```json\r\nignored words here\r\n```\r\n\r\n## Friction Log\r\n\r\nignored friction words\r\n";
  assert.equal(countSkillWords(raw), 3);
});

test("V-1: unbalanced fences throw (fail loud, never a silent undercount)", () => {
  const raw = "one two\n\n```bash\nunterminated fence\n\nthree four\n";
  assert.throws(() => countSkillWords(raw), /unbalanced fenced code blocks/);
});

// CHECK-7 (skill-sizing follow-up): a BOM-prefixed two-word skill must count
// as 2, not 8 — the reported probe result before this fix.
test("CHECK-7: a leading UTF-8 BOM is stripped before counting — a two-word skill counts as 2", () => {
  const bomPrefixed = "﻿one two\n";
  assert.equal(countSkillWords(bomPrefixed), 2);
  assert.equal(countSkillWords(bomPrefixed), countSkillWords("one two\n"));
});

test("countAssembledWords: includes fenced/Friction-Log content (only frontmatter stripped), still BOM/CRLF-safe (informational metric)", () => {
  const raw = "﻿---\r\nname: x\r\nversion: 1.0.0\r\n---\r\n\r\none two\r\n\r\n```json\r\nthree four\r\n```\r\n";
  // "one two" + the fence markers themselves + "three four" — fences are
  // deliberately NOT stripped here (that's what distinguishes this metric
  // from the pinned countSkillWords ratchet).
  assert.equal(countAssembledWords(raw), 6);
});

test("BUDGETS: skills/pipeline/roster-review.md is budgeted", () => {
  assert.ok(typeof BUDGETS["skills/pipeline/roster-review.md"] === "number");
});

function withFixtureRepo(files: Record<string, string>): string {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "skill-ratchet-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fsSync.mkdirSync(path.dirname(full), { recursive: true });
    fsSync.writeFileSync(full, content);
  }
  return dir;
}

test("FR-119: a budget-map entry matching zero files fails the check (fail-closed against renames)", async () => {
  const repoRoot = withFixtureRepo({}); // roster-review.md absent entirely
  const violations = await checkBudgetForRepo(repoRoot);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /matches no file on disk/);
});

test("FR-120: exceeding budget fails with a commit-message-justification message", async () => {
  const words = Array.from({ length: 4001 }, (_, i) => `word${i}`).join(" ");
  const repoRoot = withFixtureRepo({ "skills/pipeline/roster-review.md": words });
  const violations = await checkBudgetForRepo(repoRoot);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /commit-message justification/);
});

test("under budget: no violation", async () => {
  const words = Array.from({ length: 10 }, (_, i) => `word${i}`).join(" ");
  const repoRoot = withFixtureRepo({ "skills/pipeline/roster-review.md": words });
  const violations = await checkBudgetForRepo(repoRoot);
  assert.equal(violations.length, 0);
});
