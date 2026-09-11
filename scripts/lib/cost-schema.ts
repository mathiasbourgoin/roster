/**
 * Zero-dependency, fail-closed JSON-Schema-subset interpreter for
 * schema/cost-snapshot.schema.json. Mirrors the design of the repo's earlier
 * hand-rolled finding-schema interpreter (schema/review-finding.schema.json,
 * now removed) rather than pulling in ajv: a small, auditable subset is
 * compiled once and thrown on the FIRST unsupported keyword it meets — schema
 * drift (someone adding a keyword this interpreter doesn't implement) is a
 * hard compile-time failure, never a silently-ignored validation gap.
 *
 * Supported keywords: type, enum, required, properties, additionalProperties,
 * items, description ($schema/$id/title/description are metadata, ignored).
 * Anything else (patternProperties, oneOf, allOf, $ref, minimum, format, …)
 * throws at compile() time.
 */

type JsonSchema = Record<string, unknown>;

const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
]);

export class SchemaCompileError extends Error {}
export class SchemaValidationError extends Error {}

/** Throws SchemaCompileError on any keyword this interpreter does not implement. */
function assertSupported(schema: JsonSchema, path: string): void {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new SchemaCompileError(
        `unsupported schema keyword "${key}" at ${path || "<root>"} — this is a zero-dependency ` +
          `interpreter with a fixed supported subset; extend scripts/lib/cost-schema.ts or drop the keyword.`
      );
    }
  }
  if ("properties" in schema) {
    const props = schema.properties as Record<string, JsonSchema>;
    for (const [name, sub] of Object.entries(props)) assertSupported(sub, `${path}.${name}`);
  }
  if ("items" in schema) {
    assertSupported(schema.items as JsonSchema, `${path}[]`);
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

/** Validate `value` against `schema`; pushes human-readable messages into `errors`. */
function validateValue(value: unknown, schema: JsonSchema, path: string, errors: string[]): void {
  if ("type" in schema) {
    const expected = schema.type;
    const expectedList = Array.isArray(expected) ? (expected as string[]) : [expected as string];
    if (!expectedList.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected type ${expectedList.join("|")}, got ${typeOf(value)}`);
      return;
    }
  }

  if ("enum" in schema) {
    const allowed = schema.enum as unknown[];
    if (!allowed.some((a) => a === value)) {
      errors.push(`${path}: value ${JSON.stringify(value)} is not one of ${JSON.stringify(allowed)}`);
    }
  }

  if (typeOf(value) === "object" && "properties" in schema) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties as Record<string, JsonSchema>) ?? {};
    const required = (schema.required as string[]) ?? [];

    for (const key of required) {
      if (!(key in obj)) errors.push(`${path}: missing required key "${key}"`);
    }

    const additionalProperties = schema.additionalProperties;
    if (additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push(`${path}: unknown key "${key}" (additionalProperties: false)`);
      }
    }

    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) validateValue(obj[key], sub, `${path}.${key}`, errors);
    }
  }

  if (typeOf(value) === "array" && "items" in schema) {
    const arr = value as unknown[];
    arr.forEach((item, i) => validateValue(item, schema.items as JsonSchema, `${path}[${i}]`, errors));
  }
}

export interface CompiledSchema {
  validate(value: unknown): string[]; // returns error messages; empty = valid
}

/** Compile a schema. Throws SchemaCompileError if it uses an unsupported keyword. */
export function compileSchema(schema: JsonSchema): CompiledSchema {
  assertSupported(schema, "");
  return {
    validate(value: unknown): string[] {
      const errors: string[] = [];
      validateValue(value, schema, "$", errors);
      return errors;
    },
  };
}
