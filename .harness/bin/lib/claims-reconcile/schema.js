"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  BASE_CLAIM_FIELDS,
  FORBIDDEN_CONTENT_FIELDS,
  HEADING_TYPES,
  IMPORT_ID_RE,
  LIFECYCLES,
  NAMESPACE_RE,
  RECORD_DEFINITIONS,
  RECORD_TYPES,
  SCHEMA_VERSION,
  SHA256_RE,
} = require("./constants");
const {
  assertClosedObject,
  compareLexical,
  fail,
  isObject,
  normalizeString,
} = require("./core");

function walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareLexical(a.name, b.name))) {
    if (entry.name.startsWith(".")) continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(child));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(child);
  }
  return out;
}

function candidateNamespace(file) {
  const base = path.basename(file, ".md").toLowerCase().normalize("NFC");
  return base.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "spec";
}

function parseFrontmatterStatus(content) {
  const normalized = normalizeString(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return null;
  const status = match[1].match(/^status\s*:\s*(.+?)\s*$/m);
  return status ? status[1].replace(/^['"]|['"]$/g, "").trim() : null;
}

function migrationLifecycle(status) {
  if (status === "draft" || status === "DRAFT") return { lifecycle: "draft", residual: false };
  if (status === "live") return { lifecycle: "active", residual: false };
  if (status === "VALIDATED") return { lifecycle: "pending-confirmation", residual: true };
  return { lifecycle: "draft", residual: true };
}

function consumeFence(state, line, index) {
  const match = line.match(/^\s*(`{3,}|~{3,})([^`]*)$/);
  if (!match) return false;
  const marker = match[1][0];
  if (!state.fence) {
    state.fence = { marker, length: match[1].length };
    const tag = match[2].trim();
    if (tag === "claims") state.claimsBlock = { startLine: index + 2, lines: [] };
    if (tag === "code-intel") state.codeIntelBlock = { startLine: index + 1, lines: [line] };
  } else if (marker === state.fence.marker && match[1].length >= state.fence.length) {
    if (state.codeIntelBlock) state.codeIntelBlock.lines.push(line);
    closeFence(state);
  } else {
    appendFencedLine(state, line);
  }
  return true;
}

function closeFence(state) {
  if (state.claimsBlock) {
    state.claimsBlocks.push(state.claimsBlock);
    state.claimsBlock = null;
  }
  if (state.codeIntelBlock) {
    state.codeIntelBlocks.push(state.codeIntelBlock);
    state.codeIntelBlock = null;
  }
  state.fence = null;
}

function appendFencedLine(state, line) {
  if (state.claimsBlock) state.claimsBlock.lines.push(line);
  if (state.codeIntelBlock) state.codeIntelBlock.lines.push(line);
}

function consumeNormativeLine(state, line, index) {
  const headingMatch = line.match(/^##\s+(.+?)\s*$/);
  if (headingMatch) {
    state.heading = HEADING_TYPES.has(headingMatch[1]) ? headingMatch[1] : null;
    return;
  }
  if (/^#{1,2}\s+/.test(line)) {
    state.heading = null;
    return;
  }
  if (!state.heading) return;
  const record = HEADING_TYPES.get(state.heading);
  const item = line.match(/^- (?:(?:\*\*)([^*]+)(?:\*\*)|([^*\s]+))(?:\s+\[[^\]]+\])?:\s+(.+)$/);
  if (!item) return;
  const id = item[1] || item[2];
  if (!RECORD_DEFINITIONS.get(record).id.test(id)) return;
  state.normative.push({ record, id, text: item[3], line: index + 1 });
}

function parseMarkdown(content, file = "<memory>") {
  const state = { normative: [], claimsBlocks: [], codeIntelBlocks: [], heading: null, fence: null, claimsBlock: null, codeIntelBlock: null };
  const lines = normalizeString(content).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (consumeFence(state, line, index)) continue;
    if (state.fence) {
      appendFencedLine(state, line);
      continue;
    }
    consumeNormativeLine(state, line, index);
  }
  if (state.fence) fail("unterminated-fence", `${file}: unterminated fenced block`);
  if (state.claimsBlocks.length > 1) fail("duplicate-claims-block", `${file}: multiple claims blocks are not allowed`);
  return { normative: state.normative, claimsBlock: state.claimsBlocks[0] || null, codeIntelBlocks: state.codeIntelBlocks };
}

function parseClaimsBlock(block, file) {
  if (!block) return null;
  const records = [];
  for (let index = 0; index < block.lines.length; index += 1) {
    const raw = block.lines[index].trim();
    if (!raw) continue;
    records.push({ value: parseClaimsLine(raw, file, block.startLine + index), line: block.startLine + index });
  }
  if (records.length === 0) fail("missing-header", `${file}: claims block is empty`);
  return records;
}

function parseClaimsLine(raw, file, line) {
  let record;
  try {
    record = JSON.parse(raw);
  } catch (error) {
    fail("malformed-jsonl", `${file}:${line}: invalid claims JSON: ${error.message}`);
  }
  if (!isObject(record)) fail("invalid-record", `${file}:${line}: claims line must be an object`);
  return record;
}

function validateStringArray(value, label, required = false) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    fail("invalid-shape", `${label} must be an array of non-empty strings`);
  }
  return value;
}

function validateExternalSources(value, label, required) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) fail("invalid-shape", `${label} must be an array`);
  return value.map((source, index) => validateExternalSource(source, `${label}[${index}]`));
}

function validateExternalSource(source, label) {
  assertClosedObject(source, new Set(["uri", "digest"]), label);
  if (typeof source.uri !== "string" || source.uri.length === 0 || typeof source.digest !== "string" || !SHA256_RE.test(source.digest)) {
    fail("invalid-shape", `${label} must contain uri and lowercase SHA-256 digest`);
  }
  return source;
}

function validateHeader(record, file) {
  assertClosedObject(record, new Set(["record", "schema_version", "namespace", "spec_lifecycle"]), `${file} claims header`);
  if (record.record !== "claims-header") fail("missing-header", `${file}: first claims record must be claims-header`);
  if (record.schema_version !== SCHEMA_VERSION) fail("unknown-version", `${file}: unsupported claims schema version ${String(record.schema_version)}`);
  if (typeof record.namespace !== "string" || !NAMESPACE_RE.test(record.namespace)) {
    fail("invalid-namespace", `${file}: namespace must match ${NAMESPACE_RE}`);
  }
  if (!LIFECYCLES.has(record.spec_lifecycle)) fail("unknown-lifecycle", `${file}: unknown spec lifecycle ${String(record.spec_lifecycle)}`);
  return record;
}

function assertLifecycleCompatible(specLifecycle, claimLifecycle, label) {
  const allowed = {
    draft: new Set(["draft", "superseded", "retired"]),
    "pending-confirmation": new Set(["draft", "pending-confirmation", "superseded", "retired"]),
    active: LIFECYCLES,
    superseded: new Set(["superseded", "retired"]),
    retired: new Set(["retired"]),
  };
  if (!allowed[specLifecycle].has(claimLifecycle)) {
    fail("invalid-lifecycle-transition", `${label}: ${claimLifecycle} claim is more live than ${specLifecycle} spec`);
  }
}

function validateClaimIdentity(record, file, line) {
  for (const key of FORBIDDEN_CONTENT_FIELDS) {
    if (Object.hasOwn(record, key)) fail("unknown-field", `${file}:${line} claim record has forbidden field: ${key}`);
  }
  const recordType = record.record;
  if (!RECORD_TYPES.has(recordType) || recordType === "claims-header" || recordType === "import") {
    fail("unknown-record-type", `${file}:${line}: unknown claim record type ${String(recordType)}`);
  }
  const allowed = new Set(BASE_CLAIM_FIELDS);
  if (recordType === "acceptance-criterion" || recordType === "check") allowed.add("for");
  assertClosedObject(record, allowed, `${file}:${line} claim record`);
  if (typeof record.id !== "string" || !RECORD_DEFINITIONS.get(recordType).id.test(record.id)) {
    fail("invalid-id", `${file}:${line}: invalid ${recordType} id ${String(record.id)}`);
  }
  return recordType;
}

function validateClaimLifecycle(record, header, file, line) {
  const lifecycle = record.lifecycle === undefined ? header.spec_lifecycle : record.lifecycle;
  if (!LIFECYCLES.has(lifecycle)) fail("unknown-lifecycle", `${file}:${line}: unknown lifecycle ${String(lifecycle)}`);
  assertLifecycleCompatible(header.spec_lifecycle, lifecycle, `${file}:${line}`);
  if (lifecycle === "superseded" && (typeof record.superseded_by !== "string" || record.superseded_by.length === 0)) {
    fail("missing-supersession", `${file}:${line}: superseded claim requires superseded_by`);
  }
  if (record.superseded_by !== undefined && typeof record.superseded_by !== "string") {
    fail("invalid-shape", `${file}:${line} superseded_by must be a claim ID`);
  }
  return lifecycle;
}

function validateClaimCollections(record, recordType, file, line) {
  const associations = recordType === "acceptance-criterion" || recordType === "check"
    ? validateStringArray(record.for, `${file}:${line} for`, true)
    : [];
  if ((recordType === "acceptance-criterion" || recordType === "check") && associations.length === 0) {
    fail("invalid-association", `${file}:${line} for must contain at least one required claim ID`);
  }
  return {
    dependsOn: validateStringArray(record.depends_on, `${file}:${line} depends_on`, recordType === "requirement"),
    externalSources: validateExternalSources(record.external_sources, `${file}:${line} external_sources`, recordType === "requirement"),
    associations,
    incompatibleWith: validateStringArray(record.incompatible_with, `${file}:${line} incompatible_with`),
    components: validateStringArray(record.components, `${file}:${line} components`),
    domains: validateStringArray(record.domains, `${file}:${line} domains`),
    repositories: validateStringArray(record.repositories, `${file}:${line} repositories`),
  };
}

function validateClaimRecord(record, header, normativeByKey, file, line) {
  const recordType = validateClaimIdentity(record, file, line);
  const lifecycle = validateClaimLifecycle(record, header, file, line);
  const values = validateClaimCollections(record, recordType, file, line);
  const source = normativeByKey.get(`${recordType}:${record.id}`);
  if (!source) fail("unmatched-record", `${file}:${line}: metadata ${record.id} has no normative source line`);
  return normalizedClaim(record, header, recordType, lifecycle, values, source, file);
}

function normalizedClaim(record, header, recordType, lifecycle, values, source, file) {
  return {
    qualified_id: `${header.namespace}/${record.id}`,
    namespace: header.namespace,
    record: recordType,
    id: record.id,
    lifecycle,
    verification: "absent",
    depends_on: values.dependsOn,
    for: values.associations,
    external_sources: values.externalSources,
    incompatible_with: values.incompatibleWith,
    components: values.components,
    domains: values.domains,
    repositories: values.repositories,
    ...(record.superseded_by === undefined ? {} : { superseded_by: record.superseded_by }),
    normative_text: source.text,
    source_path: file,
    source_line: source.line,
  };
}

function localIdType(value) {
  for (const [record, definition] of RECORD_DEFINITIONS) if (definition.id.test(value)) return record;
  return null;
}

function splitQualifiedId(value) {
  if (typeof value !== "string") return null;
  const split = value.lastIndexOf("/");
  if (split <= 0) return null;
  const namespace = value.slice(0, split);
  const id = value.slice(split + 1);
  return NAMESPACE_RE.test(namespace) && localIdType(id) ? { namespace, id } : null;
}

function isQualifiedId(value) {
  return splitQualifiedId(value) !== null;
}

function validateImportRecord(record, file, line) {
  assertClosedObject(record, new Set(["record", "id", "target", "registry"]), `${file}:${line} import record`);
  if (record.record !== "import") fail("unknown-record-type", `${file}:${line}: invalid import record`);
  if (typeof record.id !== "string" || !IMPORT_ID_RE.test(record.id)) fail("invalid-import", `${file}:${line}: invalid import id`);
  if (typeof record.registry !== "string" || !NAMESPACE_RE.test(record.registry)) fail("invalid-import", `${file}:${line}: invalid import registry`);
  if (typeof record.target !== "string" || !isQualifiedId(record.target)) fail("invalid-import", `${file}:${line}: target must be a qualified claim ID`);
  return { id: record.id, registry: record.registry, target: record.target, source_path: file, source_line: line };
}

function normativeMap(normative, relFile) {
  const result = new Map();
  for (const item of normative) {
    const key = `${item.record}:${item.id}`;
    if (result.has(key)) fail("duplicate-normative-id", `${relFile}: duplicate normative ID ${item.id}`);
    result.set(key, item);
  }
  return result;
}

function collectDocumentRecords(rows, header, sources, relFile) {
  const result = { claims: [], imports: [] };
  const seen = new Set();
  const importIds = new Set();
  for (const row of rows.slice(1)) collectDocumentRecord(row, header, sources, relFile, result, seen, importIds);
  for (const [key, item] of sources) {
    if (!seen.has(key)) fail("missing-metadata", `${relFile}:${item.line}: normative line ${item.id} has no metadata record`);
  }
  return result;
}

function collectDocumentRecord(row, header, sources, relFile, result, seen, importIds) {
  if (row.value.record === "claims-header") fail("duplicate-header", `${relFile}:${row.line}: duplicate claims header`);
  if (row.value.record === "import") {
    const imported = validateImportRecord(row.value, relFile, row.line);
    if (importIds.has(imported.id)) fail("duplicate-import-id", `${relFile}:${row.line}: duplicate import id ${imported.id}`);
    importIds.add(imported.id);
    result.imports.push(imported);
    return;
  }
  const claim = validateClaimRecord(row.value, header, sources, relFile, row.line);
  const key = `${claim.record}:${claim.id}`;
  if (seen.has(key)) fail("duplicate-metadata", `${relFile}:${row.line}: duplicate metadata for ${claim.id}`);
  seen.add(key);
  result.claims.push(claim);
}

function validateLocalDocument(parsed, relFile) {
  const rows = parseClaimsBlock(parsed.claimsBlock, relFile);
  if (!rows) return null;
  const header = validateHeader(rows[0].value, relFile);
  const collected = collectDocumentRecords(rows, header, normativeMap(parsed.normative, relFile), relFile);
  return { header, claims: collected.claims, imports: collected.imports };
}

function qualifyReference(value, namespace, label) {
  if (typeof value === "string" && localIdType(value)) return `${namespace}/${value}`;
  if (isQualifiedId(value)) return value;
  fail("invalid-dependency", `${label}: reference must be a local or qualified claim ID: ${String(value)}`);
}

function sourceDocuments(root) {
  return walkMarkdown(path.join(root, "specs")).filter((file) => {
    const text = fs.readFileSync(file, "utf8");
    return parseFrontmatterStatus(text) !== "derived" && !/^<!-- claims-projection \{"freshness_digest":"[a-f0-9]{64}"[^\n]*\} -->$/m.test(text);
  });
}

module.exports = {
  candidateNamespace,
  isQualifiedId,
  migrationLifecycle,
  parseFrontmatterStatus,
  parseMarkdown,
  qualifyReference,
  sourceDocuments,
  splitQualifiedId,
  validateExternalSources,
  validateLocalDocument,
  validateStringArray,
};
