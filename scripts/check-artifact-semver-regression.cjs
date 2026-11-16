#!/usr/bin/env node
"use strict";
// Standalone public regression: 0 pass, 1 assertion failure, 2 setup/runtime error.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
class SetupError extends Error {}
function acquire() {
  // Explicit test-only override supports acquisition/setup controls and scratch replay.
  const source = process.env.ROSTER_ARTIFACT_TEST_SOURCE_ROOT || path.resolve(__dirname, "..");
  try {
    const api = require(path.join(source, "scripts/roster-pipeline.cjs"));
    if (!["artifactList", "artifactRead", "artifactCapabilities"].every(key => typeof api[key] === "function")) throw Error("compatible implementation absent");
    return api;
  } catch (error) { throw new SetupError(error.message); }
}
function fixture() {
  let root;
  try {
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "artifact-semver-regression-"));
    fs.mkdirSync(path.join(root, ".harness/agents"), {recursive: true});
    fs.writeFileSync(path.join(root, ".harness/harness.json"), JSON.stringify({layers: {agents: [{name: "reviewer", version: "separate declaration"}]}}));
    return root;
  } catch (error) {
    if (root) { try { fs.rmSync(root, {recursive: true, force: true}); } catch {} }
    throw new SetupError(error.message);
  }
}
function inspectVersion(api, root, version, valid) {
  const definition = {name: "reviewer", display_name: "Reviewer", description: "Inert", model: "configured", domain: [], tags: [], compatible_with: [], complexity: "low", version};
  const body = "---\n" + JSON.stringify(definition) + "\n---\nINERT BODY";
  fs.writeFileSync(path.join(root, ".harness/agents/reviewer.md"), body);
  const item = api.artifactList({root, scope: "project"}).data.items[0];
  assert.equal(item.body.availability, "valid");
  assert.equal(api.artifactRead({root, scope: "project", ref: item.body.ref}).data.text, body);
  assert.equal(item.metadata.fields.definition.version, valid ? version : null, "complete SemVer: " + version);
  assert.equal(item.metadata.availability, valid ? "valid" : "invalid");
  assert.equal(item.metadata.issues.items.some(issue => issue.field === "version" && issue.reason === "wrong-type"), !valid);
  assert.equal(item.metadata.fields.declaration.version, "separate declaration");
  assert.equal(item.metadata.fields.definition.description, "Inert");
}
function run(api, root) {
  assert.equal(api.artifactCapabilities().kind, "artifact-capabilities");
  const valid = ["1.2.3", "0.0.0-0", "1.2.3-rc.0+build.01", "1.2.3+01", "123456789012345678901234567890.0.0"];
  const invalid = ["1.2.3-01", "1.2.3-.", "1.2.3-a..b", "1.2.3+.", "01.2.3", "1.2.3\n"];
  for (const version of valid) inspectVersion(api, root, version, true);
  for (const version of invalid) inspectVersion(api, root, version, false);
}
let root;
try {
  const api = acquire();
  root = fixture();
  run(api, root);
  console.log("PASS: complete SemVer and independent inert body/declaration");
} catch (error) {
  console.error(error.stack);
  process.exitCode = error instanceof assert.AssertionError || error?.code === "ERR_ASSERTION" ? 1 : 2;
} finally {
  if (root) {
    try { fs.rmSync(root, {recursive: true, force: true}); }
    catch (error) { console.error(error.message); if (process.exitCode !== 1) process.exitCode = 2; }
  }
}
