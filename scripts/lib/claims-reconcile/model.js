"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  AUTHORITY_REL,
  DEFAULT_CLOSURE_BUDGET,
  IMMUTABLE_REVISION_RE,
  LIFECYCLES,
  LOCK_REL,
  MODEL_VERSION,
  NAMESPACE_RE,
  NORMATIVE_TYPES,
  RECORD_DEFINITIONS,
  SCHEMA_VERSION,
  SHA256_RE,
} = require("./constants");
const {
  assertClosedObject,
  canonicalize,
  compareLexical,
  digest,
  fail,
  isInside,
  isObject,
  readJsonFile,
  relativePosix,
  resolveControlledPath,
  sha256File,
} = require("./core");
const {
  parseMarkdown,
  qualifyReference,
  sourceDocuments,
  splitQualifiedId,
  validateExternalSources,
  validateLocalDocument,
  validateStringArray,
} = require("./schema");

function validateAuthority(raw, requiredAuthorities) {
  assertClosedObject(raw, new Set(["schema_version", "authorities"]), "authority map");
  if (raw.schema_version !== SCHEMA_VERSION) fail("unknown-authority-version", `unsupported authority version ${String(raw.schema_version)}`);
  if (!isObject(raw.authorities)) fail("invalid-authority", "authority map authorities must be an object");
  for (const [namespace, value] of Object.entries(raw.authorities)) validateAuthorityEntry(namespace, value);
  for (const [namespace, records] of requiredAuthorities) requireAuthorities(raw.authorities, namespace, records);
  return canonicalize(raw);
}

function validateAuthorityEntry(namespace, value) {
  if (!NAMESPACE_RE.test(namespace)) fail("invalid-authority", `invalid authority namespace: ${namespace}`);
  assertClosedObject(value, new Set(RECORD_DEFINITIONS.keys()), `authority ${namespace}`);
  for (const [record, owner] of Object.entries(value)) {
    if (typeof owner !== "string" || owner.trim() === "") fail("invalid-authority", `authority ${namespace}.${record} must be non-empty`);
  }
}

function requireAuthorities(authorities, namespace, records) {
  const entry = authorities[namespace];
  if (!isObject(entry)) fail("authority-missing", `authority missing for namespace ${namespace}`);
  for (const record of records) {
    if (typeof entry[record] !== "string" || entry[record].trim() === "") fail("authority-missing", `authority missing for ${namespace}.${record}`);
  }
}

function emptyLock() {
  return { schema_version: SCHEMA_VERSION, registries: {} };
}

function validateLock(raw, root) {
  assertClosedObject(raw, new Set(["schema_version", "registries"]), "claims lock");
  if (raw.schema_version !== SCHEMA_VERSION) fail("unknown-lock-version", `unsupported lock version ${String(raw.schema_version)}`);
  if (!isObject(raw.registries)) fail("invalid-lock", "claims lock registries must be an object");
  const out = emptyLock();
  for (const [name, entry] of Object.entries(raw.registries)) out.registries[name] = validateLockEntry(name, entry, root);
  return canonicalize(out);
}

function validateLockEntry(name, entry, root) {
  if (!NAMESPACE_RE.test(name)) fail("invalid-lock", `invalid registry name: ${name}`);
  assertClosedObject(entry, new Set(["revision", "path", "sha256"]), `lock registry ${name}`);
  if (typeof entry.revision !== "string" || !IMMUTABLE_REVISION_RE.test(entry.revision)) fail("mutable-lock-revision", `registry ${name} revision is not an immutable digest`);
  if (typeof entry.path !== "string" || path.isAbsolute(entry.path)) fail("invalid-lock", `registry ${name} path must be relative`);
  if (typeof entry.sha256 !== "string" || !SHA256_RE.test(entry.sha256)) fail("invalid-lock", `registry ${name} sha256 is invalid`);
  const resolved = path.resolve(root, entry.path);
  if (!isInside(root, resolved)) fail("invalid-lock", `registry ${name} path escapes root`);
  return { revision: entry.revision, path: relativePosix(root, resolved), sha256: entry.sha256 };
}

const EXTERNAL_FIELDS = new Set([
  "qualified_id", "namespace", "record", "id", "lifecycle", "verification", "depends_on", "for",
  "external_sources", "incompatible_with", "components", "domains", "repositories", "superseded_by",
  "normative_text", "source_path", "source_line",
]);

function validateExternalModel(raw, registry) {
  assertClosedObject(raw, new Set(["model_version", "claims"]), `registry ${registry}`);
  if (raw.model_version !== MODEL_VERSION) fail("external-version", `registry ${registry} has unsupported model version`);
  if (!Array.isArray(raw.claims)) fail("external-shape", `registry ${registry} claims must be an array`);
  return raw.claims.map((item) => validateExternalClaim(item, registry));
}

function validateExternalClaim(item, registry) {
  assertClosedObject(item, EXTERNAL_FIELDS, `registry ${registry} claim`);
  validateExternalIdentity(item, registry);
  validateExternalRelations(item, registry);
  if (item.record === "requirement" && !Object.hasOwn(item, "external_sources")) {
    fail("external-shape", `registry ${registry} requirement ${item.id} must declare external_sources`);
  }
  validateExternalSources(item.external_sources || [], `registry ${registry} external_sources`, true);
  if (NORMATIVE_TYPES.has(item.record) && typeof item.normative_text !== "string") {
    fail("external-shape", `registry ${registry} claim has no normative text`);
  }
  return canonicalize(item);
}

function validateExternalIdentity(item, registry) {
  const identity = splitQualifiedId(item.qualified_id);
  if (!identity || !RECORD_DEFINITIONS.has(item.record) || item.id !== identity.id || item.namespace !== identity.namespace) {
    fail("external-shape", `registry ${registry} has inconsistent claim identity`);
  }
  if (!RECORD_DEFINITIONS.get(item.record).id.test(item.id) || !LIFECYCLES.has(item.lifecycle) || item.verification !== "absent") {
    fail("external-shape", `registry ${registry} claim has invalid record state`);
  }
  if (item.lifecycle === "superseded" && (typeof item.superseded_by !== "string" || item.superseded_by.length === 0)) {
    fail("missing-supersession", `registry ${registry} superseded claim ${item.id} requires superseded_by`);
  }
}

function validateExternalRelations(item, registry) {
  if (item.record === "requirement" && !Object.hasOwn(item, "depends_on")) {
    fail("external-shape", `registry ${registry} requirement ${item.id} must declare depends_on`);
  }
  if (item.record === "acceptance-criterion" || item.record === "check") {
    const associations = validateStringArray(item.for, `registry ${registry} ${item.id} for`, true);
    if (associations.length === 0) fail("external-shape", `registry ${registry} ${item.id} for must not be empty`);
  }
  for (const key of ["depends_on", "for", "incompatible_with", "components", "domains", "repositories"]) {
    validateStringArray(item[key] || [], `registry ${registry} ${key}`, true);
  }
}

function loadExternalPools(root, imports, lock) {
  const registries = new Map();
  const qualifiedOwners = new Map();
  for (const registry of [...new Set(imports.map((item) => item.registry))].sort()) {
    const claims = loadRegistryClaims(root, registry, lock);
    const pool = new Map();
    for (const claim of claims) addExternalClaim(pool, qualifiedOwners, claim, registry);
    registries.set(registry, pool);
  }
  return registries;
}

function loadRegistryClaims(root, registry, lock) {
  const pin = lock.registries[registry];
  if (!pin) fail("lock-missing", `no lock entry for imported registry ${registry}`);
  const file = path.resolve(root, pin.path);
  if (!fs.existsSync(file)) fail("locked-source-unavailable", `locked registry source unavailable: ${pin.path}`);
  if (sha256File(file) !== pin.sha256) fail("lock-digest-mismatch", `locked registry digest mismatch: ${registry}`);
  return validateExternalModel(readJsonFile(file, "locked-source-unavailable", `registry ${registry}`), registry);
}

function addExternalClaim(pool, owners, claim, registry) {
  if (pool.has(claim.qualified_id)) fail("duplicate-qualified-id", `duplicate qualified ID in ${registry}: ${claim.qualified_id}`);
  const prior = owners.get(claim.qualified_id);
  if (prior) fail("duplicate-qualified-id", `qualified ID ${claim.qualified_id} occurs in ${prior} and ${registry}`);
  pool.set(claim.qualified_id, claim);
  owners.set(claim.qualified_id, registry);
}

function claimPools(localClaims, registries) {
  const local = new Map();
  for (const claim of localClaims) {
    if (local.has(claim.qualified_id)) fail("duplicate-qualified-id", `duplicate qualified ID: ${claim.qualified_id}`);
    local.set(claim.qualified_id, claim);
  }
  const external = new Map();
  for (const pool of registries.values()) {
    for (const [id, claim] of pool) {
      if (local.has(id) || external.has(id)) fail("duplicate-qualified-id", `duplicate qualified ID: ${id}`);
      external.set(id, claim);
    }
  }
  return { local, external };
}

function closureRoots(local, imports, registries) {
  const roots = [...local.keys()];
  const owners = new Map();
  for (const imported of imports) {
    const pool = registries.get(imported.registry);
    if (!pool || !pool.has(imported.target)) fail("missing-dependency", `import ${imported.id} target is unavailable: ${imported.target}`);
    if (owners.has(imported.target)) fail("duplicate-qualified-id", `qualified ID ${imported.target} imported more than once`);
    owners.set(imported.target, imported.registry);
    roots.push(imported.target);
  }
  return roots;
}

function visitClaim(id, parent, state) {
  if (state.visiting.has(id)) fail(id === parent ? "self-dependency" : "dependency-cycle", `dependency cycle at ${id}`);
  if (state.visited.has(id)) return;
  state.traversed += 1;
  if (state.traversed > state.budget) fail("closure-budget-exceeded", `dependency closure exceeded budget ${state.budget}`);
  const claim = state.local.get(id) || state.external.get(id);
  if (!claim) fail("missing-dependency", `missing dependency ${id}`);
  state.visiting.add(id);
  const normalized = normalizeClaimRelations(claim, id);
  for (const dependency of normalized.required) {
    if (dependency === id) fail("self-dependency", `self dependency at ${id}`);
    visitClaim(dependency, id, state);
  }
  validateIncompatibilities(claim, id, state);
  state.visiting.delete(id);
  state.visited.add(id);
  state.ordered.push({ ...claim, ...normalized.fields });
}

function normalizeClaimRelations(claim, id) {
  const namespace = claim.namespace || splitQualifiedId(id).namespace;
  const dependsOn = (claim.depends_on || []).map((item) => qualifyReference(item, namespace, id));
  const associations = (claim.for || []).map((item) => qualifyReference(item, namespace, id));
  const supersededBy = claim.superseded_by === undefined ? undefined : qualifyReference(claim.superseded_by, namespace, id);
  return {
    fields: { depends_on: dependsOn, for: associations, ...(supersededBy ? { superseded_by: supersededBy } : {}) },
    required: [...dependsOn, ...associations, ...(supersededBy ? [supersededBy] : [])].sort(),
  };
}

function validateIncompatibilities(claim, id, state) {
  const namespace = claim.namespace || splitQualifiedId(id).namespace;
  for (const incompatible of claim.incompatible_with || []) {
    const qualified = qualifyReference(incompatible, namespace, id);
    if (!state.local.has(qualified) && !state.external.has(qualified)) fail("missing-dependency", `missing incompatibility reference ${qualified}`);
  }
}

function resolveClosure(localClaims, imports, registries, budget) {
  if (!Number.isInteger(budget) || budget <= 0) fail("invalid-budget", "closure budget must be a positive integer");
  const pools = claimPools(localClaims, registries);
  const state = { ...pools, budget, traversed: 0, visiting: new Set(), visited: new Set(), ordered: [] };
  for (const root of [...new Set(closureRoots(pools.local, imports, registries))].sort()) visitClaim(root, root, state);
  return state.ordered.sort((a, b) => compareLexical(a.qualified_id, b.qualified_id));
}

function collectLocalClaims(root) {
  const result = { claims: [], codeIntel: [], imports: [], namespaces: new Map(), managedDocuments: 0 };
  for (const file of sourceDocuments(root)) collectLocalDocument(root, file, result);
  return result;
}

function collectLocalDocument(root, file, result) {
  const rel = relativePosix(root, file);
  const parsed = parseMarkdown(fs.readFileSync(file, "utf8"), rel);
  result.codeIntel.push(...parsed.codeIntelBlocks.map((block) => ({
    source_path: rel,
    source_line: block.startLine,
    content: block.lines.join("\n"),
  })));
  if (!parsed.claimsBlock) return;
  result.managedDocuments += 1;
  const document = validateLocalDocument(parsed, rel);
  const prior = result.namespaces.get(document.header.namespace);
  if (prior) fail("duplicate-namespace", `namespace ${document.header.namespace} is installed by both ${prior} and ${rel}`);
  result.namespaces.set(document.header.namespace, rel);
  result.claims.push(...document.claims);
  result.imports.push(...document.imports);
}

function loadLock(root, options, imports) {
  const lockPath = resolveControlledPath(root, options.lock || LOCK_REL, "claims lock", "invalid-lock-path");
  const raw = imports.length > 0
    ? readJsonFile(lockPath, "lock-missing", "claims lock")
    : fs.existsSync(lockPath) ? readJsonFile(lockPath, "lock-missing", "claims lock") : emptyLock();
  return validateLock(raw, root);
}

function requiredAuthorityMap(claims) {
  const result = new Map();
  for (const claim of claims) {
    if (claim.lifecycle !== "active") continue;
    if (!result.has(claim.namespace)) result.set(claim.namespace, new Set());
    result.get(claim.namespace).add(claim.record);
  }
  return result;
}

function loadAuthority(root, options, required) {
  const authorityPath = resolveControlledPath(root, options.authority || AUTHORITY_REL, "authority map", "invalid-authority-path");
  const raw = required.size > 0
    ? readJsonFile(authorityPath, "authority-missing", "authority map")
    : fs.existsSync(authorityPath)
      ? readJsonFile(authorityPath, "authority-missing", "authority map")
      : { schema_version: SCHEMA_VERSION, authorities: {} };
  return validateAuthority(raw, required);
}

function buildModel(root, options = {}) {
  root = fs.realpathSync(root);
  const local = collectLocalClaims(root);
  const lock = loadLock(root, options, local.imports);
  const registries = loadExternalPools(root, local.imports, lock);
  const budget = options.budget === undefined ? DEFAULT_CLOSURE_BUDGET : options.budget;
  const claims = resolveClosure(local.claims, local.imports, registries, budget);
  const authority = loadAuthority(root, options, requiredAuthorityMap(claims));
  const model = canonicalize({ model_version: MODEL_VERSION, claims, code_intel: local.codeIntel });
  return {
    root,
    model,
    authority,
    lock,
    model_digest: digest(model),
    managed_documents: local.managedDocuments,
  };
}

module.exports = { buildModel, validateAuthority };
