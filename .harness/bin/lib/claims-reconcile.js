"use strict";

const {
  AUTHORITY_REL,
  DEFAULT_CLOSURE_BUDGET,
  LOCK_REL,
  MODEL_VERSION,
  NEUTRAL_MANIFEST_SCHEMA,
  RECORD_TYPES,
  RENDERER_VERSION,
  SCHEMA_VERSION,
  SELECTION_POLICY_VERSION,
} = require("./claims-reconcile/constants");
const {
  ClaimsError,
  canonicalize,
  digest,
  stableStringify,
} = require("./claims-reconcile/core");
const {
  candidateNamespace,
  isQualifiedId,
  parseMarkdown,
} = require("./claims-reconcile/schema");
const { audit } = require("./claims-reconcile/audit");
const { buildModel } = require("./claims-reconcile/model");
const {
  checkFreshness,
  extractTaggedFences,
  freshness,
  project,
  renderProjections,
  writeAtomicSet,
} = require("./claims-reconcile/projection");
const {
  buildContextManifest,
  validateNeutralManifest,
} = require("./claims-reconcile/manifests");

module.exports = {
  AUTHORITY_REL,
  ClaimsError,
  DEFAULT_CLOSURE_BUDGET,
  LOCK_REL,
  MODEL_VERSION,
  NEUTRAL_MANIFEST_SCHEMA,
  RECORD_TYPES,
  RENDERER_VERSION,
  SCHEMA_VERSION,
  SELECTION_POLICY_VERSION,
  audit,
  buildContextManifest,
  buildModel,
  candidateNamespace,
  canonicalize,
  checkFreshness,
  digest,
  extractTaggedFences,
  freshness,
  isQualifiedId,
  parseMarkdown,
  project,
  renderProjections,
  stableStringify,
  validateNeutralManifest,
  writeAtomicSet,
};
