#!/usr/bin/env node
// check-cwr-templates.js — CommonJS
// Validates CWR template files: JSON validity + expected step sequences.
"use strict";

const { readFileSync, readdirSync } = require("fs");

let failed = false;

const TEMPLATES_DIR = "workflows/templates";

const EXPECTED_STEPS = {
  "critical.cwr.json": ["roster-implement", "roster-formal-verify", "roster-review", "roster-ship"],
  "full.cwr.json": ["roster-implement", "roster-review", "roster-qa", "roster-ship"],
  "fast.cwr.json": ["roster-implement", "roster-review", "roster-qa", "roster-ship"],
  "express.cwr.json": ["roster-implement", "roster-review", "roster-ship"],
};

// 1. All template files must be valid JSON
let files;
try {
  files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".cwr.json"));
} catch {
  console.error(`✗ cwr-templates: ${TEMPLATES_DIR}/ not found`);
  process.exit(1);
}

for (const file of files) {
  try {
    JSON.parse(readFileSync(`${TEMPLATES_DIR}/${file}`, "utf8"));
    console.log(`✓ cwr-templates: ${file} is valid JSON`);
  } catch (e) {
    console.error(`✗ cwr-templates: ${file} invalid JSON — ${e.message}`);
    failed = true;
  }
}

// 2. Known templates must have the expected step ID sequences
for (const [file, expectedIds] of Object.entries(EXPECTED_STEPS)) {
  const path = `${TEMPLATES_DIR}/${file}`;
  let tmpl;
  try {
    tmpl = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.error(`✗ cwr-templates: ${file} not found or unreadable`);
    failed = true;
    continue;
  }
  const actual = (tmpl.steps ?? []).map((s) => s.id);
  const match =
    actual.length === expectedIds.length && actual.every((id, i) => id === expectedIds[i]);
  if (match) {
    console.log(`✓ cwr-templates: ${file} step sequence correct (${actual.join("→")})`);
  } else {
    console.error(
      `✗ cwr-templates: ${file} step sequence wrong\n  expected: ${expectedIds.join("→")}\n  actual:   ${actual.join("→")}`
    );
    failed = true;
  }
}

if (failed) process.exit(1);
