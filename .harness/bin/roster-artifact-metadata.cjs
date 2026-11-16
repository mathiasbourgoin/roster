"use strict";
const y = require("./vendor/yaml-2.9.1.cjs");
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
class MetadataFault extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const reject = (reason) => { throw new MetadataFault(reason); };
function rejectProperties(node) {
  if (node && (y.isAlias(node) || node.anchor !== undefined || node.tag !== undefined)) reject("unsupported-yaml");
}
function admitScalar(node) {
  const value = node.value;
  if (value !== null && !["string", "boolean", "number"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)) reject("unsupported-yaml");
}
function admitMapping(node, depth, stack) {
  const seen = new Set();
  for (let index = node.items.length - 1; index >= 0; index--) {
    const pair = node.items[index], key = pair.key;
    rejectProperties(key);
    if (!y.isScalar(key) || typeof key.value !== "string") reject("unsupported-yaml");
    if (key.value === "<<" && key.type === "PLAIN") reject("unsupported-yaml");
    if (seen.has(key.value)) reject("parse");
    seen.add(key.value);
    stack.push([pair.value, depth + 1]);
  }
}
function admitContents(contents) {
  const stack = [[contents, 0]];
  let nodes = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (++nodes > 100000 || depth > 32) reject("limit");
    rejectProperties(node);
    if (node === null) continue;
    if (y.isScalar(node)) admitScalar(node);
    else if (y.isSeq(node)) {
      for (let index = node.items.length - 1; index >= 0; index--) stack.push([node.items[index], depth + 1]);
    } else if (y.isMap(node)) admitMapping(node, depth, stack);
    else reject("unsupported-yaml");
  }
}
function materializeContents(contents) {
  let result;
  const work = [[contents, value => { result = value; }]];
  while (work.length) {
    const [node, set] = work.pop();
    if (node === null) { set(null); continue; }
    if (y.isScalar(node)) { set(node.value); continue; }
    if (y.isSeq(node)) {
      const array = new Array(node.items.length);
      set(array);
      for (let index = node.items.length - 1; index >= 0; index--) work.push([node.items[index], value => { array[index] = value; }]);
    } else {
      const map = Object.create(null);
      set(map);
      for (const pair of node.items) work.push([pair.value, value => { map[pair.key.value] = value; }]);
    }
  }
  return result;
}
function parse(text, json = false) {
  try {
    if (json) JSON.parse(text); // Grammar only: duplicate-overwriting values are never authoritative.
    const document = y.parseDocument(text, { version: "1.2", schema: "core", strict: true, uniqueKeys: true, stringKeys: false, merge: false, resolveKnownTags: false, customTags: [], keepSourceTokens: true, logLevel: "warn" });
    if (document.errors.length) reject(document.errors.some(error => error.code === "RESOURCE_EXHAUSTION") ? "limit" : "parse");
    if (document.warnings.length || document.directives?.yaml?.explicit || /^%/m.test(text)) reject("unsupported-yaml");
    admitContents(document.contents); // Every decoded value is admitted before any ordinary-value conversion.
    return {value: materializeContents(document.contents), reason: null};
  } catch (error) {
    return {value: null, reason: error instanceof MetadataFault ? error.reason : error instanceof RangeError ? "limit" : "parse"};
  }
}
function frontmatter(text) {
  const match = /^\uFEFF?---\r?\n/.exec(text);
  if (!match) return { value: null, reason: "missing" };
  const start = match[0].length;
  const ending = /^---(?:\r?\n|$)/gm;
  ending.lastIndex = start;
  const end = ending.exec(text);
  if (!end) return { value: null, reason: "parse" };
  const source = text.slice(start, end.index);
  if (Buffer.byteLength(source) > 65536) return { value: null, reason: "limit" };
  const out = parse(source);
  return out.reason ? out : object(out.value) ? out : { value: null, reason: "wrong-type" };
}
function wellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n >= 55296 && n <= 56319) {
      const m = s.charCodeAt(++i);
      if (!(m >= 56320 && m <= 57343)) return false;
    } else if (n >= 56320 && n <= 57343) return false;
  }
  return true;
}
const strings = (x) => Array.isArray(x) && x.every((v) => typeof v === "string");
function semver(value) {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match || match[0] !== value) return false;
  const prerelease = match[4]?.split(".") || [];
  const build = match[5]?.split(".") || [];
  return prerelease.every(id => id.length > 0 && (!/^[0-9]+$/.test(id) || id === "0" || id[0] !== "0")) && build.every(id => id.length > 0);
}
const fields = { declaration: { name: "string", source: "string", version: "string", role: "string", tunables: "map" }, definition: { name: "string", display_name: "string", description: "string", model: "string", domain: "strings", tags: "strings", compatible_with: "strings", complexity: "complexity", version: "semver", author: "string", source: "url", pipeline_role: "pipeline", tunables: "map", requires: "requires", runtime_hints: "hints", entrypoints: "entrypoints", isolation: "isolation", overlay: "overlay", replaces: "strings" }, reported: { task: "string", status: "string", date: "string", round: "integer", cycle: "integer" } };
const required = /* @__PURE__ */ new Set(["name", "display_name", "description", "model", "domain", "tags", "compatible_with", "complexity"]);
function matches(v, type) {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "map":
      return object(v);
    case "strings":
      return strings(v);
    case "integer":
      return Number.isSafeInteger(v) && v >= 0;
    case "complexity":
      return ["low", "medium", "high"].includes(v);
    case "semver":
      return semver(v);
    case "url":
      try {
        return typeof v === "string" && !!new URL(v).protocol;
      } catch {
        return false;
      }
    case "pipeline":
      return object(v) && Object.entries(v).every(([k, x]) => ["triggered_by", "receives", "produces", "human_gate"].includes(k) && typeof x === "string" && (k !== "human_gate" || /^(before|after|both|none)(?: — .*)?$/.test(x)));
    case "requires":
      return Array.isArray(v) && v.every((x) => typeof x === "string" || object(x) && typeof x.name === "string" && ["mcp", "builtin", "cli"].includes(x.type) && Object.entries(x).every(([k, z]) => ["name", "type"].includes(k) || ["install", "check"].includes(k) && typeof z === "string" || k === "optional" && typeof z === "boolean"));
    case "hints":
      return object(v) && Object.values(v).every((x) => object(x) && Object.entries(x).every(([k, z]) => k === "model" && typeof z === "string"));
    case "entrypoints":
      return object(v) && Object.entries(v).every(([k, x]) => object(x) && Object.keys(x).every((k2) => k2 === "type") && (k === "claude-code" ? ["agent", "command", "rule", "hook"].includes(x.type) : k === "codex" ? ["agent", "skill", "cli", "agents-md"].includes(x.type) : false));
    case "isolation":
      return ["worktree", "none"].includes(v);
    case "overlay":
      return v === "personal";
    default:
      return false;
  }
}
function projectionState() {
  return {count: 0, result: {availability: "unknown", fields: {declaration: null, definition: null, reported: null}, issues: {items: [], total: 0, truncated: false}, truncated: false}};
}
function addIssue(state, field, reason) {
  const issues = state.result.issues;
  issues.total++;
  if (issues.items.length < 100) issues.items.push({field, reason});
  else issues.truncated = true;
}
function markLimit(state, field) {
  addIssue(state, field, "limit");
  state.result.truncated = true;
  return null;
}
function clipString(state, value, field) {
  if (!wellFormed(value)) { addIssue(state, field, "ill-formed-string"); return null; }
  if (value.length <= 2000) return value;
  let end = 2000;
  if (value.charCodeAt(end - 1) >= 55296 && value.charCodeAt(end - 1) <= 56319) end--;
  markLimit(state, field);
  return value.slice(0, end);
}
function clipMap(state, value, field, depth) {
  const output = {}, entries = Object.entries(value);
  if (entries.length > 64) markLimit(state, field);
  for (const [key, child] of entries.slice(0, 64)) {
    if (!wellFormed(key)) { addIssue(state, field, "ill-formed-string"); continue; }
    if (key.length > 2000) { markLimit(state, field); continue; }
    Object.defineProperty(output, key, {value: clip(state, child, field, depth + 1), enumerable: true, writable: true, configurable: true});
  }
  return output;
}
function clip(state, value, field, depth = 3) {
  if (++state.count > 1000 || depth > 8 || depth === 8 && value !== null && typeof value === "object" && Object.keys(value).length > 0) return markLimit(state, field);
  if (typeof value === "string") return clipString(state, value, field);
  if (Array.isArray(value)) {
    if (value.length > 100) markLimit(state, field);
    return value.slice(0, 100).map(child => clip(state, child, field, depth + 1));
  }
  return object(value) ? clipMap(state, value, field, depth) : value;
}
function blankGroup(name) {
  return Object.fromEntries(Object.keys(fields[name]).map(key => [key, null]));
}
function projectGroup(state, name, source, requiredFields = false) {
  const output = blankGroup(name);
  state.result.fields[name] = output;
  for (const [key, type] of Object.entries(fields[name])) {
    if (!Object.hasOwn(source, key)) {
      if (requiredFields && required.has(key)) addIssue(state, key, "missing");
      continue;
    }
    if (!matches(source[key], type)) { addIssue(state, key, "wrong-type"); continue; }
    output[key] = clip(state, source[key], key);
  }
  return output;
}
function measure(value) {
  let nodes = 0, depth = 0;
  const pending = [[value, 0]];
  while (pending.length) {
    const [child, level] = pending.pop();
    nodes++;
    depth = Math.max(depth, level);
    if (child !== null && typeof child === "object") for (const value of Object.values(child)) pending.push([value, level + 1]);
  }
  return {nodes, depth};
}
function largestPayload(result) {
  let selected = null;
  for (const group of Object.values(result.fields)) if (group) {
    for (const [field, value] of Object.entries(group)) if (value !== null && typeof value === "object") {
      const nodes = measure(value).nodes;
      if (!selected || nodes > selected.nodes) selected = {group, field, nodes};
    }
  }
  return selected;
}
function finishProjection(state) {
  const result = state.result;
  for (;;) {
    const size = measure(result);
    if (size.nodes <= 1000 && size.depth <= 8) break;
    const selected = largestPayload(result);
    if (!selected) throw Error("metadata fixed shape exceeds output bounds");
    selected.group[selected.field] = null;
    markLimit(state, selected.field);
  }
  if (result.issues.total) result.availability = "invalid";
  return result;
}
function projectDefinition(state, {text, id, declaration}) {
  const result = state.result;
  result.availability = declaration ? "valid" : "unknown";
  if (declaration) projectGroup(state, "declaration", declaration);
  if (typeof text !== "string") return;
  result.availability = "valid";
  const parsed = frontmatter(text);
  result.fields.definition = blankGroup("definition");
  if (parsed.reason) { addIssue(state, "definition", parsed.reason); return; }
  const definition = projectGroup(state, "definition", parsed.value, true);
  if (definition.name !== null && definition.name !== id) {
    definition.name = null;
    addIssue(state, "name", "name-mismatch");
  }
}
function projectTaskAlias(state, reported, source, task) {
  const aliases = ["task", "task_id"].filter(key => Object.hasOwn(source, key)).map(key => source[key]);
  if (!aliases.length) return;
  if (aliases.some(value => typeof value !== "string")) { reported.task = null; addIssue(state, "task", "wrong-type"); }
  else if (new Set(aliases).size > 1) { reported.task = null; addIssue(state, "task", "contradictory"); }
  else if (aliases[0] !== task) { reported.task = null; addIssue(state, "task", "task-mismatch"); }
  else reported.task = clip(state, aliases[0], "task");
}
function projectStatus(state, reported, source, text) {
  const statuses = [...text.matchAll(/^\*\*Status: (.*?)\*\*\r?$/gm)].map(match => match[1]);
  const hasFrontStatus = Object.hasOwn(source, "status"), frontStatus = source.status;
  if (typeof frontStatus === "string" && wellFormed(frontStatus)) statuses.push(frontStatus);
  if (new Set(statuses).size > 1) { reported.status = null; addIssue(state, "status", "contradictory"); }
  else if (!hasFrontStatus && statuses.length) reported.status = clip(state, statuses[0], "status");
}
function projectReported(state, {text, format, task}) {
  const result = state.result;
  result.availability = "valid";
  const parsed = format === "json" ? parse(text, true) : frontmatter(text);
  result.fields.reported = blankGroup("reported");
  if (parsed.reason) { addIssue(state, "reported", parsed.reason); return; }
  if (!object(parsed.value)) { addIssue(state, "reported", "wrong-type"); return; }
  const reported = projectGroup(state, "reported", parsed.value);
  projectTaskAlias(state, reported, parsed.value, task);
  if (format === "markdown") projectStatus(state, reported, parsed.value, text);
}
function metadata(input) {
  const state = projectionState();
  if (input.kind === "agent-definition") projectDefinition(state, input);
  else if (input.kind !== "manifest" && input.kind !== "agent-manifest") projectReported(state, input);
  return finishProjection(state);
}
module.exports = {metadata, parse, frontmatter};
