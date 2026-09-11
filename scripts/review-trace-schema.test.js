// Contract test for schema/review-trace.schema.json + scripts/lib/review/finding-schema.js
// (spec: specs/r5-trace-enforcement.md FR-160/161, US-1). Verifies: the schema compiles under
// the zero-dep interpreter, a conforming line validates, and out-of-enum/missing-required
// lines are rejected with a field-path error — never a silent accept (AC-1, CHECK-1).
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { compile } = require("./lib/review/finding-schema");

const SCHEMA_PATH = path.resolve(__dirname, "..", "schema", "review-trace.schema.json");

function validLine(overrides) {
  return Object.assign(
    {
      schema_version: "1.0",
      ts: "2026-07-13T10:00:00Z",
      task: "demo-task",
      round: 1,
      cycle: 1,
      event: "normalizer",
      actor: "review-normalize.js",
      outcome: "ran",
    },
    overrides
  );
}

test("schema/review-trace.schema.json requires the schema file and it parses as JSON", () => {
  const schema = require(SCHEMA_PATH);
  assert.strictEqual(schema.type, "object");
  assert.ok(Array.isArray(schema.required));
});

test("compile() succeeds against the real trace schema (compiles without throwing, AC-1)", () => {
  assert.doesNotThrow(() => compile(require(SCHEMA_PATH)));
});

test("compile() throwing would fail this suite immediately (posture: the six-keyword-subset assertion is compile()'s job, exercised above — no unsupported keyword like 'minimum'/'pattern'/'oneOf'/'$ref' is present)", () => {
  const schema = require(SCHEMA_PATH);
  assert.doesNotThrow(() => compile(schema));
});

test("FR-161 example line (spec US-1 AS-2) validates", () => {
  const validator = compile(require(SCHEMA_PATH));
  const line = {
    schema_version: "1.0",
    ts: "2026-07-13T10:00:00Z",
    task: "demo-task",
    round: 1,
    cycle: 1,
    event: "normalizer",
    actor: "review-normalize.js",
    outcome: "ran",
  };
  const { valid, errors } = validator.validate(line);
  assert.strictEqual(valid, true, JSON.stringify(errors));
});

test("conforming line with optional detail/digest validates", () => {
  const validator = compile(require(SCHEMA_PATH));
  const { valid, errors } = validator.validate(
    validLine({ detail: "no-manifest", digest: "abc123" })
  );
  assert.strictEqual(valid, true, JSON.stringify(errors));
});

test("out-of-enum event ('coffee-break') is rejected with a field-path error (US-1 AS-3)", () => {
  const validator = compile(require(SCHEMA_PATH));
  const { valid, errors } = validator.validate(validLine({ event: "coffee-break" }));
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("event")));
});

test("missing event key is rejected (US-1 AS-3)", () => {
  const validator = compile(require(SCHEMA_PATH));
  const bad = validLine();
  delete bad.event;
  const { valid, errors } = validator.validate(bad);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("event")));
});

test("missing any other required field is rejected", () => {
  const validator = compile(require(SCHEMA_PATH));
  for (const key of ["schema_version", "ts", "task", "round", "cycle", "actor", "outcome"]) {
    const bad = validLine();
    delete bad[key];
    const { valid, errors } = validator.validate(bad);
    assert.strictEqual(valid, false, `expected missing ${key} to fail`);
    assert.ok(errors.some((e) => e.includes(key)), `expected error mentioning ${key}, got ${JSON.stringify(errors)}`);
  }
});

test("bad schema_version value is rejected (only '1.0' supported)", () => {
  const validator = compile(require(SCHEMA_PATH));
  const { valid } = validator.validate(validLine({ schema_version: "2.0" }));
  assert.strictEqual(valid, false);
});

test("bad outcome value is rejected", () => {
  const validator = compile(require(SCHEMA_PATH));
  const { valid } = validator.validate(validLine({ outcome: "maybe" }));
  assert.strictEqual(valid, false);
});

test("unexpected additional property is rejected (additionalProperties: false)", () => {
  const validator = compile(require(SCHEMA_PATH));
  const { valid, errors } = validator.validate(validLine({ totally_unexpected_field: "x" }));
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("additional property")));
});

test("round/cycle must be integers, not strings", () => {
  const validator = compile(require(SCHEMA_PATH));
  const { valid } = validator.validate(validLine({ round: "1" }));
  assert.strictEqual(valid, false);
});
