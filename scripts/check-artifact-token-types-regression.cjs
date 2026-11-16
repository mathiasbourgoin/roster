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
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "artifact-token-regression-"));
    fs.mkdirSync(path.join(root, "specs"));
    fs.mkdirSync(path.join(root, "briefs"));
    fs.writeFileSync(path.join(root, "specs/task.md"), "INERT REGRESSION BODY");
    fs.writeFileSync(path.join(root, "briefs/task-intake.md"), "INERT INTAKE CONTROL");
    return root;
  } catch (error) {
    if (root) { try { fs.rmSync(root, {recursive: true, force: true}); } catch {} }
    throw new SetupError(error.message);
  }
}
const encode = value => Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])))).toString("base64url");
const decode = value => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
function observeReads(artifacts, call) {
  const original = {open: fs.openSync, read: fs.readSync, close: fs.closeSync};
  const tracked = new Set();
  let bytes = 0, value, failure;
  try {
    fs.openSync = function(file, ...args) {
      const fd = original.open.call(fs, file, ...args);
      tracked.delete(fd);
      if (typeof file === "string" && artifacts.has(path.resolve(file))) tracked.add(fd);
      return fd;
    };
    fs.readSync = function(fd, ...args) {
      const count = original.read.call(fs, fd, ...args);
      if (tracked.has(fd)) bytes += count;
      return count;
    };
    fs.closeSync = function(fd, ...args) {
      try { return original.close.call(fs, fd, ...args); }
      finally { tracked.delete(fd); }
    };
    try { value = call(); } catch (error) { failure = error; }
  } finally {
    fs.openSync = original.open;
    fs.readSync = original.read;
    fs.closeSync = original.close;
  }
  return {bytes, value, failure};
}
function assertRefusal(api, artifacts, call, code) {
  const observed = observeReads(artifacts, call);
  assert.ok(observed.failure instanceof api.ObservationError, "typed public refusal");
  assert.equal(observed.failure.code, code);
  assert.equal(observed.bytes, 0, "malformed token consumes zero artifact bytes");
}
function checkRefHashes(api, artifacts, request) {
  for (const key of ["source_id", "sha256"]) {
    const value = decode(request.ref);
    for (const malformed of [[value[key]], {}, 42, true, null]) {
      const ref = encode({...value, [key]: malformed});
      assertRefusal(api, artifacts, () => api.artifactRead({...request, ref}), "invalid_reference");
    }
  }
}
function checkCursorHashes(api, artifacts, request, cursor, operation) {
  for (const key of ["source_id", "fingerprint"]) {
    const value = decode(cursor);
    for (const malformed of [[value[key]], {}, 42, true, null]) {
      const altered = encode({...value, [key]: malformed});
      const call = operation === "read" ? () => api.artifactRead({...request, cursor: altered}) : () => api.artifactList({root: request.root, scope: "task", task: "task", cursor: altered, limit: 1});
      assertRefusal(api, artifacts, call, "invalid_cursor");
    }
  }
}
function run(api, root) {
  assert.equal(api.artifactCapabilities().kind, "artifact-capabilities");
  const catalog = api.artifactList({root, scope: "task", task: "task", limit: 1});
  const request = {root, scope: "task", task: "task", ref: catalog.data.items[0].body.ref};
  const cursor = api.artifactRead({...request, pageBytes: 4}).data.next_cursor;
  const artifacts = new Set([path.join(root, "specs/task.md"), path.join(root, "briefs/task-intake.md")]);
  assert.ok(cursor);
  assert.ok(catalog.data.next_cursor);
  for (const call of [() => api.artifactRead({...request, cursor}), () => api.artifactList({root, scope: "task", task: "task", cursor: catalog.data.next_cursor, limit: 1})]) {
    const control = observeReads(artifacts, call);
    assert.equal(control.failure, undefined);
    assert.ok(control.bytes > 0, "valid controls exercise tracked artifact descriptors");
  }
  checkRefHashes(api, artifacts, request);
  checkCursorHashes(api, artifacts, request, cursor, "read");
  checkCursorHashes(api, artifacts, request, catalog.data.next_cursor, "list");
  const malformed = encode({...decode(cursor), fingerprint: [decode(cursor).fingerprint]});
  assertRefusal(api, artifacts, () => api.artifactRead({...request, task: "foreign", cursor: malformed}), "invalid_cursor");
}
let root;
try {
  const api = acquire();
  root = fixture();
  run(api, root);
  console.log("PASS: primitive token hashes, zero artifact bytes and valid controls");
} catch (error) {
  console.error(error.stack);
  process.exitCode = error instanceof assert.AssertionError || error?.code === "ERR_ASSERTION" ? 1 : 2;
} finally {
  if (root) {
    try { fs.rmSync(root, {recursive: true, force: true}); }
    catch (error) { console.error(error.message); if (process.exitCode !== 1) process.exitCode = 2; }
  }
}
