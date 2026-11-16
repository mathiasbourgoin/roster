"use strict";
const y = require("./vendor/yaml-2.9.1.cjs");
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
class MetadataFault extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const reject = (r) => {
  throw new MetadataFault(r);
};
function parse(text, json = false) {
  try {
    let property = function(n) {
      if (n && (y.isAlias(n) || n.anchor !== void 0 || n.tag !== void 0)) reject("unsupported-yaml");
    };
    if (json) JSON.parse(text);
    const d = y.parseDocument(text, { version: "1.2", schema: "core", strict: true, uniqueKeys: true, stringKeys: false, merge: false, resolveKnownTags: false, customTags: [], keepSourceTokens: true, logLevel: "warn" });
    if (d.errors.length) reject(d.errors.some((e) => e.code === "RESOURCE_EXHAUSTION") ? "limit" : "parse");
    if (d.warnings.length || d.directives?.yaml?.explicit || /^%/m.test(text)) reject("unsupported-yaml");
    const stack = [[d.contents, 0]];
    let nodes = 0;
    while (stack.length) {
      const [n, depth] = stack.pop();
      if (++nodes > 1e5 || depth > 32) reject("limit");
      property(n);
      if (n === null) continue;
      if (y.isScalar(n)) {
        const v = n.value;
        if (v !== null && !["string", "boolean", "number"].includes(typeof v) || typeof v === "number" && !Number.isFinite(v)) reject("unsupported-yaml");
      } else if (y.isSeq(n)) {
        for (let i = n.items.length - 1; i >= 0; i--) stack.push([n.items[i], depth + 1]);
      } else if (y.isMap(n)) {
        const seen = /* @__PURE__ */ new Set();
        for (let i = n.items.length - 1; i >= 0; i--) {
          const p = n.items[i], k = p.key;
          property(k);
          if (!y.isScalar(k) || typeof k.value !== "string") reject("unsupported-yaml");
          if (k.value === "<<" && k.type === "PLAIN") reject("unsupported-yaml");
          if (seen.has(k.value)) reject("parse");
          seen.add(k.value);
          stack.push([p.value, depth + 1]);
        }
      } else reject("unsupported-yaml");
    }
    let result;
    const work = [[d.contents, (v) => {
      result = v;
    }]];
    while (work.length) {
      const [n, set] = work.pop();
      if (n === null) {
        set(null);
        continue;
      }
      if (y.isScalar(n)) {
        set(n.value);
        continue;
      }
      if (y.isSeq(n)) {
        const a = new Array(n.items.length);
        set(a);
        for (let i = n.items.length - 1; i >= 0; i--) work.push([n.items[i], (v) => {
          a[i] = v;
        }]);
      } else {
        const o = /* @__PURE__ */ Object.create(null);
        set(o);
        for (const p of n.items) work.push([p.value, (v) => {
          o[p.key.value] = v;
        }]);
      }
    }
    return { value: result, reason: null };
  } catch (e) {
    return { value: null, reason: e instanceof MetadataFault ? e.reason : e instanceof RangeError ? "limit" : "parse" };
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
const semver = (x) => typeof x === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(x);
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
function metadata({ text, format, kind, id, task, declaration }) {
  const result = { availability: "unknown", fields: { declaration: null, definition: null, reported: null }, issues: { items: [], total: 0, truncated: false }, truncated: false };
  let count = 0;
  const issue = (field, reason) => {
    result.issues.total++;
    if (result.issues.items.length < 100) result.issues.items.push({ field, reason });
    else result.issues.truncated = true;
  };
  function clip(v, field, depth = 3) {
    if (++count > 1e3 || depth > 8 || depth === 8 && v !== null && typeof v === "object" && Object.keys(v).length > 0) {
      issue(field, "limit");
      result.truncated = true;
      return null;
    }
    if (typeof v === "string") {
      if (!wellFormed(v)) {
        issue(field, "ill-formed-string");
        return null;
      }
      if (v.length > 2e3) {
        let end = 2e3;
        if (v.charCodeAt(end - 1) >= 55296 && v.charCodeAt(end - 1) <= 56319) end--;
        issue(field, "limit");
        result.truncated = true;
        return v.slice(0, end);
      }
      return v;
    }
    if (Array.isArray(v)) {
      if (v.length > 100) {
        issue(field, "limit");
        result.truncated = true;
      }
      return v.slice(0, 100).map((x) => clip(x, field, depth + 1));
    }
    if (object(v)) {
      const out = {}, entries = Object.entries(v);
      if (entries.length > 64) {
        issue(field, "limit");
        result.truncated = true;
      }
      for (const [k, x] of entries.slice(0, 64)) {
        if (!wellFormed(k)) {
          issue(field, "ill-formed-string");
          continue;
        }
        if (k.length > 2e3) {
          issue(field, "limit");
          result.truncated = true;
          continue;
        }
        Object.defineProperty(out, k, { value: clip(x, field, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    return v;
  }
  function group(name, value, requiredFields = false) {
    const out = Object.fromEntries(Object.keys(fields[name]).map((k) => [k, null]));
    result.fields[name] = out;
    for (const [key, type] of Object.entries(fields[name])) {
      if (!Object.hasOwn(value, key)) {
        if (requiredFields && required.has(key)) issue(key, "missing");
        continue;
      }
      if (!matches(value[key], type)) {
        issue(key, "wrong-type");
        continue;
      }
      out[key] = clip(value[key], key);
    }
    return out;
  }
  function measure(value) {
    let nodes = 0, depth = 0;
    const pending = [[value, 0]];
    while (pending.length) {
      const [v, d] = pending.pop();
      nodes++;
      depth = Math.max(depth, d);
      if (v !== null && typeof v === "object") for (const child of Object.values(v)) pending.push([child, d + 1]);
    }
    return { nodes, depth };
  }
  function finish() {
    for (; ; ) {
      const size = measure(result);
      if (size.nodes <= 1e3 && size.depth <= 8) break;
      let selected = null;
      for (const group2 of Object.values(result.fields)) if (group2) {
        for (const [field, value] of Object.entries(group2)) if (value !== null && typeof value === "object") {
          const n = measure(value).nodes;
          if (!selected || n > selected.nodes) selected = { group: group2, field, nodes: n };
        }
      }
      if (!selected) throw Error("metadata fixed shape exceeds output bounds");
      selected.group[selected.field] = null;
      issue(selected.field, "limit");
      result.truncated = true;
    }
    if (result.issues.total) result.availability = "invalid";
    return result;
  }
  let parsed = null;
  if (kind === "agent-definition") {
    result.availability = declaration ? "valid" : "unknown";
    if (declaration) group("declaration", declaration);
    if (typeof text !== "string") {
      return finish();
    }
    result.availability = "valid";
    parsed = frontmatter(text);
    result.fields.definition = Object.fromEntries(Object.keys(fields.definition).map((k) => [k, null]));
    if (parsed.reason) issue("definition", parsed.reason);
    else {
      const d = group("definition", parsed.value, true);
      if (d.name !== null && d.name !== id) {
        d.name = null;
        issue("name", "name-mismatch");
      }
    }
  } else if (kind !== "manifest" && kind !== "agent-manifest") {
    result.availability = "valid";
    parsed = format === "json" ? parse(text, true) : frontmatter(text);
    result.fields.reported = Object.fromEntries(Object.keys(fields.reported).map((k) => [k, null]));
    if (parsed.reason) issue("reported", parsed.reason);
    else if (!object(parsed.value)) issue("reported", "wrong-type");
    else {
      const r = group("reported", parsed.value), aliases = ["task", "task_id"].filter((k) => Object.hasOwn(parsed.value, k)).map((k) => parsed.value[k]);
      if (aliases.length) {
        if (aliases.some((v) => typeof v !== "string")) {
          r.task = null;
          issue("task", "wrong-type");
        } else if (new Set(aliases).size > 1) {
          r.task = null;
          issue("task", "contradictory");
        } else if (aliases[0] !== task) {
          r.task = null;
          issue("task", "task-mismatch");
        } else r.task = clip(aliases[0], "task");
      }
      if (format === "markdown") {
        const statuses = [...text.matchAll(/^\*\*Status: (.*?)\*\*\r?$/gm)].map((m) => m[1]);
        const hasFrontStatus = Object.hasOwn(parsed.value, "status");
        const frontStatus = parsed.value.status;
        if (typeof frontStatus === "string" && wellFormed(frontStatus)) statuses.push(frontStatus);
        if (new Set(statuses).size > 1) {
          r.status = null;
          issue("status", "contradictory");
        } else if (!hasFrontStatus && statuses.length) r.status = clip(statuses[0], "status");
      }
    }
  }
  return finish();
}
module.exports = { metadata, parse, frontmatter };
