#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const CHECKS = new Set([
  "all",
  "audit-determinism",
  "recognition-boundary",
  "namespace-stability",
  "pairing-mutations",
  "identity-history",
  "closed-schema",
  "authority-boundary",
  "dependency-closure",
  "duplicate-imports",
  "canonical-digest",
  "projection-freshness",
  "offline-context",
  "neutral-manifest",
  "workflow-compatibility",
]);

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !CHECKS.has(argv[0])) {
    process.stderr.write(`usage: node scripts/claims-reconcile-check.js <${[...CHECKS].join("|")}>\n`);
    return 2;
  }
  const testFile = path.join(__dirname, "claims-reconcile.test.js");
  const testArguments = argv[0] === "all"
    ? ["--test", testFile]
    : ["--test", "--test-name-pattern", `\\[${argv[0]}\\]`, testFile];
  const result = spawnSync(process.execPath, testArguments, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
  });
  return result.error ? 2 : result.status === null ? 2 : result.status;
}

if (require.main === module) process.exitCode = main();

module.exports = { CHECKS, main };
