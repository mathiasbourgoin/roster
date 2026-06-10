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

// Each invariant: a human-readable name + a predicate factory (receives the text to test).
// Using a factory (t) => bool instead of a closure over `text` lets the negative test reuse
// the SAME predicate array against a different fixture — no hand-written duplicate predicates.
const INVARIANTS = [
  ["propose-only (never auto-merge/land)", (t) => /propose[- ]only/i.test(t) && /never\s+(?:auto-merge|land)/i.test(t)],
  ["generic gate names the leak scanner", (t) => /check-leak/.test(t)],
  ["per-target gate discovery (validate_command)", (t) => /validate_command/.test(t)],
  ["the wall routes target-specific down to /specialize", (t) => /the wall/i.test(t) && /\/specialize/.test(t)],
  ["human-validation quiz with a consistency-check", (t) => /human-validation/i.test(t) && /consistency-check/i.test(t)],
  ["maintainer-invoked only (not auto-discovered)", (t) => /disable-model-invocation\s*:\s*true/.test(t)],
  ["two fail-closed gates", (t) => /two[- ]gate|both\s+(?:gates|pass)|fail[- ]closed/i.test(t)],
];

test("roster-upgrade.md retains its load-bearing safety invariants (C3 self-upgrade guard)", () => {
  const missing = INVARIANTS.filter(([, ok]) => !ok(text)).map(([name]) => name);
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

test("invariant test rejects a weakened fixture (mechanism prose stripped)", () => {
  // A fixture that keeps high-level framing but strips critical mechanism prose.
  // Specifically: drops `disable-model-invocation: true`, `validate_command`, `the wall /specialize`,
  // and `two-gate` / `fail-closed`. The invariants MUST fail on this — proving CI would catch a
  // self-edit that deletes safety clauses while keeping surface-level wording.
  const weakened = [
    "---",
    "name: roster-upgrade",
    "version: 1.0.0",
    "---",
    "# Roster Upgrade",
    "This skill is propose-only — it never auto-merges or lands changes directly.",
    "It runs check-leak as a safety scan.",
    "A human-validation quiz includes a consistency-check question.",
    "Framing mentions safety but strips concrete mechanism identifiers.",
  ].join("\n");

  // Reuse the real INVARIANTS array — if INVARIANTS changes, this test automatically
  // validates against the updated predicates without needing a manual duplicate update.
  const failing = INVARIANTS.filter(([, ok]) => !ok(weakened)).map(([name]) => name);
  assert.ok(
    failing.length > 0,
    "Weakened fixture should fail at least one invariant — if all pass, the guard is keyword-only " +
      "and cannot detect a real weakening. Tighten the invariant predicates so stripped mechanism prose " +
      "is caught."
  );
});
