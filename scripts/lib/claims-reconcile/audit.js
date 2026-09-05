"use strict";

const fs = require("node:fs");
const {
  AUTHORITY_REL,
  NORMATIVE_TYPES,
  SCHEMA_VERSION,
} = require("./constants");
const {
  canonicalize,
  compareLexical,
  readJsonFile,
  relativePosix,
  resolveControlledPath,
} = require("./core");
const { validateAuthority } = require("./model");
const {
  candidateNamespace,
  migrationLifecycle,
  parseFrontmatterStatus,
  parseMarkdown,
  sourceDocuments,
  validateLocalDocument,
} = require("./schema");

function emptyCounts() {
  return {
    requirement: 0,
    "acceptance-criterion": 0,
    check: 0,
    decision: 0,
    term: 0,
    risk: 0,
    invariant: 0,
  };
}

function countNormative(normative) {
  const counts = emptyCounts();
  for (const item of normative) counts[item.record] += 1;
  return counts;
}

function hasIndependentSource(claim) {
  const anchors = new Set([
    claim.qualified_id,
    claim.source_path,
    `${claim.source_path}#L${claim.source_line}`,
    `${claim.source_path}#${claim.id}`,
  ]);
  return claim.external_sources.some((source) => !anchors.has(source.uri));
}

function hasRequiredAuthority(document, authorities) {
  if (!authorities) return false;
  const entry = authorities[document.header.namespace];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const activeTypes = new Set(document.claims.filter((claim) => claim.lifecycle === "active").map((claim) => claim.record));
  return activeTypes.size > 0 && [...activeTypes].every((record) => typeof entry[record] === "string" && entry[record].trim() !== "");
}

function auditManagedDocument(document, authorities) {
  const active = document.header.spec_lifecycle === "active" && hasRequiredAuthority(document, authorities);
  return {
    namespace: active ? document.header.namespace : null,
    candidateNamespace: active ? null : document.header.namespace,
    candidateQualifiedIds: active ? null : document.claims.map((claim) => claim.qualified_id).sort(compareLexical),
    candidateRecords: null,
    statusMapping: null,
    lifecycleCovered: document.claims.filter((claim) => NORMATIVE_TYPES.has(claim.record)).length,
    independentSourceCovered: document.claims.filter(hasIndependentSource).length,
    dependencyCovered: document.claims.filter((claim) => claim.depends_on.length > 0 || claim.for.length > 0).length,
    residualStatuses: 0,
  };
}

function candidateRecord(item) {
  return {
    record: item.record,
    id: item.id,
    ...(item.record === "requirement" ? { depends_on: [], external_sources: [] } : {}),
    ...(item.record === "acceptance-criterion" || item.record === "check" ? { for: [] } : {}),
  };
}

function auditLegacyDocument(content, parsed, candidate) {
  const originalStatus = parseFrontmatterStatus(content);
  const migration = migrationLifecycle(originalStatus);
  return {
    namespace: null,
    candidateNamespace: candidate,
    candidateQualifiedIds: parsed.normative.map((item) => `${candidate}/${item.id}`).sort(),
    candidateRecords: [
      { record: "claims-header", schema_version: SCHEMA_VERSION, namespace: candidate, spec_lifecycle: migration.lifecycle },
      ...parsed.normative.map(candidateRecord),
    ],
    statusMapping: { original: originalStatus, candidate: migration.lifecycle, residual: migration.residual },
    lifecycleCovered: 0,
    independentSourceCovered: 0,
    dependencyCovered: 0,
    residualStatuses: migration.residual ? parsed.normative.length : 0,
  };
}

function auditDocument(root, file, authorities) {
  const rel = relativePosix(root, file);
  const content = fs.readFileSync(file, "utf8");
  const parsed = parseMarkdown(content, rel);
  const candidate = candidateNamespace(file);
  let details = emptyAuditDetails();
  if (parsed.claimsBlock) details = auditManagedDocument(validateLocalDocument(parsed, rel), authorities);
  else if (parsed.normative.length > 0) details = auditLegacyDocument(content, parsed, candidate);
  return { rel, parsed, counts: countNormative(parsed.normative), details };
}

function emptyAuditDetails() {
  return {
    namespace: null,
    candidateNamespace: null,
    candidateQualifiedIds: null,
    candidateRecords: null,
    statusMapping: null,
    lifecycleCovered: 0,
    independentSourceCovered: 0,
    dependencyCovered: 0,
    residualStatuses: 0,
  };
}

function publicFileResult(item) {
  const { details, counts, parsed } = item;
  return {
    path: item.rel,
    namespace: details.namespace,
    candidate_namespace: details.candidateNamespace,
    candidate_qualified_ids: details.candidateQualifiedIds,
    status_mapping: details.statusMapping,
    recognition_gap: parsed.normative.length === 0 ? "no-recognized-normative-lines" : null,
    recognized: {
      requirements: counts.requirement,
      acceptance_criteria: counts["acceptance-criterion"],
      checks: counts.check,
      decisions: counts.decision,
      terms: counts.term,
      risks: counts.risk,
      invariants: counts.invariant,
      total: parsed.normative.length,
    },
    candidate_records: details.candidateRecords,
  };
}

function addAuditMetrics(state, item) {
  const { details, parsed } = item;
  state.recognizedLines += parsed.normative.length;
  state.lifecycleCovered += details.lifecycleCovered;
  state.independentSourceCovered += details.independentSourceCovered;
  state.dependencyCovered += details.dependencyCovered;
  state.residualStatuses += details.residualStatuses;
  const namespace = details.namespace || details.candidateNamespace;
  if (!namespace) return;
  if (!state.collisions.has(namespace)) state.collisions.set(namespace, []);
  state.collisions.get(namespace).push(item.rel);
}

function namespaceCollisions(collisions) {
  return [...collisions]
    .filter(([, paths]) => paths.length > 1)
    .map(([namespace, paths]) => ({ namespace, paths: paths.sort() }))
    .sort((a, b) => compareLexical(a.namespace, b.namespace));
}

function audit(root) {
  root = fs.realpathSync(root);
  const state = {
    collisions: new Map(),
    recognizedLines: 0,
    lifecycleCovered: 0,
    independentSourceCovered: 0,
    dependencyCovered: 0,
    residualStatuses: 0,
  };
  const authorities = readAuditAuthorities(root);
  const documents = sourceDocuments(root).map((file) => auditDocument(root, file, authorities));
  for (const document of documents) addAuditMetrics(state, document);
  return canonicalize(auditResult(documents, state));
}

function readAuditAuthorities(root) {
  try {
    const file = resolveControlledPath(root, AUTHORITY_REL, "authority map", "invalid-authority-path");
    if (!fs.existsSync(file)) return null;
    return validateAuthority(readJsonFile(file, "authority-missing", "authority map"), new Map()).authorities;
  } catch {
    return null;
  }
}

function auditResult(documents, state) {
  return {
    schema_version: SCHEMA_VERSION,
    command: "audit",
    files: documents.map(publicFileResult),
    metrics: {
      recognized_lines: state.recognizedLines,
      lifecycle_covered: state.lifecycleCovered,
      external_source_covered: state.independentSourceCovered,
      dependency_covered: state.dependencyCovered,
      residual_migrated_statuses: state.residualStatuses,
      namespace_collisions: namespaceCollisions(state.collisions),
      unrecognized_specifications: documents
        .filter((document) => document.parsed.normative.length === 0)
        .map((document) => document.rel),
    },
  };
}

module.exports = { audit };
