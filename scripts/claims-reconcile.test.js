"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  ClaimsError,
  audit,
  buildContextManifest,
  buildModel,
  canonicalize,
  checkFreshness,
  digest,
  extractTaggedFences,
  freshness,
  parseMarkdown,
  project,
  stableStringify,
  validateNeutralManifest,
  writeAtomicSet,
} = require("./lib/claims-reconcile");

const SCRIPT = path.join(__dirname, "claims-reconcile.js");
const CHECK_SCRIPT = path.join(__dirname, "claims-reconcile-check.js");
const CODE_INTEL_SCRIPT = path.join(__dirname, "code-intel-resolve.js");
const RUN_HOOK_SCRIPT = path.join(__dirname, "../dist/scripts/run-hook.js");
const HOOKS_DIR = path.join(__dirname, "../.harness/hooks/skills");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claims-reconcile-"));
  fs.mkdirSync(path.join(root, "specs"), { recursive: true });
  return root;
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function authority(root, namespaces = { feature: ["requirement", "acceptance-criterion", "check"] }) {
  const authorities = {};
  for (const [namespace, records] of Object.entries(namespaces)) {
    authorities[namespace] = Object.fromEntries(records.map((record) => [record, "maintainers"]));
  }
  write(root, "specs/claims-authority.json", `${JSON.stringify({ schema_version: 1, authorities })}\n`);
}

function records(overrides = {}) {
  const header = { record: "claims-header", schema_version: 1, namespace: "feature", spec_lifecycle: "active" };
  const requirement = { record: "requirement", id: "FR-001", depends_on: [], external_sources: [] };
  const criterion = { record: "acceptance-criterion", id: "AC-1", for: ["FR-001"] };
  const check = { record: "check", id: "CHECK-1", for: ["AC-1"] };
  return [overrides.header || header, overrides.requirement || requirement, overrides.criterion || criterion, overrides.check || check, ...(overrides.extra || [])];
}

function specDocument(claimRecords = records(), options = {}) {
  const eol = options.eol || "\n";
  return [
    "---",
    `status: ${options.status || "live"}`,
    "---",
    "",
    "## Functional Requirements",
    `- **FR-001** [US-1]: ${options.requirementText || "The system MUST be deterministic."}`,
    ...(options.extraRequirements || []),
    "",
    "## Acceptance Criteria",
    "- **AC-1** [US-1]: The result is stable.",
    "",
    "## Runnable Checks",
    "- **CHECK-1** [AC-1]: `node --version` -> expected: 0.",
    ...(options.extraBody || []),
    "",
    "```claims",
    ...claimRecords.map((record) => JSON.stringify(record)),
    "```",
    "",
  ].join(eol);
}

function validRoot(options = {}) {
  const root = tempRoot();
  write(root, "specs/feature.md", specDocument(options.records || records(), options));
  authority(root, options.authorities);
  return root;
}

function codeIntelSource(root, block) {
  write(root, "specs/global-properties.md", `# Global Properties\n\n${block}\n`);
}

function expectReason(callback, reason) {
  assert.throws(callback, (error) => error instanceof ClaimsError && error.reason === reason, `expected ${reason}`);
}

function codeIntelQaVerdict(result) {
  if (result.status === 1 && /RESULT: fail/.test(result.stdout)) return "NO-GO";
  if (result.status === 2 && /RESULT: malformed/.test(result.stdout)) return "NO-GO";
  return "GO";
}

function externalClaim(id = "FR-900", dependencies = []) {
  return {
    qualified_id: `external/${id}`,
    namespace: "external",
    record: "requirement",
    id,
    lifecycle: "active",
    verification: "absent",
    depends_on: dependencies,
    for: [],
    external_sources: [],
    incompatible_with: [],
    components: [],
    domains: [],
    repositories: [],
    normative_text: `External ${id}`,
    source_path: "specs/external.md",
    source_line: 1,
  };
}

function installRegistry(root, name, claims) {
  const relative = `registries/${name}.json`;
  const file = write(root, relative, `${JSON.stringify({ model_version: 1, claims })}\n`);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return { revision: "a".repeat(40), path: relative, sha256 };
}

function rootWithExternal(claim) {
  const root = tempRoot();
  const imported = { record: "import", id: "external-claim", target: claim.qualified_id, registry: "external-registry" };
  write(root, "specs/feature.md", specDocument([...records(), imported]));
  authority(root, {
    feature: ["requirement", "acceptance-criterion", "check"],
    external: [claim.record],
  });
  const lock = { schema_version: 1, registries: { "external-registry": installRegistry(root, "external-registry", [claim]) } };
  write(root, "specs/claims.lock", JSON.stringify(lock));
  return root;
}

test("[audit-determinism] audit is byte stable and read-only", () => {
  const root = tempRoot();
  const file = write(root, "specs/legacy.md", specDocument([], { status: "VALIDATED", eol: "\r\n" }).replace(/```claims[\s\S]*```\r?\n/, ""));
  const before = fs.readFileSync(file);
  const first = stableStringify(audit(root), true);
  const second = stableStringify(audit(root), true);
  assert.equal(first, second);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(audit(root).metrics.recognized_lines, 3);
  const managedRecords = records({ extra: [{ record: "decision", id: "D-1", lifecycle: "draft" }] });
  const managed = validRoot({
    records: managedRecords,
    extraBody: ["", "## Decisions", "- **D-1**: The selected mechanism is deterministic."],
  });
  const managedReport = audit(managed);
  assert.equal(managedReport.metrics.lifecycle_covered, 4);
  assert.equal(managedReport.metrics.external_source_covered, 0);
  const autoSource = records({
    requirement: {
      record: "requirement",
      id: "FR-001",
      depends_on: [],
      external_sources: [{ uri: "specs/feature.md#L6", digest: "0".repeat(64) }],
    },
  });
  const anchored = validRoot({ records: autoSource });
  assert.equal(audit(anchored).metrics.external_source_covered, 0);
});

test("[recognition-boundary] only exact canonical source lines outside fences count", () => {
  const parsed = parseMarkdown([
    "## Functional Requirements",
    "#### Audit subsection",
    "- **FR-001**: included",
    "  - **FR-002**: indented",
    "```md",
    "- **FR-003**: fenced",
    "```",
    "## Requirements",
    "- **FR-004**: wrong heading",
    "## Acceptance Criteria",
    "- **AC-1** [US]: included",
    "## Runnable Checks",
    "- **CHECK-1**: included",
    "## Decisions",
    "- **D-1**: included",
    "- **DEC-2**: included",
    "## Terms",
    "- **TERM-1**: included",
    "## Risks",
    "- **RISK-1**: included",
    "## Invariants",
    "- **INV-1**: included",
  ].join("\n"));
  assert.deepEqual(parsed.normative.map(({ record, id }) => [record, id]), [
    ["requirement", "FR-001"],
    ["acceptance-criterion", "AC-1"],
    ["check", "CHECK-1"],
    ["decision", "D-1"],
    ["decision", "DEC-2"],
    ["term", "TERM-1"],
    ["risk", "RISK-1"],
    ["invariant", "INV-1"],
  ]);
  const unbolded = parseMarkdown([
    "## Acceptance Criteria",
    "- AC-2 [US]: accepted without emphasis",
    "## Runnable Checks",
    "- CHECK-2 [AC-2]: accepted without emphasis",
  ].join("\n"));
  assert.deepEqual(unbolded.normative.map(({ record, id }) => [record, id]), [
    ["acceptance-criterion", "AC-2"],
    ["check", "CHECK-2"],
  ]);
  const root = tempRoot();
  write(root, "specs/not-generated.md", "A mention <!-- claims-projection in prose must not hide this file.\n\n## Functional Requirements\n- **FR-001**: included\n");
  assert.equal(audit(root).metrics.recognized_lines, 1);
  write(root, "specs/unrecognized.md", "# Legacy source without a canonical section\n");
  const report = audit(root);
  assert.equal(report.files.find((file) => file.path === "specs/unrecognized.md").recognition_gap, "no-recognized-normative-lines");
  assert.deepEqual(report.metrics.unrecognized_specifications, ["specs/unrecognized.md"]);
});

test("[namespace-stability] audit candidates are qualified and installed namespaces survive rename", () => {
  const root = tempRoot();
  const legacy = specDocument([], { status: "live" }).replace(/```claims[\s\S]*```\n/, "");
  write(root, "specs/Old Name.md", legacy);
  const report = audit(root);
  assert.equal(report.files[0].candidate_namespace, "old-name");
  assert.ok(report.files[0].candidate_qualified_ids.includes("old-name/FR-001"));

  fs.rmSync(path.join(root, "specs/Old Name.md"));
  write(root, "specs/renamed.md", specDocument(records()));
  authority(root);
  assert.equal(audit(root).files[0].namespace, "feature");

  const pendingRoot = tempRoot();
  const pendingRecords = records({
    header: { record: "claims-header", schema_version: 1, namespace: "review-candidate", spec_lifecycle: "pending-confirmation" },
  });
  const pendingPath = write(pendingRoot, "specs/original-name.md", specDocument(pendingRecords));
  let pendingAudit = audit(pendingRoot).files[0];
  assert.equal(pendingAudit.namespace, null);
  assert.equal(pendingAudit.candidate_namespace, "review-candidate");
  fs.renameSync(pendingPath, path.join(pendingRoot, "specs/renamed-before-approval.md"));
  pendingAudit = audit(pendingRoot).files[0];
  assert.equal(pendingAudit.namespace, null);
  assert.equal(pendingAudit.candidate_namespace, "review-candidate");
  pendingRecords[0].spec_lifecycle = "active";
  write(pendingRoot, "specs/renamed-before-approval.md", specDocument(pendingRecords));
  pendingAudit = audit(pendingRoot).files[0];
  assert.equal(pendingAudit.namespace, null);
  assert.equal(pendingAudit.candidate_namespace, "review-candidate");
  authority(pendingRoot, { "review-candidate": ["requirement", "acceptance-criterion", "check"] });
  pendingAudit = audit(pendingRoot).files[0];
  assert.equal(pendingAudit.namespace, "review-candidate");
  assert.equal(pendingAudit.candidate_namespace, null);

  authority(pendingRoot, { "review-candidate": ["requirement"] });
  pendingAudit = audit(pendingRoot).files[0];
  assert.equal(pendingAudit.namespace, null);
  assert.equal(pendingAudit.candidate_namespace, "review-candidate");

  write(pendingRoot, "specs/claims-authority.json", JSON.stringify({
    schema_version: 1,
    authorities: { "review-candidate": { requirement: "owners", "acceptance-criterion": "owners", check: "owners" } },
    unknown: true,
  }));
  pendingAudit = audit(pendingRoot).files[0];
  assert.equal(pendingAudit.namespace, null);

  fs.rmSync(path.join(pendingRoot, "specs/claims-authority.json"));
  const outsideAuthority = write(tempRoot(), "authority.json", JSON.stringify({
    schema_version: 1,
    authorities: { "review-candidate": { requirement: "owners", "acceptance-criterion": "owners", check: "owners" } },
  }));
  fs.symlinkSync(outsideAuthority, path.join(pendingRoot, "specs/claims-authority.json"));
  pendingAudit = audit(pendingRoot).files[0];
  assert.equal(pendingAudit.namespace, null);

  write(root, "specs/second.md", specDocument(records()));
  expectReason(() => buildModel(root), "duplicate-namespace");

  const collisionRoot = tempRoot();
  const installed = records({ header: { record: "claims-header", schema_version: 1, namespace: "collision", spec_lifecycle: "active" } });
  write(collisionRoot, "specs/installed.md", specDocument(installed));
  authority(collisionRoot, { collision: ["requirement", "acceptance-criterion", "check"] });
  const collisionLegacy = specDocument([]).replace(/```claims[\s\S]*```\n/, "");
  write(collisionRoot, "specs/collision.md", collisionLegacy);
  const collision = audit(collisionRoot).metrics.namespace_collisions;
  assert.deepEqual(collision, [{ namespace: "collision", paths: ["specs/collision.md", "specs/installed.md"] }]);
});

test("[pairing-mutations] missing, duplicate, and unmatched pairs fail", () => {
  let root = validRoot({ records: records().slice(0, -1) });
  expectReason(() => buildModel(root), "missing-metadata");
  root = validRoot({ records: [...records(), records()[1]] });
  expectReason(() => buildModel(root), "duplicate-metadata");
  root = validRoot({ records: records({ requirement: { record: "requirement", id: "FR-002", depends_on: [], external_sources: [] } }) });
  expectReason(() => buildModel(root), "unmatched-record");

  root = validRoot({ records: records({ extra: [{ record: "decision", id: "D-1" }] }) });
  expectReason(() => buildModel(root), "unmatched-record");
  root = validRoot({ extraBody: ["", "## Invariants", "- **INV-1**: Every projection is deterministic."] });
  expectReason(() => buildModel(root), "missing-metadata");
});

test("[identity-history] text does not define identity and supersession is explicit", () => {
  let root = validRoot({ requirementText: "First text." });
  assert.equal(buildModel(root).model.claims.find((claim) => claim.record === "requirement").qualified_id, "feature/FR-001");
  root = validRoot({ requirementText: "Entirely different text." });
  assert.equal(buildModel(root).model.claims.find((claim) => claim.record === "requirement").qualified_id, "feature/FR-001");
  root = validRoot({ records: records({ requirement: { record: "requirement", id: "FR-001", lifecycle: "superseded", depends_on: [], external_sources: [] } }) });
  expectReason(() => buildModel(root), "missing-supersession");

  const externalSuperseded = externalClaim();
  externalSuperseded.lifecycle = "superseded";
  expectReason(() => buildModel(rootWithExternal(externalSuperseded)), "missing-supersession");

  const externalMissingSources = externalClaim();
  delete externalMissingSources.external_sources;
  expectReason(() => buildModel(rootWithExternal(externalMissingSources)), "external-shape");
});

test("[closed-schema] versions, record vocabulary, fields, and lifecycle are closed", () => {
  let root = validRoot({ records: records({ header: { record: "claims-header", schema_version: 2, namespace: "feature", spec_lifecycle: "active" } }) });
  expectReason(() => buildModel(root), "unknown-version");
  root = validRoot({ records: records({ requirement: { record: "story", id: "FR-001", depends_on: [], external_sources: [] } }) });
  expectReason(() => buildModel(root), "unknown-record-type");
  root = validRoot({ records: records({ requirement: { record: "requirement", id: "FR-001", depends_on: [], external_sources: [], statement: "duplicate" } }) });
  expectReason(() => buildModel(root), "unknown-field");
  root = validRoot({ records: records({ requirement: { record: "requirement", id: "FR-001", lifecycle: "contested", depends_on: [], external_sources: [] } }) });
  expectReason(() => buildModel(root), "unknown-lifecycle");
  root = validRoot({ records: records({ criterion: { record: "acceptance-criterion", id: "AC-1", for: [] } }) });
  expectReason(() => buildModel(root), "invalid-association");

  for (const flag of ["--lock", "--authority"]) {
    const result = spawnSync(process.execPath, [SCRIPT, "validate", "--root", validRoot(), flag, "specs/override.json"], { encoding: "utf8" });
    assert.equal(result.status, 64);
  }
});

test("[authority-boundary] authority is external and required by namespace and record", () => {
  const root = validRoot();
  fs.rmSync(path.join(root, "specs/claims-authority.json"));
  expectReason(() => buildModel(root), "authority-missing");
  const pending = validRoot({ records: records({ header: { record: "claims-header", schema_version: 1, namespace: "feature", spec_lifecycle: "pending-confirmation" } }) });
  fs.rmSync(path.join(pending, "specs/claims-authority.json"));
  assert.equal(buildModel(pending).model.claims.length, 3);
  authority(root, { feature: ["requirement"] });
  expectReason(() => buildModel(root), "authority-missing");
  const injected = records({ requirement: { record: "requirement", id: "FR-001", depends_on: [], external_sources: [], authority: "self" } });
  write(root, "specs/feature.md", specDocument(injected));
  expectReason(() => buildModel(root), "unknown-field");

  const outside = write(tempRoot(), "authority.json", JSON.stringify({ schema_version: 1, authorities: {} }));
  expectReason(() => buildModel(validRoot(), { authority: outside }), "invalid-authority-path");
  const linkedAuthorityRoot = validRoot();
  const authorityPath = path.join(linkedAuthorityRoot, "specs/claims-authority.json");
  const authorityTarget = write(linkedAuthorityRoot, "specs/authority-target.json", fs.readFileSync(authorityPath));
  fs.rmSync(authorityPath);
  fs.symlinkSync(authorityTarget, authorityPath);
  expectReason(() => buildModel(linkedAuthorityRoot), "invalid-authority-path");

  const outsideLock = write(tempRoot(), "claims.lock", JSON.stringify({ schema_version: 1, registries: {} }));
  expectReason(() => buildModel(validRoot(), { lock: outsideLock }), "invalid-lock-path");
  const linkedLockRoot = validRoot();
  const lockTarget = write(linkedLockRoot, "specs/lock-target.json", JSON.stringify({ schema_version: 1, registries: {} }));
  fs.symlinkSync(lockTarget, path.join(linkedLockRoot, "specs/custom.lock"));
  expectReason(() => buildModel(linkedLockRoot, { lock: "specs/custom.lock" }), "invalid-lock-path");
});

test("[dependency-closure] required closure is complete and failures are distinct", () => {
  let root = validRoot({ records: records({ header: { record: "claims-header", schema_version: 1, namespace: "feature", spec_lifecycle: "pending-confirmation" } }) });
  let state = buildModel(root);
  assert.equal(state.model.claims.length, 3);
  assert.ok(state.model.claims.every((claim) => claim.lifecycle === "pending-confirmation"));
  assert.ok(state.model.claims.every((claim) => claim.verification === "absent"));

  root = validRoot({ records: records({ requirement: { record: "requirement", id: "FR-001", depends_on: ["FR-999"], external_sources: [] } }) });
  expectReason(() => buildModel(root), "missing-dependency");
  root = validRoot({ records: records({ requirement: { record: "requirement", id: "FR-001", depends_on: ["FR-001"], external_sources: [] } }) });
  expectReason(() => buildModel(root), "self-dependency");
  root = validRoot({ records: records({ requirement: { record: "requirement", id: "FR-001", depends_on: ["AC-1"], external_sources: [] } }) });
  expectReason(() => buildModel(root), "dependency-cycle");
  root = validRoot();
  expectReason(() => buildModel(root, { budget: 1 }), "closure-budget-exceeded");
  expectReason(() => buildModel(root, { budget: 0 }), "invalid-budget");

  const unavailableRoot = rootWithExternal(externalClaim());
  fs.rmSync(path.join(unavailableRoot, "registries/external-registry.json"));
  expectReason(() => buildModel(unavailableRoot), "locked-source-unavailable");

  const mutableRoot = rootWithExternal(externalClaim());
  const mutableLockPath = path.join(mutableRoot, "specs/claims.lock");
  const mutableLock = JSON.parse(fs.readFileSync(mutableLockPath, "utf8"));
  mutableLock.registries["external-registry"].revision = "main";
  fs.writeFileSync(mutableLockPath, JSON.stringify(mutableLock));
  expectReason(() => buildModel(mutableRoot), "mutable-lock-revision");

  const mismatchRoot = rootWithExternal(externalClaim());
  fs.appendFileSync(path.join(mismatchRoot, "registries/external-registry.json"), " ");
  expectReason(() => buildModel(mismatchRoot), "lock-digest-mismatch");
});

test("[duplicate-imports] lock pins external registries and duplicate qualified imports fail", () => {
  const root = tempRoot();
  const imports = [
    { record: "import", id: "first", target: "external/FR-900", registry: "one" },
    { record: "import", id: "second", target: "external/FR-900", registry: "two" },
  ];
  write(root, "specs/feature.md", specDocument([...records(), ...imports]));
  authority(root, { feature: ["requirement", "acceptance-criterion", "check"], external: ["requirement"] });
  const lock = { schema_version: 1, registries: { one: installRegistry(root, "one", [externalClaim()]), two: installRegistry(root, "two", [externalClaim()]) } };
  write(root, "specs/claims.lock", JSON.stringify(lock));
  expectReason(() => buildModel(root), "duplicate-qualified-id");

  delete lock.registries.two;
  write(root, "specs/claims.lock", JSON.stringify(lock));
  expectReason(() => buildModel(root), "lock-missing");

  const missingDependencies = externalClaim();
  delete missingDependencies.depends_on;
  expectReason(() => buildModel(rootWithExternal(missingDependencies)), "external-shape");

  const emptyAssociation = {
    ...externalClaim("AC-9"),
    qualified_id: "external/AC-9",
    record: "acceptance-criterion",
    for: [],
  };
  expectReason(() => buildModel(rootWithExternal(emptyAssociation)), "external-shape");
});

test("[canonical-digest] canonical equivalents match and every freshness input participates", () => {
  const left = { model_version: 1, claims: [{ id: "e\u0301", depends_on: ["b", "a"], updated_at: "old", date: "2020-01-01" }] };
  const right = { claims: [{ depends_on: ["a", "b"], id: "\u00e9", updated_at: "new", date: "2030-01-01" }], model_version: 1 };
  assert.equal(digest(left), digest(right));
  assert.notEqual(digest(left), digest({ ...right, model_version: 2 }));
  const root = validRoot();
  const state = buildModel(root);
  const baseline = freshness(state).digest;

  write(root, "specs/feature.md", specDocument(records(), { requirementText: "Changed normative model text." }));
  assert.notEqual(baseline, freshness(buildModel(root)).digest, "model mutation must invalidate freshness");
  write(root, "specs/feature.md", specDocument(records()));

  const authorityPath = path.join(root, "specs/claims-authority.json");
  const changedAuthority = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
  changedAuthority.authorities.feature.requirement = "other-maintainers";
  fs.writeFileSync(authorityPath, JSON.stringify(changedAuthority));
  assert.notEqual(baseline, freshness(buildModel(root)).digest, "authority mutation must invalidate freshness");
  authority(root);

  write(root, "specs/claims.lock", JSON.stringify({
    schema_version: 1,
    registries: {
      unused: { revision: "b".repeat(40), path: "registries/unused.json", sha256: "0".repeat(64) },
    },
  }));
  assert.notEqual(baseline, freshness(buildModel(root)).digest, "lock mutation must invalidate freshness");
  fs.rmSync(path.join(root, "specs/claims.lock"));

  assert.notEqual(baseline, freshness(state, { rendererVersion: "2.0" }).digest, "renderer mutation must invalidate freshness");
  assert.notEqual(baseline, freshness(state, { selectionPolicyVersion: "2.0" }).digest, "selection policy mutation must invalidate freshness");

  codeIntelSource(root, "```code-intel\n{\"id\":\"INV-1\"}\n```");
  assert.notEqual(baseline, freshness(buildModel(root)).digest, "code-intel source mutation must invalidate freshness");
});

test("[projection-freshness] projection set is atomic, marked, and stale inputs fail", () => {
  const root = validRoot();
  const out = path.join(root, "generated");
  const sourceBlock = "```code-intel\n{\"provider\":\"fixture\"}\n```";
  codeIntelSource(root, sourceBlock);
  project(root, { outputDir: out });
  assert.equal(checkFreshness(root, { outputDir: out }).fresh, true);
  assert.deepEqual(extractTaggedFences(fs.readFileSync(path.join(out, "properties.md"), "utf8"), "code-intel"), ["```code-intel\n{\"provider\":\"fixture\"}\n```"]);
  fs.writeFileSync(path.join(out, "properties.md"), fs.readFileSync(path.join(out, "properties.md"), "utf8").replace("fixture", "tampered"));
  assert.equal(checkFreshness(root, { outputDir: out }).fresh, false);
  project(root, { outputDir: out });
  fs.rmSync(out, { recursive: true, force: true });
  project(root, { outputDir: out });
  assert.deepEqual(extractTaggedFences(fs.readFileSync(path.join(out, "properties.md"), "utf8"), "code-intel"), [sourceBlock]);

  const legacyCodeIntel = validRoot();
  write(legacyCodeIntel, "kb/properties.md", `${sourceBlock}\n`);
  expectReason(() => project(legacyCodeIntel), "code-intel-source-missing");
  fs.appendFileSync(path.join(out, "spec.md"), "arbitrary edit with unchanged marker\n");
  assert.equal(checkFreshness(root, { outputDir: out }).projections.find((item) => item.file.endsWith("spec.md")).status, "stale");
  project(root, { outputDir: out });
  authority(root, { feature: ["requirement", "acceptance-criterion", "check", "decision"] });
  const checked = checkFreshness(root, { outputDir: out });
  assert.equal(checked.fresh, false);
  assert.ok(checked.projections.every((item) => item.status === "stale"));

  const symlinkRoot = validRoot();
  const outside = tempRoot();
  fs.symlinkSync(outside, path.join(symlinkRoot, "linked-output"));
  expectReason(() => project(symlinkRoot, { outputDir: "linked-output" }), "invalid-output");
  assert.deepEqual(fs.readdirSync(outside), ["specs"]);

  const componentRoot = validRoot();
  fs.mkdirSync(path.join(componentRoot, "generated"));
  fs.symlinkSync(outside, path.join(componentRoot, "generated/link"));
  expectReason(() => project(componentRoot, { outputDir: "generated/link/nested" }), "invalid-output");

  const targetRoot = validRoot();
  fs.mkdirSync(path.join(targetRoot, "generated"));
  const outsideTarget = write(outside, "outside-spec.md", "outside\n");
  fs.symlinkSync(outsideTarget, path.join(targetRoot, "generated/spec.md"));
  expectReason(() => project(targetRoot, { outputDir: "generated" }), "invalid-output");
  assert.equal(fs.readFileSync(outsideTarget, "utf8"), "outside\n");

  const atomicRoot = tempRoot();
  const atomicOut = path.join(atomicRoot, "output");
  write(atomicRoot, "output/one.md", "old one");
  write(atomicRoot, "output/two.md", "old two");
  const originalRmSync = fs.rmSync;
  fs.rmSync = (file, options) => {
    if (String(file).includes(".claims-bak-")) throw Object.assign(new Error("cleanup denied"), { code: "EACCES" });
    return originalRmSync(file, options);
  };
  try {
    writeAtomicSet(atomicOut, { "one.md": "new one", "two.md": "new two" }, atomicRoot);
  } finally {
    fs.rmSync = originalRmSync;
  }
  assert.equal(fs.readFileSync(path.join(atomicOut, "one.md"), "utf8"), "new one");
  assert.equal(fs.readFileSync(path.join(atomicOut, "two.md"), "utf8"), "new two");
});

test("[offline-context] disabling embeddings removes hints only", () => {
  const state = buildModel(validRoot());
  const enabled = buildContextManifest(state, { candidates: [{ id: "semantic" }] });
  const disabled = buildContextManifest(state, { embeddingsEnabled: false, candidates: [{ id: "semantic" }] });
  assert.deepEqual(enabled.mandatory_claims, disabled.mandatory_claims);
  assert.equal(enabled.model_digest, disabled.model_digest);
  assert.equal(enabled.freshness_digest, disabled.freshness_digest);
  assert.deepEqual(enabled.sources, ["specs/feature.md"]);
  assert.equal(enabled.candidates[0].kind, "hint");
  assert.equal(enabled.candidates[0].evidence, false);
  assert.equal(Object.hasOwn(disabled, "candidates"), false);
});

test("[neutral-manifest] exact three-key manifest accepts domain IDs and rejects intent fields", () => {
  const questions = ["Where is lending code loaded?"];
  const manifest = { questions, technical_ids: ["defi/FR-001"], digests: { questions: digest(questions) } };
  assert.deepEqual(validateNeutralManifest(manifest), canonicalize(manifest));
  for (const key of ["statement", "lifecycle", "authority", "task_intent"]) {
    expectReason(() => validateNeutralManifest({ ...manifest, [key]: "forbidden" }), "unknown-field");
  }
  expectReason(() => validateNeutralManifest({ ...manifest, digests: { questions: "0".repeat(64) } }), "neutral-digest-mismatch");
  const file = write(tempRoot(), "manifest.json", JSON.stringify(manifest));
  const result = spawnSync(process.execPath, [SCRIPT, "manifest-neutral", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), canonicalize(manifest));
});

test("[workflow-compatibility] projections qualify IDs, preserve code-intel bytes, and legacy check is non-blocking", () => {
  const root = validRoot();
  const invariant = '{"id":"INV-1","type":"layering","description":"no cycles","check":{"kind":"acyclic"}}';
  const original = `\`\`\`code-intel\n${invariant}\n\`\`\``;
  codeIntelSource(root, original);
  write(root, "kb/properties.md", `${original}\n`);

  const skill = [
    "---",
    "name: reconciliation-fixture-gate",
    "description: captures the exact resolver input",
    "version: 1.0.0",
    "capability: code-intel",
    "provides: gate",
    "entry: bash gate.sh",
    "requires_tools: []",
    "---",
    "",
  ].join("\n");
  const skillPath = write(root, ".agents/skills/reconciliation-fixture-gate/SKILL.md", skill);
  write(root, ".agents/skills/reconciliation-fixture-gate/gate.sh", [
    "#!/usr/bin/env bash",
    "cp \"$1\" \"$PWD/captured-invariants.jsonl\"",
    "if [[ -f \"$PWD/fail-gate\" ]]; then exit 1; fi",
    "exit 0",
    "",
  ].join("\n"));
  const skillDigest = crypto.createHash("sha256").update(fs.readFileSync(skillPath)).digest("hex");
  write(root, ".harness/code-intel-ack.json", `${JSON.stringify({ acks: [{ skill: "reconciliation-fixture-gate", sha256: skillDigest }] })}\n`);

  const runGate = () => spawnSync(process.execPath, [CODE_INTEL_SCRIPT, "gate", "--root", root], { encoding: "utf8" });
  const before = runGate();
  assert.equal(before.status, 0, `${before.stdout}\n${before.stderr}`);
  assert.match(before.stdout, /RESULT: pass/);
  const beforeInput = fs.readFileSync(path.join(root, "captured-invariants.jsonl"));
  assert.deepEqual(beforeInput, Buffer.from(`${invariant}\n`));
  assert.equal(codeIntelQaVerdict(before), "GO");
  write(root, "fail-gate", "fail\n");
  const violationBefore = runGate();
  assert.equal(violationBefore.status, 1, `${violationBefore.stdout}\n${violationBefore.stderr}`);
  assert.equal(codeIntelQaVerdict(violationBefore), "NO-GO");
  fs.rmSync(path.join(root, "fail-gate"));

  project(root);
  assert.equal(extractTaggedFences(fs.readFileSync(path.join(root, "kb/properties.md"), "utf8"), "code-intel")[0], original);
  assert.match(fs.readFileSync(path.join(root, "kb/spec.md"), "utf8"), /feature\/FR-001/);
  const after = runGate();
  assert.equal(after.status, 0, `${after.stdout}\n${after.stderr}`);
  assert.match(after.stdout, /RESULT: pass/);
  assert.equal(codeIntelQaVerdict(after), "GO");
  assert.deepEqual(fs.readFileSync(path.join(root, "captured-invariants.jsonl")), beforeInput);
  write(root, "fail-gate", "fail\n");
  const violation = runGate();
  assert.equal(violation.status, 1, `${violation.stdout}\n${violation.stderr}`);
  assert.match(violation.stdout, /RESULT: fail/);
  assert.equal(codeIntelQaVerdict(violation), "NO-GO");
  assert.equal(violation.status, violationBefore.status);
  assert.deepEqual(fs.readFileSync(path.join(root, "captured-invariants.jsonl")), beforeInput);

  const legacy = tempRoot();
  write(legacy, "specs/legacy.md", "## Functional Requirements\n- **FR-001**: legacy\n");
  const sentinel = write(legacy, "kb/spec.md", "legacy KB must survive\n");
  assert.deepEqual(checkFreshness(legacy), { fresh: true, status: "legacy/no-managed-claims", expected_digest: null, projections: [] });
  assert.deepEqual(project(legacy), { status: "legacy/no-managed-claims", model_digest: digest({ model_version: 1, claims: [], code_intel: [] }), freshness_digest: null, files: [] });
  assert.equal(fs.readFileSync(sentinel, "utf8"), "legacy KB must survive\n");

  const facade = spawnSync(process.execPath, [CHECK_SCRIPT, "audit-determinism"], { encoding: "utf8" });
  assert.equal(facade.status, 0, facade.stderr);
  const unknown = spawnSync(process.execPath, [CHECK_SCRIPT, "unknown"], { encoding: "utf8" });
  assert.equal(unknown.status, 2);
});

test("[workflow-compatibility] installed freshness hook executes and blocks stale projections", () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, "scripts/claims-reconcile.js"));
  fs.copyFileSync(path.join(__dirname, "lib/claims-reconcile.js"), path.join(root, "scripts/lib/claims-reconcile.js"));
  fs.cpSync(path.join(__dirname, "lib/claims-reconcile"), path.join(root, "scripts/lib/claims-reconcile"), { recursive: true });

  const runHook = () => spawnSync(
    process.execPath,
    [RUN_HOOK_SCRIPT, "pre", "roster-intake", HOOKS_DIR],
    { cwd: root, encoding: "utf8", env: { ...process.env, TASK: "fixture" } },
  );

  const legacy = runHook();
  assert.equal(legacy.status, 0, `${legacy.stdout}\n${legacy.stderr}`);

  write(root, "specs/feature.md", specDocument());
  authority(root);
  const stale = runHook();
  assert.equal(stale.status, 1, `${stale.stdout}\n${stale.stderr}`);
  assert.match(stale.stdout, /"outcome": "abort"/);
});
