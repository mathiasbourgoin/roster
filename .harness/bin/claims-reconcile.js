#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  ClaimsError,
  NEUTRAL_MANIFEST_SCHEMA,
  audit,
  buildContextManifest,
  buildModel,
  checkFreshness,
  project,
  stableStringify,
  validateNeutralManifest,
} = require("./lib/claims-reconcile");

const COMMANDS = new Set(["audit", "validate", "extract", "project", "check", "context", "manifest-neutral"]);
const VALUE_OPTIONS = new Set(["--root", "--output-dir", "--budget", "--embeddings", "--candidates"]);

function usage() {
  return [
    "usage: node scripts/claims-reconcile.js <command> [options]",
    "commands: audit, validate, extract, project, check, context, manifest-neutral <path>",
    "options: --root <dir> --output-dir <dir> --budget <n>",
    "context: --embeddings enabled|disabled [--candidates <json>]",
    `neutral manifest schema: ${JSON.stringify(NEUTRAL_MANIFEST_SCHEMA)}`,
    "authority gate: validates the separate map; does not attest Git reviewer identity",
  ].join("\n");
}

function parseArguments(argv) {
  const command = argv[0];
  if (!COMMANDS.has(command)) throw Object.assign(new Error(usage()), { usage: true });
  if (command === "manifest-neutral") {
    if (argv.length !== 2 || argv[1].startsWith("--")) throw Object.assign(new Error(usage()), { usage: true });
    return { command, manifest: argv[1], options: {} };
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!VALUE_OPTIONS.has(flag) || value === undefined) throw Object.assign(new Error(usage()), { usage: true });
    if (Object.hasOwn(values, flag)) throw Object.assign(new Error(`duplicate option ${flag}\n${usage()}`), { usage: true });
    values[flag] = value;
  }
  const root = path.resolve(values["--root"] || process.cwd());
  const budget = values["--budget"] === undefined ? undefined : Number(values["--budget"]);
  if (budget !== undefined && (!Number.isInteger(budget) || budget <= 0)) throw new ClaimsError("invalid-budget", "--budget must be a positive integer");
  if (values["--embeddings"] !== undefined && !["enabled", "disabled"].includes(values["--embeddings"])) {
    throw new ClaimsError("invalid-embeddings-mode", "--embeddings must be enabled or disabled");
  }
  return {
    command,
    options: {
      root,
      outputDir: values["--output-dir"],
      budget,
      embeddings: values["--embeddings"],
      candidates: values["--candidates"],
    },
  };
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch (error) {
    throw new ClaimsError("malformed-json", `${label} is unavailable or invalid JSON: ${error.message}`);
  }
}

function modelOptions(options) {
  return {
    outputDir: options.outputDir,
    budget: options.budget,
  };
}

function run(parsed) {
  if (parsed.command === "manifest-neutral") return validateNeutralManifest(readJson(parsed.manifest, "neutral manifest"));
  const { root } = parsed.options;
  const options = modelOptions(parsed.options);
  if (parsed.command === "audit") return audit(root);
  if (parsed.command === "validate") {
    const state = buildModel(root, options);
    return { valid: true, managed_documents: state.managed_documents, claims: state.model.claims.length, model_digest: state.model_digest };
  }
  if (parsed.command === "extract") return buildModel(root, options).model;
  if (parsed.command === "project") return project(root, options);
  if (parsed.command === "check") return checkFreshness(root, options);
  const state = buildModel(root, options);
  const candidates = parsed.options.candidates ? readJson(parsed.options.candidates, "candidate manifest") : [];
  if (!Array.isArray(candidates)) throw new ClaimsError("invalid-candidates", "candidate manifest must be a JSON array");
  return buildContextManifest(state, { embeddingsEnabled: parsed.options.embeddings !== "disabled", candidates });
}

function main(argv = process.argv.slice(2)) {
  try {
    const parsed = parseArguments(argv);
    const result = run(parsed);
    process.stdout.write(stableStringify(result, true));
    if (parsed.command === "check" && !result.fresh) process.exitCode = 1;
  } catch (error) {
    if (error.usage) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 64;
      return;
    }
    const reason = error instanceof ClaimsError ? error.reason : "internal-error";
    process.stderr.write(stableStringify({ error: { reason, message: error.message, details: error.details || null } }, true));
    process.exitCode = error instanceof ClaimsError ? 2 : 70;
  }
}

if (require.main === module) main();

module.exports = { main, parseArguments, run };
