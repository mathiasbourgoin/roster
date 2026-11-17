#!/usr/bin/env node
"use strict";
const fs = require("fs");
const root = process.cwd();
const text = fs.readFileSync(`${root}/skills/pipeline/roster-implement.md`, "utf8");
const required = [
  "run the narrowest declared check that covers this unit",
  "Do not repeat the full build/test/lint suite per unit",
  "If no narrower declared check covers the",
  "run the complete declared build, test, and format/lint gates once after the final edit",
  "review and QA still execute their independent checks",
  "avoided_repeated_full_gate_runs",
];
const missing = required.filter((needle) => !text.includes(needle));
if (missing.length) { console.error(`fast optimization contract missing: ${missing.join("; ")}`); process.exit(1); }
console.log("fast optimization contract: ok");
