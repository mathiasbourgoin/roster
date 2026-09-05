"use strict";

const {
  NEUTRAL_MANIFEST_SCHEMA,
  SCHEMA_VERSION,
  SHA256_RE,
} = require("./constants");
const {
  assertClosedObject,
  canonicalize,
  digest,
  fail,
  isObject,
} = require("./core");
const { validateStringArray } = require("./schema");
const { freshness } = require("./projection");

function validateNeutralManifest(value) {
  assertClosedObject(value, new Set(Object.keys(NEUTRAL_MANIFEST_SCHEMA)), "neutral manifest");
  validateStringArray(value.questions, "neutral manifest questions", true);
  validateStringArray(value.technical_ids, "neutral manifest technical_ids", true);
  if (!isObject(value.digests)) fail("invalid-neutral-manifest", "neutral manifest digests must be an object");
  for (const [name, valueDigest] of Object.entries(value.digests)) {
    if (name.length === 0 || typeof valueDigest !== "string" || !SHA256_RE.test(valueDigest)) {
      fail("invalid-neutral-manifest", `invalid neutral manifest digest: ${name}`);
    }
  }
  if (value.digests.questions !== digest(value.questions)) {
    fail("neutral-digest-mismatch", "neutral manifest digests.questions must attest the canonical questions array");
  }
  return canonicalize(value);
}

function buildContextManifest(state, options = {}) {
  const context = {
    schema_version: SCHEMA_VERSION,
    model_digest: state.model_digest,
    freshness_digest: freshness(state).digest,
    mandatory_claims: state.model.claims
      .filter((claim) => claim.lifecycle === "active" || claim.lifecycle === "pending-confirmation")
      .map((claim) => claim.qualified_id),
    sources: [...new Set(state.model.claims.map((claim) => claim.source_path).filter(Boolean))],
  };
  if (options.embeddingsEnabled !== false) {
    context.candidates = (options.candidates || []).map((candidate) => ({ ...candidate, evidence: false, kind: "hint" }));
  }
  return canonicalize(context);
}

module.exports = { buildContextManifest, validateNeutralManifest };
