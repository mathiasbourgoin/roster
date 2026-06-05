#!/usr/bin/env node
// check-roster-upgrade-invariants.test.js — CommonJS, run via `node --test`.
//
// The self-upgrade fixed-point guard (review finding C3). /roster-upgrade can propose edits to ANY
// roster-contract skill — including ITSELF. A self-edit that quietly weakens its own safety clauses
// (drops a gate, the wall, propose-only, the quiz) would pass the leak scan (no secret) and the
// contract check (frontmatter still well-formed) — nothing else asserts the safety MEANING persists.
// This test does: it fails CI if the canonical skill stops naming its load-bearing invariants, so a
// weakening self-edit cannot land green. It deliberately asserts on stable tokens, not exact prose.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SKILL = path.resolve(__dirname, "../skills/meta/roster-upgrade.md");
const text = fs.readFileSync(SKILL, "utf8");

// Each invariant: a human-readable name + a predicate. If you are removing one of these, you are
// removing a safety pillar — do it deliberately, in Full, with explicit human review of the diff.
const INVARIANTS = [
  ["propose-only (never auto-merge/land)", () => /propose[- ]only/i.test(text) && /never\s+(?:auto-merge|land)/i.test(text)],
  ["generic gate names the leak scanner", () => /check-leak/.test(text)],
  ["per-target gate discovery (validate_command)", () => /validate_command/.test(text)],
  ["the wall routes target-specific down to /specialize", () => /the wall/i.test(text) && /\/specialize/.test(text)],
  ["human-validation quiz with a consistency-check", () => /human-validation/i.test(text) && /consistency-check/i.test(text)],
  ["maintainer-invoked only (not auto-discovered)", () => /disable-model-invocation\s*:\s*true/.test(text)],
  ["two fail-closed gates", () => /two[- ]gate|both\s+(?:gates|pass)|fail[- ]closed/i.test(text)],
];

test("roster-upgrade.md retains its load-bearing safety invariants (C3 self-upgrade guard)", () => {
  const missing = INVARIANTS.filter(([, ok]) => !ok()).map(([name]) => name);
  assert.deepStrictEqual(
    missing,
    [],
    `\n  /roster-upgrade dropped safety invariant(s):\n    - ${missing.join("\n    - ")}\n` +
      "  A self-edit (or any edit) that removes a gate, the wall, propose-only, or the quiz must NOT\n" +
      "  ship. Restore the clause, or if the removal is intentional, change this guard deliberately\n" +
      "  in a Full task with explicit human review of the Rules/gate diff (see the skill's\n" +
      "  'When to Go Back' self-edit row)."
  );
});

test("the skill file exists at the canonical path", () => {
  assert.ok(fs.existsSync(SKILL), `expected canonical skill at ${SKILL}`);
});
