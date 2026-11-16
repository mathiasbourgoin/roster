"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { TextDecoder } = require("node:util");
const io = require("./roster-artifacts.cjs");
const { ObservationError } = require("./roster-pipeline.cjs");
const ID = "https://github.com/mathiasbourgoin/roster/schema/artifact-observation/v1";
const SHA = /^[a-f0-9]{64}$/;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const safe = (x) => typeof x === "string" && x.length <= 120 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x);
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
const fail = (code) => {
  throw new ObservationError(code, code.replaceAll("_", " "));
};
const canonical = (x) => JSON.stringify(order(x));
function order(x) {
  return Array.isArray(x) ? x.map(order) : object(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, order(x[k])])) : x;
}
const token = (x) => Buffer.from(canonical(x)).toString("base64url");
const LIMITS = { source_bytes: 16777216, response_bytes: 2097152, page_bytes: { min: 4, default: 65536, max: 131072 }, catalog_items: { min: 1, default: 25, max: 100 }, scan_entries: 1e4, catalog_bytes: 33554432, ref_bytes: 4096, cursor_bytes: 8192, metadata: { frontmatter_bytes: 65536, input_depth: 32, input_nodes: 1e5, output_depth: 8, output_nodes: 1e3, map_keys: 64, array_items: 100, string_units: 2e3, issue_items: 100, agent_entries: 1e4 } };
const KINDS = [["spec", "specs/", ".md"], ["intake", "briefs/", "-intake.md"], ["spec-result", "briefs/", "-spec.md"], ["plan", "briefs/", "-plan.md"], ["plan-data", "briefs/", "-plan.json"], ["implementer-brief", "briefs/", "-implementer.md"], ["reviewer-brief", "briefs/", "-reviewer.md"], ["qa-scope", "briefs/", "-qa-scope.md"], ["implementation", "briefs/", "-impl.md"], ["review", "briefs/", "-review.json"], ["qa-state", "briefs/", "-qa-state.json"], ["qa", "briefs/", "-qa.md"], ["ledger", "briefs/", "-state.json"], ["manifest", "briefs/", "-manifest.txt"]];
const MAPPINGS = { "bin/roster-pipeline.cjs": "scripts/roster-pipeline.cjs", "bin/roster-pipeline-ledger.cjs": "scripts/roster-pipeline-ledger.cjs", "bin/roster-artifacts.cjs": "scripts/roster-artifacts.cjs", "bin/lib/review/finding-schema.cjs": "scripts/lib/review/finding-schema.cjs", "roadmap/pipeline-observation.schema.json": "schema/pipeline-observation.schema.json", "roadmap/pipeline-coverage.json": "schema/pipeline-coverage.json", "roadmap/qa-state.schema.json": "schema/qa-state.schema.json", "bin/roster-artifact-observation.cjs": "scripts/roster-artifact-observation.cjs", "bin/roster-artifact-metadata.cjs": "scripts/roster-artifact-metadata.cjs", "bin/vendor/yaml-2.9.1.cjs": "scripts/vendor/yaml-2.9.1.cjs", "bin/vendor/yaml-2.9.1.LICENSE": "scripts/vendor/yaml-2.9.1.LICENSE", "bin/vendor/yaml-2.9.1.provenance.json": "scripts/vendor/yaml-2.9.1.provenance.json", "roadmap/artifact-observation.schema.json": "schema/artifact-observation.schema.json", "roadmap/artifact-coverage.json": "schema/artifact-coverage.json", "roadmap/artifact-observation.manifest.json": "scripts/artifact-observation.manifest.json" };
function decode(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail("invalid_utf8");
  }
}
function serialize(x) {
  const text = JSON.stringify(x);
  if (typeof text !== "string" || Buffer.byteLength(text) > LIMITS.response_bytes) fail("output_limit");
  return text;
}
function keys(x, expected) {
  return object(x) && Object.keys(x).sort().join(",") === expected.slice().sort().join(",");
}
function resources() {
  try {
    const installed = path.basename(__dirname) === "bin" && path.basename(path.dirname(__dirname)) === ".harness";
    const base = path.resolve(__dirname, "..");
    const buffers = /* @__PURE__ */ new Map();
    for (const [logical, source2] of Object.entries(MAPPINGS)) buffers.set(logical, io.readBytes(path.join(base, installed ? logical : source2), { strict: true }));
    const manifestBytes = buffers.get("roadmap/artifact-observation.manifest.json"), manifest = JSON.parse(decode(manifestBytes));
    if (!manifestBytes.equals(Buffer.from(JSON.stringify(manifest, null, 2) + "\n"))) throw Error();
    if (!keys(manifest, ["manifest_version", "members"]) || manifest.manifest_version !== 1 || !Array.isArray(manifest.members) || manifest.members.length !== 14) throw Error();
    const expected = Object.keys(MAPPINGS).filter((p) => p !== "roadmap/artifact-observation.manifest.json").sort();
    manifest.members.forEach((m, i) => {
      if (!keys(m, ["logical", "source", "sha256", "bytes"]) || m.logical !== expected[i] || m.source !== MAPPINGS[m.logical] || m.sha256 !== hash(buffers.get(m.logical)) || m.bytes !== buffers.get(m.logical).length) throw Error();
    });
    const schemaBytes = buffers.get("roadmap/artifact-observation.schema.json"), schema = JSON.parse(decode(schemaBytes));
    if (schema.$id !== ID || schema.$schema !== "http://json-schema.org/draft-07/schema#") throw Error();
    const { $id, ...rules } = schema;
    const validator = require("./lib/review/finding-schema.cjs").compile(rules);
    const coverage = JSON.parse(decode(buffers.get("roadmap/artifact-coverage.json")));
    if (!keys(coverage, ["coverage_version", "entries"]) || coverage.coverage_version !== 1 || !Array.isArray(coverage.entries) || coverage.entries.length !== 12) throw Error();
    const cats = ["task-artifacts", "project-agent-definitions", "manifest-body", "metadata", "roadmap-persisted-observations", "legacy-phase-history", "arbitrary-manifest-targets", "historical-report-bodies", "generated-project-inventory", "global-project-inventory", "live-execution", "authenticated-session-joins"];
    coverage.entries.forEach((e, i) => {
      if (!keys(e, ["id", "availability", "source", "authority", "limitations"]) || e.id !== cats[i] || e.availability !== (i < 4 ? "supported" : i < 6 ? "delegated" : "unsupported") || ![e.source, e.authority, e.limitations].every((s) => typeof s === "string" && s.length <= 2e3)) throw Error();
    });
    const provenance = JSON.parse(decode(buffers.get("bin/vendor/yaml-2.9.1.provenance.json")));
    if (provenance.version !== "2.9.1" || provenance.bundle.bytes !== buffers.get("bin/vendor/yaml-2.9.1.cjs").length || provenance.license.bytes !== buffers.get("bin/vendor/yaml-2.9.1.LICENSE").length || provenance.bundle.sha256 !== hash(buffers.get("bin/vendor/yaml-2.9.1.cjs")) || provenance.license.sha256 !== hash(buffers.get("bin/vendor/yaml-2.9.1.LICENSE"))) throw Error();
    return { digest: hash(schemaBytes), fingerprint: hash(canonical([...buffers].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([p, b]) => [p, hash(b)]))), coverage, validator };
  } catch {
    fail("runtime_resource");
  }
}
function envelope(kind, source2, data, r) {
  const expected = kind === "artifact-capabilities" ? ["limits", "coverage", "reference_version", "cursor_version"] : kind === "artifact-list" ? ["availability", "items", "total", "next_cursor", "invalid_entries", "context"] : ["ref", "sha256", "total_bytes", "range", "text", "next_cursor", "eof"];
  if (!keys(data, expected) || kind === "artifact-capabilities" !== (source2 === null)) fail("runtime_resource");
  const out = { schema_version: 1, kind, schema: { id: ID, digest: r.digest }, source: source2, data };
  if (!r.validator.validate(out).valid) fail("runtime_resource");
  serialize(out);
  return out;
}
function shape(options, allowed) {
  if (!object(options) || Object.keys(options).some((k) => !allowed.includes(k))) fail("invalid_request");
}
function bounded(n, limit) {
  if (n === void 0) return limit.default;
  if (!Number.isSafeInteger(n) || n < limit.min || n > limit.max) fail("invalid_request");
  return n;
}
function source(options, read = false) {
  const { root, scope } = options, task = options.task === void 0 ? null : options.task;
  if (typeof root !== "string" || !root || root.includes("\0") || !["task", "project"].includes(scope)) fail("invalid_request");
  if (scope === "project" ? task !== null : task !== null && !safe(task)) fail("invalid_request");
  if (read && scope === "task" && task === null) fail("invalid_request");
  const absolute = path.resolve(root);
  return { absolute, source: { id: hash(canonical(["artifact-source/v1", absolute, scope, task])), scope, task } };
}
function admitRoot(root) {
  try {
    io.safeAncestors(root);
    if (!fs.lstatSync(root).isDirectory()) fail("unsafe_source");
    fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK);
  } catch (e) {
    if (e instanceof ObservationError) throw e;
    if (e.code === "ENOENT" || e.code === "EACCES") fail("read_failed");
    fail("unsafe_source");
  }
}
function parseToken(value, kind) {
  const code = kind === "ref" ? "invalid_reference" : "invalid_cursor";
  if (kind === "cursor" && (value === void 0 || value === null)) return null;
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > (kind === "ref" ? 4096 : 8192) || !/^[A-Za-z0-9_-]+$/.test(value)) fail(code);
  try {
    const raw = Buffer.from(value, "base64url");
    let x;
    try {
      x = JSON.parse(decode(raw));
    } catch {
      fail(code);
    }
    const expected = kind === "ref" ? ["v", "source_id", "scope", "task", "kind", "id", "sha256"] : ["v", "operation", "source_id", "fingerprint", "offset"];
    if (!keys(x, expected) || x.v !== 1 || !SHA.test(x.source_id) || token(x) !== value) fail(code);
    if (kind === "ref") {
      if (!["task", "project"].includes(x.scope) || !(x.task === null || safe(x.task)) || !safe(x.id) || typeof x.kind !== "string" || !SHA.test(x.sha256)) fail(code);
    } else if (!["artifact-list", "artifact-read"].includes(x.operation) || !SHA.test(x.fingerprint) || (!Number.isSafeInteger(x.offset) || x.offset < 0)) fail(code);
    return x;
  } catch {
    fail(code);
  }
}
function cursorFor(operation, sid, fingerprint, offset) {
  return token({ v: 1, operation, source_id: sid, fingerprint, offset });
}
function cursorOffset(c, operation, sid, fp, max) {
  if (!c) return 0;
  if (c.operation !== operation || c.source_id !== sid || c.fingerprint !== fp) fail("stale_cursor");
  if (c.offset < 0 || c.offset > max) fail("invalid_cursor");
  return c.offset;
}
function filetype(file) {
  try {
    const s = fs.lstatSync(file);
    return { presence: true, type: s.isSymbolicLink() ? "symlink" : s.isFile() ? "file" : s.isDirectory() ? "directory" : "other" };
  } catch (e) {
    if (e.code === "ENOENT") return { presence: false, type: "missing" };
    fail("read_failed");
  }
}
function budget() {
  let used = 0;
  const consume = (n) => {
    used += n;
    if (used > LIMITS.catalog_bytes) fail("output_limit");
  };
  consume.beforeRead = (n) => {
    if (used + n > LIMITS.catalog_bytes) fail("output_limit");
  };
  return consume;
}
function bodyRead(file, consume) {
  try {
    const b = io.readBytes(file, { strict: true, onRead: consume, beforeRead: consume.beforeRead });
    return { bytes: b, text: decode(b), sha256: hash(b) };
  } catch (e) {
    if (e instanceof ObservationError) throw e;
    if (e.reason === "changed") {
      const fault = new ObservationError("stale_reference", "stale reference");
      fault.sourceChanged = true;
      throw fault;
    }
    if (e.code === "ENOENT") fail("stale_reference");
    fail(e.reason === "unsafe" ? "unsafe_source" : e.reason === "oversized" ? "oversized_source" : e.reason === "changed" ? "stale_reference" : "read_failed");
  }
}
function statSnapshot(file) {
  try {
    const s = fs.lstatSync(file);
    return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink, s.mode];
  } catch (e) {
    if (e.code === "ENOENT") return null;
    fail("read_failed");
  }
}
function unchanged(file, before) {
  if (canonical(statSnapshot(file)) !== canonical(before)) fail("stale_reference");
}
function taskInventory(root, task) {
  let entries = 0, dirs = 0;
  const names = /* @__PURE__ */ new Set();
  for (const dir of ["briefs/", "specs/"]) {
    const target = path.join(root, dir);
    let handle;
    try {
      try {
        io.safeAncestors(target);
      } catch {
        fail("unsafe_source");
      }
      let st;
      try {
        st = fs.lstatSync(target);
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      if (!st.isDirectory()) fail("unsafe_source");
      dirs++;
      handle = fs.opendirSync(target);
      for (; ; ) {
        const e = handle.readSync();
        if (!e) break;
        if (++entries > LIMITS.scan_entries) fail("output_limit");
        for (const [, d, suffix] of KINDS) {
          if (d !== dir || !e.name.endsWith(suffix)) continue;
          const t = e.name.slice(0, -suffix.length);
          if (safe(t)) names.add(t);
        }
      }
    } catch (e) {
      if (e instanceof ObservationError) throw e;
      fail("read_failed");
    } finally {
      if (handle) handle.closeSync();
    }
  }
  const selected = [...names].sort().filter((t) => task === null || t === task), slots = [];
  for (const t of selected) for (const [kind, dir, suffix] of KINDS) slots.push({ scope: "task", task: t, kind, id: t, relative: dir + t + suffix });
  return { slots, total: task !== null && !selected.length ? null : dirs ? slots.length : null, status: task !== null && !selected.length ? "absent" : dirs ? "valid" : "absent", reason: task !== null && !selected.length ? "task-absent" : dirs ? null : "directories-absent", invalid: [], manifest: null, manifestSHA: null };
}
function unknownMetadata() {
  return { availability: "unknown", fields: { declaration: null, definition: null, reported: null }, issues: { items: [], total: 0, truncated: false }, truncated: false };
}
function item(root, slot, consume, read = null) {
  let body, observation = read;
  try {
    if (!observation) observation = bodyRead(path.join(root, slot.relative), consume);
    const sid = source({ root, scope: slot.scope, task: slot.task }).source.id;
    body = { availability: "valid", reason: null, sha256: observation.sha256, total_bytes: observation.bytes.length, ref: token({ v: 1, source_id: sid, scope: slot.scope, task: slot.task, kind: slot.kind, id: slot.id, sha256: observation.sha256 }) };
  } catch (e) {
    if (e.code === "output_limit") throw e;
    const reasons = { stale_reference: "not-found", unsafe_source: "unsafe-source", oversized_source: "oversized-source", invalid_utf8: "invalid-utf8", read_failed: "read-failed" };
    body = { availability: e.code === "stale_reference" && !e.sourceChanged ? "absent" : "invalid", reason: e.sourceChanged ? "source-changed" : reasons[e.code] || "read-failed", sha256: null, total_bytes: null, ref: null };
  }
  const format = slot.relative.endsWith(".md") ? "markdown" : slot.relative.endsWith(".json") ? "json" : "text";
  const metadata = observation || slot.kind === "agent-definition" ? require("./roster-artifact-metadata.cjs").metadata({ text: observation?.text ?? null, format, kind: slot.kind, id: slot.id, task: slot.task, declaration: slot.declaration }) : unknownMetadata();
  return { id: slot.id, kind: slot.kind, scope: slot.scope, task: slot.task, format, body, metadata, use: { availability: "unknown", reason: "not-observed", session: null } };
}
function inventory(root, s, consume) {
  return s.scope === "task" ? taskInventory(root, s.task) : projectInventory(root, consume);
}
function projectInventory(root, consume) {
  const file = path.join(root, ".harness/harness.json"), snapshot = statSnapshot(file);
  const base = { slots: [], total: null, status: "absent", reason: "manifest-absent", invalid: [], manifest: null, manifestSHA: null, manifestRead: null, snapshot };
  if (snapshot === null) return base;
  const observation = bodyRead(file, consume);
  base.manifestRead = observation;
  base.manifestSHA = observation.sha256;
  base.manifest = item(root, { scope: "project", task: null, id: "harness", kind: "agent-manifest", relative: ".harness/harness.json" }, consume, observation);
  const parsed = require("./roster-artifact-metadata.cjs").parse(observation.text, true), value = parsed.value;
  if (parsed.reason || !object(value) || !object(value.layers) || !Array.isArray(value.layers.agents) || value.layers.agents.length > 1e4) {
    base.status = "invalid";
    base.reason = "manifest-invalid";
    return base;
  }
  const agents = value.layers.agents, counts = /* @__PURE__ */ new Map();
  for (const a of agents) if (object(a) && safe(a.name)) counts.set(a.name, (counts.get(a.name) || 0) + 1);
  for (let index = 0; index < agents.length; index++) {
    const a = agents[index];
    const reason = !object(a) ? "wrong-type" : !Object.hasOwn(a, "name") ? "missing-name" : typeof a.name !== "string" ? "wrong-type" : !safe(a.name) ? "unsafe-name" : counts.get(a.name) > 1 ? "duplicate-name" : null;
    if (reason) base.invalid.push({ source_index: index, reason });
    else base.slots.push({ scope: "project", task: null, kind: "agent-definition", id: a.name, relative: ".harness/agents/" + a.name + ".md", declaration: a });
  }
  base.slots.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  base.total = base.invalid.length ? null : base.slots.length;
  base.status = "valid";
  base.reason = null;
  return base;
}
function artifactCapabilities(...args) {
  if (args.length) fail("invalid_request");
  const r = resources();
  return envelope("artifact-capabilities", null, { limits: LIMITS, coverage: r.coverage, reference_version: 1, cursor_version: 1 }, r);
}
function artifactList(options) {
  shape(options, ["root", "scope", "task", "limit", "cursor"]);
  const limit = bounded(options.limit, LIMITS.catalog_items), binding = source(options), c = parseToken(options.cursor, "cursor");
  const r = resources();
  admitRoot(binding.absolute);
  const consume = budget(), inv = inventory(binding.absolute, binding.source, consume);
  const tuples = inv.slots.map((s) => {
    const f = filetype(path.join(binding.absolute, s.relative));
    return [s.scope, s.task, s.kind, s.id, f.presence, f.type];
  });
  const fp = hash(canonical(["artifact-list/v1", binding.source.id, binding.source.scope, binding.source.task, tuples, inv.manifestSHA, inv.invalid.map((e) => [e.source_index, e.reason]), r.fingerprint]));
  const offset = cursorOffset(c, "artifact-list", binding.source.id, fp, inv.slots.length), items = inv.slots.slice(offset, offset + limit).map((s) => item(binding.absolute, s, consume));
  if (inv.snapshot) unchanged(path.join(binding.absolute, ".harness/harness.json"), inv.snapshot);
  return envelope("artifact-list", binding.source, { availability: { status: inv.status, reason: inv.reason }, items, total: inv.total, next_cursor: offset + items.length < inv.slots.length ? cursorFor("artifact-list", binding.source.id, fp, offset + items.length) : null, invalid_entries: { items: inv.invalid.slice(0, 100), total: inv.invalid.length, truncated: inv.invalid.length > 100 }, context: { project_manifest: inv.manifest } }, r);
}
function artifactRead(options) {
  shape(options, ["root", "scope", "task", "ref", "pageBytes", "cursor"]);
  const size = bounded(options.pageBytes, LIMITS.page_bytes), binding = source(options, true), ref = parseToken(options.ref, "ref"), c = parseToken(options.cursor, "cursor"), s = binding.source;
  if (ref.source_id !== s.id || ref.scope !== s.scope || ref.task !== s.task) fail("invalid_reference");
  let slot;
  if (s.scope === "task") {
    const k = KINDS.find((k2) => k2[0] === ref.kind);
    if (!k || ref.id !== s.task) fail("invalid_reference");
    slot = { scope: s.scope, task: s.task, id: s.task, kind: k[0], relative: k[1] + s.task + k[2] };
  } else if (!["agent-definition", "agent-manifest"].includes(ref.kind) || ref.kind === "agent-manifest" && ref.id !== "harness") fail("invalid_reference");
  const r = resources();
  admitRoot(binding.absolute);
  const consume = budget();
  let inv;
  if (s.scope === "project") {
    inv = projectInventory(binding.absolute, consume);
    slot = ref.kind === "agent-manifest" ? { scope: "project", task: null, id: "harness", kind: "agent-manifest", relative: ".harness/harness.json" } : inv.slots.find((x) => x.id === ref.id);
    if (!slot) fail("stale_reference");
  }
  const observation = inv && ref.kind === "agent-manifest" ? inv.manifestRead : bodyRead(path.join(binding.absolute, slot.relative), consume);
  if (!observation) fail("stale_reference");
  if (inv?.snapshot) unchanged(path.join(binding.absolute, ".harness/harness.json"), inv.snapshot);
  if (ref.sha256 !== observation.sha256) fail("stale_reference");
  const b = observation.bytes, n = b.length;
  const fp = hash(canonical(["artifact-read/v1", s.id, s.scope, s.task, ref.kind, ref.id, observation.sha256, n, r.fingerprint]));
  const offset = cursorOffset(c, "artifact-read", s.id, fp, n);
  if (offset < n && (b[offset] & 192) === 128) fail("invalid_cursor");
  let end = Math.min(n, offset + size);
  while (end < n && (b[end] & 192) === 128) end--;
  return envelope("artifact-page", s, { ref: options.ref, sha256: observation.sha256, total_bytes: n, range: { start: offset, end }, text: decode(b.subarray(offset, end)), next_cursor: end < n ? cursorFor("artifact-read", s.id, fp, end) : null, eof: end === n }, r);
}
function main(command, args) {
  const read = command === "artifact-read", list = command === "artifact-list";
  if (!read && !list && command !== "artifact-capabilities") fail("invalid_request");
  const allowed = read ? ["root", "scope", "task", "ref", "page-bytes", "cursor"] : list ? ["root", "scope", "task", "limit", "cursor"] : [];
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flag.startsWith("--") || !allowed.includes(flag.slice(2)) || i + 1 >= args.length) fail("invalid_request");
    const key = flag.slice(2) === "page-bytes" ? "pageBytes" : flag.slice(2);
    if (Object.hasOwn(options, key)) fail("invalid_request");
    let value = args[i + 1];
    if (["limit", "pageBytes"].includes(key)) {
      if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) fail("invalid_request");
      value = Number(value);
    }
    options[key] = value;
  }
  process.stdout.write(serialize(read ? artifactRead(options) : list ? artifactList(options) : artifactCapabilities()) + "\n");
}
function guard(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (e) {
      if (e instanceof ObservationError) throw e;
      fail("read_failed");
    }
  };
}
module.exports = { artifactCapabilities: guard(artifactCapabilities), artifactList: guard(artifactList), artifactRead: guard(artifactRead), main: guard(main) };
