// Contract test for schema/review-finding.schema.json + scripts/lib/finding-schema.js
// (spec: specs/review-skill-slimming.md FR-109/110, D-4). Verifies: the schema compiles,
// canonical valid fixtures pass, canonical invalid fixtures fail with a reason, and the
// interpreter fails closed on an unsupported keyword.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { compile, loadFindingSchema } = require("./lib/review/finding-schema");

const SCHEMA_PATH = path.resolve(__dirname, "..", "schema", "review-finding.schema.json");

function validFinding(overrides) {
  return Object.assign(
    {
      severity: "HIGH",
      confidence: 4,
      path: "lib/foo.ml",
      line: 42,
      category: "correctness",
      summary: "Off-by-one in loop bound",
      evidence: "lib/foo.ml:42 — `i <= len` should be `i < len`",
      fix: "Change `<=` to `<`",
      fingerprint: "lib/foo.ml:42:correctness",
      specialist: "reviewer",
    },
    overrides
  );
}

test("schema/review-finding.schema.json requires the schema file and it parses as JSON", () => {
  const schema = require(SCHEMA_PATH);
  assert.strictEqual(schema.type, "object");
  assert.ok(Array.isArray(schema.required));
});

test("compile() succeeds against the real finding schema (compiles)", () => {
  assert.doesNotThrow(() => loadFindingSchema());
});

test("canonical valid fixture passes", () => {
  const validator = loadFindingSchema();
  const { valid, errors } = validator.validate(validFinding());
  assert.strictEqual(valid, true, JSON.stringify(errors));
});

test("null line is accepted (nullable per EC-6)", () => {
  const validator = loadFindingSchema();
  const { valid } = validator.validate(validFinding({ line: null }));
  assert.strictEqual(valid, true);
});

test("cross-runtime specialist naming passes (no enum constraint on specialist)", () => {
  const validator = loadFindingSchema();
  const { valid } = validator.validate(validFinding({ specialist: "codex-xruntime" }));
  assert.strictEqual(valid, true);
});

test("canonical invalid fixture fails: missing required field", () => {
  const validator = loadFindingSchema();
  const bad = validFinding();
  delete bad.evidence;
  const { valid, errors } = validator.validate(bad);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("evidence")));
});

test("canonical invalid fixture fails: bad severity enum value", () => {
  const validator = loadFindingSchema();
  const bad = validFinding({ severity: "URGENT" });
  const { valid, errors } = validator.validate(bad);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("enum")));
});

test("canonical invalid fixture fails: wrong type for confidence", () => {
  const validator = loadFindingSchema();
  const bad = validFinding({ confidence: "high" });
  const { valid, errors } = validator.validate(bad);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("confidence")));
});

test("interpreter fails closed on an unsupported schema keyword (D-4)", () => {
  assert.throws(() => compile({ type: "object", minLength: 3 }), /unsupported schema keyword/);
});

test("compile rejects non-object schema nodes, including nested nodes", () => {
  for (const node of [null, true, false, [], ["string"], "string", 0]) {
    assert.throws(() => compile(node), /schema/i, `root ${JSON.stringify(node)}`);
    assert.throws(() => compile({ properties: { field: node } }), /schema/i, `property ${JSON.stringify(node)}`);
    assert.throws(() => compile({ items: node }), /schema/i, `items ${JSON.stringify(node)}`);
  }
});

test("compile rejects malformed supported keyword values before validation", () => {
  const malformed = [
    { type: "unknown" }, { type: [] }, { type: ["string", "string"] },
    { type: ["string", "unknown"] }, { type: ["string", null] }, { type: null }, { type: Array(1) },
    { required: "field" }, { required: ["field", "field"] }, { required: [42] }, { required: Array(1) },
    { properties: [] }, { properties: null }, { properties: "field" },
    { items: [{ type: "string" }] }, { additionalProperties: {} },
    { enum: [] }, { enum: "value" }, { enum: ["same", "same"] },
    { enum: [0, -0] }, { enum: [NaN] }, { enum: [Infinity] },
    { enum: [undefined] }, { enum: [{}] }, { enum: [[]] }, { enum: Array(1) },
    { title: false }, { description: [] }, { $schema: 7 },
    { properties: { nested: { type: "not-a-json-schema-type" } } },
    { items: { properties: { nested: { required: false } } } },
  ];
  for (const schema of malformed) assert.throws(() => compile(schema), /schema/i, JSON.stringify(schema));
});

test("supported empty and primitive schema controls retain their behavior", () => {
  const empty = compile({});
  for (const value of [null, false, 0, "text", [], {}]) assert.strictEqual(empty.validate(value).valid, true);
  const primitives = compile({ enum: [null, false, true, 0, "0"] });
  for (const value of [null, false, true, 0, "0"]) assert.strictEqual(primitives.validate(value).valid, true);
  assert.strictEqual(primitives.validate("other").valid, false);
  const nullable = compile({ type: ["object", "null"], required: [], properties: {}, additionalProperties: true });
  assert.strictEqual(nullable.validate({ extra: 1 }).valid, true); assert.strictEqual(nullable.validate(null).valid, true);
  assert.doesNotThrow(() => compile({ items: {} }));
  for (const name of ["review-finding.schema.json", "qa-state.schema.json", "review-trace.schema.json"])
    assert.doesNotThrow(() => compile(require(path.resolve(__dirname, "..", "schema", name))), name);
});

test("additionalProperties false is enforced even without other object keywords", () => {
  const validator = compile({ additionalProperties: false });
  assert.strictEqual(validator.validate({}).valid, true);
  assert.strictEqual(validator.validate({ unexpected: true }).valid, false);
});

test("additionalProperties: false rejects unknown keys when set", () => {
  const validator = compile({
    type: "object",
    required: ["a"],
    properties: { a: { type: "string" } },
    additionalProperties: false,
  });
  const { valid, errors } = validator.validate({ a: "x", b: "y" });
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("additional property")));
});

test("posture: the canonical finding schema is closed (additionalProperties: false) — a future edit cannot silently flip it open", () => {
  const schema = require(SCHEMA_PATH);
  assert.strictEqual(schema.additionalProperties, false);
});

test("posture: all known optional fields (ratchet fields, convergence, fingerprint_v2, acs) remain valid under the closed schema", () => {
  const validator = loadFindingSchema();
  const finding = validFinding({
    status: "RESOLVED",
    boundary: "custody",
    invariant: "no-double-spend",
    failure_mode: "silent-drop",
    acs: ["AC-1", "FR-042"],
    convergence: ["reviewer", "architect"],
    fingerprint_v2: "custody|no-double-spend|silent-drop",
    first_seen_round: 1,
    resolved_round: 2,
    check: "checks/foo.test.js",
    check_encodable: true,
    red_verified: true,
    pre_fix_sha: "a".repeat(40),
    check_blob: "b".repeat(40),
  });
  const { valid, errors } = validator.validate(finding);
  assert.strictEqual(valid, true, JSON.stringify(errors));
});

test("posture: an unknown/unexpected property is rejected under the closed schema", () => {
  const validator = loadFindingSchema();
  const { valid, errors } = validator.validate(validFinding({ totally_unexpected_field: "x" }));
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("additional property")));
});

// ── FIX-C (CGF-7, CHECK-4): schema stays permissive on status ────────────

test("FIX-C: a finding object omitting status validates against the schema", () => {
  const validator = loadFindingSchema();
  const bad = validFinding();
  delete bad.status;
  const { valid, errors } = validator.validate(bad);
  assert.strictEqual(valid, true, JSON.stringify(errors));
});

test("FIX-C: status is absent from the schema's required array (normalizer defaults it instead)", () => {
  const schema = require(SCHEMA_PATH);
  assert.ok(!schema.required.includes("status"));
});
