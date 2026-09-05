"use strict";

const SCHEMA_VERSION = 1;
const MODEL_VERSION = 1;
const RENDERER_VERSION = "1.2";
const SELECTION_POLICY_VERSION = "1.2";
const DEFAULT_CLOSURE_BUDGET = 10000;
const AUTHORITY_REL = "specs/claims-authority.json";
const LOCK_REL = "specs/claims.lock";

const RECORD_DEFINITIONS = new Map([
  ["requirement", { heading: "Functional Requirements", id: /^FR-\d{3}$/ }],
  ["acceptance-criterion", { heading: "Acceptance Criteria", id: /^AC-\d+$/ }],
  ["check", { heading: "Runnable Checks", id: /^CHECK-\d+$/ }],
  ["decision", { heading: "Decisions", id: /^(?:D|DEC)-\d+$/ }],
  ["term", { heading: "Terms", id: /^TERM-\d+$/ }],
  ["risk", { heading: "Risks", id: /^RISK-\d+$/ }],
  ["invariant", { heading: "Invariants", id: /^INV-\d+$/ }],
]);
const RECORD_TYPES = new Set(["claims-header", ...RECORD_DEFINITIONS.keys(), "import"]);
const HEADING_TYPES = new Map([...RECORD_DEFINITIONS].map(([record, definition]) => [definition.heading, record]));
const NORMATIVE_TYPES = new Set(RECORD_DEFINITIONS.keys());
const LIFECYCLES = new Set(["draft", "pending-confirmation", "active", "superseded", "retired"]);
const SET_ARRAY_KEYS = new Set([
  "claims",
  "components",
  "depends_on",
  "domains",
  "external_sources",
  "for",
  "incompatible_with",
  "mandatory_claims",
  "repositories",
  "sources",
  "technical_ids",
]);
const TIMESTAMP_KEYS = new Set(["date", "timestamp", "created_at", "updated_at", "generated_at", "installed_at"]);
const NAMESPACE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const IMPORT_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const IMMUTABLE_REVISION_RE = /^[a-f0-9]{40,64}$/;
const BASE_CLAIM_FIELDS = new Set([
  "record",
  "id",
  "lifecycle",
  "external_sources",
  "depends_on",
  "incompatible_with",
  "components",
  "domains",
  "repositories",
  "superseded_by",
]);
const FORBIDDEN_CONTENT_FIELDS = new Set(["statement", "command", "command_ref", "verification", "authority"]);
const NEUTRAL_MANIFEST_SCHEMA = Object.freeze({
  questions: "array of non-empty strings",
  technical_ids: "array of non-empty strings",
  digests: "object mapping non-empty names to lowercase SHA-256 strings",
});

module.exports = {
  AUTHORITY_REL,
  BASE_CLAIM_FIELDS,
  DEFAULT_CLOSURE_BUDGET,
  FORBIDDEN_CONTENT_FIELDS,
  HEADING_TYPES,
  IMMUTABLE_REVISION_RE,
  IMPORT_ID_RE,
  LIFECYCLES,
  LOCK_REL,
  MODEL_VERSION,
  NAMESPACE_RE,
  NEUTRAL_MANIFEST_SCHEMA,
  NORMATIVE_TYPES,
  RECORD_DEFINITIONS,
  RECORD_TYPES,
  RENDERER_VERSION,
  SCHEMA_VERSION,
  SELECTION_POLICY_VERSION,
  SET_ARRAY_KEYS,
  SHA256_RE,
  TIMESTAMP_KEYS,
};
