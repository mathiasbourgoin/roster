"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  MODEL_VERSION,
  RENDERER_VERSION,
  SELECTION_POLICY_VERSION,
} = require("./constants");
const {
  assertProjectionTargetsSafe,
  canonicalize,
  digest,
  fail,
  normalizeString,
  relativePosix,
  resolveProjectionDirectory,
  stableStringify,
} = require("./core");
const { buildModel } = require("./model");

function freshness(modelState, versions = {}) {
  const input = {
    model_version: MODEL_VERSION,
    model_digest: modelState.model_digest,
    authority: modelState.authority,
    lock: modelState.lock,
    renderer_version: versions.rendererVersion || RENDERER_VERSION,
    selection_policy_version: versions.selectionPolicyVersion || SELECTION_POLICY_VERSION,
  };
  return { input: canonicalize(input), digest: digest(input) };
}

function extractTaggedFences(content, tag) {
  if (!content) return [];
  const blocks = [];
  let current = null;
  for (const line of normalizeString(content).split("\n")) {
    current = consumeTaggedFenceLine(line, tag, current, blocks);
  }
  return blocks;
}

function consumeTaggedFenceLine(line, tag, current, blocks) {
  if (!current) {
    const open = line.match(/^\s*(`{3,}|~{3,})([^`]*)$/);
    return open && open[2].trim() === tag
      ? { marker: open[1][0], length: open[1].length, lines: [line] }
      : null;
  }
  current.lines.push(line);
  const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
  if (!close || close[1][0] !== current.marker || close[1].length < current.length) return current;
  blocks.push(current.lines.join("\n"));
  return null;
}

function projectionMarker(state) {
  return stableStringify({
    freshness_digest: freshness(state).digest,
    model_digest: state.model_digest,
    renderer_version: RENDERER_VERSION,
    selection_policy_version: SELECTION_POLICY_VERSION,
  });
}

function activeClaims(state, record) {
  return state.model.claims.filter((claim) => claim.record === record && claim.lifecycle === "active");
}

function projectionLine(claim) {
  return `- **${claim.qualified_id}** [${claim.lifecycle}; ${claim.verification}]: ${claim.normative_text || claim.id}`;
}

function renderSpecProjection(state, frontmatter) {
  const residuals = state.model.claims.filter((claim) => claim.lifecycle === "pending-confirmation");
  return [
    frontmatter,
    "\n## Requirements\n", ...activeClaims(state, "requirement").map(projectionLine),
    "\n## Acceptance Criteria\n", ...activeClaims(state, "acceptance-criterion").map(projectionLine),
    "\n## Decisions\n", ...activeClaims(state, "decision").map(projectionLine),
    "\n## Terms\n", ...activeClaims(state, "term").map(projectionLine),
    "\n## Risks\n", ...activeClaims(state, "risk").map(projectionLine),
    "\n## Residual debt\n",
    ...residuals.map((claim) => `- **${claim.qualified_id}**: pending-confirmation; verification ${claim.verification}`),
    "",
  ].join("\n");
}

function renderPropertiesProjection(state, frontmatter) {
  const codeIntel = state.model.code_intel.map((block) => block.content);
  return [
    frontmatter,
    "\n## Invariants\n", ...activeClaims(state, "invariant").map(projectionLine),
    "\n## Runnable Checks\n", ...activeClaims(state, "check").map(projectionLine),
    ...(codeIntel.length ? ["\n## Code Intel\n", ...codeIntel] : []),
    "",
  ].join("\n");
}

function renderProjections(state) {
  const marker = `<!-- claims-projection ${projectionMarker(state)} -->`;
  const frontmatter = `---\ntitle: Claims projection\nstatus: derived\nschema-version: 2\n---\n\n${marker}\n`;
  const spec = renderSpecProjection(state, frontmatter);
  const properties = renderPropertiesProjection(state, frontmatter);
  const index = [frontmatter, "\n## Generated views\n", "- [Specification](spec.md)", "- [Properties](properties.md)", ""].join("\n");
  return { "spec.md": spec, "properties.md": properties, "index.md": index };
}

function stageAtomicFiles(outputDir, files, token, staged) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(outputDir, name);
    const temp = path.join(outputDir, `.${name}.claims-tmp-${token}`);
    fs.writeFileSync(temp, normalizeString(content), { flag: "wx" });
    staged.push({ target, temp });
  }
}

function commitAtomicFiles(staged, token, backups, committed) {
  for (const item of staged) {
    if (fs.existsSync(item.target)) {
      const backup = `${item.target}.claims-bak-${token}`;
      fs.renameSync(item.target, backup);
      backups.push({ target: item.target, backup });
    }
    fs.renameSync(item.temp, item.target);
    committed.push(item.target);
  }
}

function rollbackAtomicFiles(staged, backups, committed) {
  for (const item of staged) fs.rmSync(item.temp, { force: true });
  for (const target of committed) fs.rmSync(target, { force: true });
  for (const item of backups.reverse()) if (fs.existsSync(item.backup)) fs.renameSync(item.backup, item.target);
}

function cleanupBackups(backups) {
  for (const item of backups) {
    try {
      fs.rmSync(item.backup, { force: true });
    } catch {
      // The new set is fully committed; leftover backups are safer than a destructive rollback.
    }
  }
}

function writeAtomicSet(outputDir, files, root = fs.realpathSync(path.dirname(outputDir))) {
  outputDir = resolveProjectionDirectory(root, outputDir, true);
  assertProjectionTargetsSafe(root, outputDir, Object.keys(files));
  const token = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const backups = [];
  const committed = [];
  const staged = [];
  try {
    stageAtomicFiles(outputDir, files, token, staged);
    commitAtomicFiles(staged, token, backups, committed);
  } catch (error) {
    rollbackAtomicFiles(staged, backups, committed);
    throw error;
  }
  cleanupBackups(backups);
}

function project(root, options = {}) {
  const state = buildModel(root, options);
  if (state.managed_documents === 0) {
    return { status: "legacy/no-managed-claims", model_digest: state.model_digest, freshness_digest: null, files: [] };
  }
  const outputDir = resolveProjectionDirectory(state.root, options.outputDir || "kb", true);
  assertProjectionTargetsSafe(state.root, outputDir, ["index.md", "properties.md", "spec.md"]);
  const propertiesPath = path.join(outputDir, "properties.md");
  const existingProperties = fs.existsSync(propertiesPath) ? fs.readFileSync(propertiesPath, "utf8") : "";
  if (state.model.code_intel.length === 0 && extractTaggedFences(existingProperties, "code-intel").length > 0) {
    fail("code-intel-source-missing", "move the legacy code-intel block into a source spec before projecting");
  }
  const files = renderProjections(state);
  writeAtomicSet(outputDir, files, state.root);
  return {
    model_digest: state.model_digest,
    freshness_digest: freshness(state).digest,
    files: Object.keys(files).sort().map((name) => relativePosix(state.root, path.join(outputDir, name))),
  };
}

function readProjectionDigest(file) {
  if (!fs.existsSync(file)) return null;
  const match = fs.readFileSync(file, "utf8").match(/^<!-- claims-projection (\{.*\}) -->$/m);
  if (!match) return null;
  try {
    const marker = JSON.parse(match[1]);
    return typeof marker.freshness_digest === "string" ? marker.freshness_digest : null;
  } catch {
    return null;
  }
}

function projectionStatus(root, outputDir, name, expectedDigest, expectedContent) {
  const file = path.join(outputDir, name);
  if (!fs.existsSync(file)) return { file: relativePosix(root, file), status: "missing" };
  const actual = readProjectionDigest(file);
  const byteMatch = normalizeString(fs.readFileSync(file, "utf8")) === normalizeString(expectedContent);
  return { file: relativePosix(root, file), status: actual === expectedDigest && byteMatch ? "fresh" : "stale" };
}

function checkFreshness(root, options = {}) {
  const state = buildModel(root, options);
  if (state.managed_documents === 0) {
    return { fresh: true, status: "legacy/no-managed-claims", expected_digest: null, projections: [] };
  }
  const expected = freshness(state).digest;
  const outputDir = resolveProjectionDirectory(state.root, options.outputDir || "kb", false);
  assertProjectionTargetsSafe(state.root, outputDir, ["index.md", "properties.md", "spec.md"]);
  const expectedFiles = renderProjections(state);
  const projections = ["index.md", "properties.md", "spec.md"]
    .map((name) => projectionStatus(state.root, outputDir, name, expected, expectedFiles[name]));
  const fresh = projections.every((item) => item.status === "fresh");
  return { fresh, status: fresh ? "fresh" : "stale", expected_digest: expected, projections };
}

module.exports = {
  checkFreshness,
  extractTaggedFences,
  freshness,
  project,
  renderProjections,
  writeAtomicSet,
};
