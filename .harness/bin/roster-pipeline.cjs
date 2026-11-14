#!/usr/bin/env node
"use strict";
// Read-only, bounded observations of persisted standalone pipeline evidence.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const LIMITS = Object.freeze({source_bytes:16777216, output_bytes:2097152, scan_entries:10000,
  string_units:2000, summary_items:100, catalog_default:25, catalog_max:100,
  history_default:50, history_max:200, cursor_units:4096});
const SCHEMA_ID = "https://github.com/mathiasbourgoin/roster/schema/pipeline-observation/v1";
const TASK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
class ObservationError extends Error {
  constructor(code, message) { super(String(message).slice(0,2000)); this.name = "ObservationError"; this.code = code; }
}
const fail = (code, message) => { throw new ObservationError(code, message); };
let io, ledgerValidator, bootstrapError;
try { io = require("./roster-artifacts.cjs"); ledgerValidator = require("./roster-pipeline-ledger.cjs").validateLedger; }
catch (error) { bootstrapError = error; }
function validateLedger(value, expectedTask) {
  if (bootstrapError) fail("runtime-resource", "Required runtime companion unavailable");
  return ledgerValidator(value, expectedTask);
}
function serialize(value) {
  const text = JSON.stringify(value);
  if (typeof text !== "string" || Buffer.byteLength(text,"utf8") > LIMITS.output_bytes)
    fail("output-limit", "Observation exceeds 2 MiB serialized UTF-8 limit");
  return text;
}
function optionsFor(options, allowed) {
  if (!object(options) || Object.keys(options).some(key => !allowed.includes(key))) fail("invalid-request", "Unknown or invalid options");
  if (options.schema_version !== undefined && options.schema_version !== 1) fail("unsupported-version", "Only schema_version 1 is supported");
}
function pageLimit(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail("invalid-request", `Page limit must be an integer in 1..${maximum}`);
  return value;
}
function rootPath(root) {
  if (typeof root !== "string" || !root || root.includes("\0")) fail("invalid-request", "Root must be a nonempty path");
  const absolute = path.resolve(root);
  if (absolute.length > LIMITS.string_units) fail("output-limit", "Resolved root exceeds string limit");
  return absolute;
}
function taskName(task) {
  if (typeof task !== "string" || task.length > 120 || !TASK.test(task)) fail("invalid-request", "Task must be a safe canonical identifier");
}
function resources() {
  try {
    if (bootstrapError || typeof io.readBytes !== "function" || typeof ledgerValidator !== "function") throw new Error("runtime companions");
    const installed = path.basename(__dirname) === "bin" && path.basename(path.dirname(__dirname)) === ".harness";
    const directory = path.resolve(__dirname, "..", installed ? "roadmap" : "schema");
    const read = name => { const bytes = io.readBytes(path.join(directory,name)); return {bytes,value:JSON.parse(bytes.toString("utf8"))}; };
    const schema = read("pipeline-observation.schema.json"), coverage = read("pipeline-coverage.json"), qa = read("qa-state.schema.json");
    if (!object(schema.value) || schema.value.$schema !== "http://json-schema.org/draft-07/schema#" || schema.value.$id !== SCHEMA_ID ||
        schema.value.type !== "object" || !object(schema.value.properties) ||
        !Array.isArray(schema.value.required) || !["schema_version","kind"].every(key => schema.value.required.includes(key))) throw new Error("observation schema");
    const manifest = coverage.value;
    if (!object(manifest) || manifest.coverage_version !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > 100) throw new Error("coverage");
    const seen = new Set();
    for (const entry of manifest.entries) {
      if (!object(entry) || Object.keys(entry).sort().join(",") !== "authority,availability,id,limitations,source" ||
          !["supported","delegated","unsupported"].includes(entry.availability) ||
          ![entry.id,entry.authority,entry.source,entry.limitations].every(x => typeof x === "string" && x.length <= 2000) ||
          !entry.id || seen.has(entry.id)) throw new Error("coverage entry");
      seen.add(entry.id);
    }
    if (!object(qa.value) || qa.value.type !== "object" || !Array.isArray(qa.value.required) ||
        !["status","round","cycle","rounds_audit"].every(key => qa.value.required.includes(key)) || !object(qa.value.properties)) throw new Error("QA schema");
    const compilerFile = path.join(__dirname,"lib","review","finding-schema.cjs");
    io.safeAncestors(compilerFile);
    if (!fs.lstatSync(compilerFile).isFile()) throw new Error("compiler");
    const {compile} = require(compilerFile);
    const {$id, ...assertions} = schema.value;
    compile(assertions);
    const qaValidator = compile(qa.value);
    return {schema_digest:hash(schema.bytes), coverage_digest:hash(coverage.bytes), coverage:manifest.entries, qaValidator};
  } catch { fail("runtime-resource", "Required local schema, coverage, QA schema or runtime companion is missing or malformed"); }
}
function cursorShape(cursor, kind, root) {
  if (cursor === undefined) return null;
  if (typeof cursor !== "string" || !cursor.length || cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) fail("invalid-cursor", "Malformed cursor");
  let value;
  try {
    const bytes = Buffer.from(cursor,"base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error();
    value = JSON.parse(bytes.toString("utf8"));
  } catch { fail("invalid-cursor", "Malformed cursor"); }
  if (!object(value) || Object.keys(value).sort().join(",") !== "fingerprint,kind,offset,root,version" ||
      value.version !== 1 || value.kind !== kind || value.root !== root ||
      !Number.isSafeInteger(value.offset) || value.offset < 0 || typeof value.fingerprint !== "string" || !SHA.test(value.fingerprint)) fail("invalid-cursor", "Invalid or misbound cursor");
  return value;
}
function offsetFor(cursor, total, fingerprint) {
  if (!cursor) return 0;
  if (cursor.fingerprint !== fingerprint) fail("stale-cursor", "Source changed; restart pagination");
  if (cursor.offset > (total ?? 0)) fail("invalid-cursor", "Cursor offset exceeds source total");
  return cursor.offset;
}
function continuation(kind,root,offset,total,fingerprint) {
  if (offset >= total) return null;
  const cursor = Buffer.from(JSON.stringify({version:1,kind,root,offset,fingerprint})).toString("base64url");
  if (cursor.length > 2000) fail("output-limit", "Continuation exceeds output string limit");
  return cursor;
}
function component(source) { return {source,availability:"absent",reason:null,digest:null,value:null,truncated:false}; }
function readSource(root, source) {
  const result = component(source);
  let bytes;
  try { bytes = io.readBytes(path.join(root,source)); }
  catch (error) {
    if (error.code !== "ENOENT") { result.availability = "invalid"; result.reason = error.reason || "read"; }
    return {component:result,text:null};
  }
  result.availability = "valid"; result.digest = hash(bytes);
  return {component:result,text:bytes.toString("utf8")};
}
function invalid(result, reason) { result.availability = "invalid"; result.reason = reason; result.value = null; return result; }
function parsedSource(root,source,validate) {
  const read = readSource(root,source);
  if (read.component.availability !== "valid") return {...read,value:null};
  let value;
  try { value = JSON.parse(read.text); } catch { invalid(read.component,"parse"); return {...read,value:null}; }
  if (!validate(value)) { invalid(read.component,"domain"); value = null; }
  return {component:read.component,value};
}
function ledger(root, task) {
  const read = parsedSource(root,`briefs/${task}-state.json`,value => validateLedger(value,task));
  if (read.value) read.component.value = {mode:read.value.mode,current_phase:read.value.current_phase,
    latest_completed:latest(read.value),history_total:read.value.events.length};
  return read;
}
function latest(value) { const event = value.events.at(-1); return {phase:event.phase,outcome:typeof event.outcome === "string" ? event.outcome : null}; }
function scalar(value, state) {
  if (typeof value === "string") { if (value.length > 2000) state.truncated = true; return value.slice(0,2000); }
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  return null;
}
const NUMERIC_FIELDS = new Set(["line","round","cycle","critical","high","medium","low","auto_fixed","qa_no_go_round"]);
function fields(value,names,state) {
  return Object.fromEntries(names.map(name => {
    const item = value?.[name];
    const usable = name === "qualifying" ? typeof item === "boolean" : NUMERIC_FIELDS.has(name) ? Number.isSafeInteger(item) : typeof item === "string";
    return [name,usable ? scalar(item,state) : null];
  }));
}
function joined(value,state) {
  if (!Array.isArray(value)) return null;
  // Build only a bounded prefix; count/length checks still expose omitted strings.
  let text = "";
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (text) text += "; ";
    text += item.slice(0,2001);
    if (text.length > 2000 || item.length > 2000) { state.truncated = true; return text.slice(0,2000); }
  }
  return text;
}
function arraySummary(value, project, state) {
  if (!Array.isArray(value)) return {items:[],total:null,truncated:false};
  const nested = {truncated:false};
  const items = value.slice(0,100).map(item => project(item,nested));
  const truncated = value.length > items.length || nested.truncated;
  if (truncated) state.truncated = true;
  return {items,total:value.length,truncated};
}
function reviewValid(value,task) {
  if (!object(value) || !["GO","NO-GO"].includes(value.status) || (Object.hasOwn(value,"task") && value.task !== task)) return false;
  for (const key of ["findings","rounds_audit"]) if (Object.hasOwn(value,key) && (!Array.isArray(value[key]) || !value[key].every(object))) return false;
  for (const key of ["round","cycle"]) if (Object.hasOwn(value,key) && (!Number.isSafeInteger(value[key]) || value[key] < 0)) return false;
  for (const key of ["summary","no_go_reason","cross_runtime"]) if (Object.hasOwn(value,key) && !object(value[key])) return false;
  return true;
}
function reportProjection(value,state,qa=false) {
  const result = fields(value,["status","round","cycle","date"],state);
  result.findings = arraySummary(value.findings,(item,s) => fields(item,["severity","path","line","summary","status","specialist"],s),state);
  result.rounds_audit = arraySummary(value.rounds_audit,(item,s) => ({...fields(item,["round","date","verdict","qualifying"],s),causes:joined(item.causes,s)}),state);
  result.summary = object(value.summary) ? fields(value.summary,["critical","high","medium","low","auto_fixed"],state) : null;
  result.no_go_reason = object(value.no_go_reason) ? {...fields(value.no_go_reason,["type","cause"],state),failed_acs:joined(value.no_go_reason.failed_acs,state)} : null;
  const cross = object(value.cross_runtime) ? Object.entries(value.cross_runtime) : undefined;
  result.cross_runtime = arraySummary(cross,([runtime,item],s) => ({runtime:scalar(runtime,s),...fields(item,["status","reason","round","config_digest"],s)}),state);
  if (qa) result.qa_no_go_round = Number.isSafeInteger(value.qa_no_go_round) ? value.qa_no_go_round : null;
  return result;
}
function report(root,task,suffix,resource) {
  const qa = suffix === "qa-state.json";
  const read = parsedSource(root,`briefs/${task}-${suffix}`,value => qa ?
    resource.qaValidator.validate(value).valid && (!Object.hasOwn(value,"task") || value.task === task) : reviewValid(value,task));
  if (read.value) read.component.value = reportProjection(read.value,read.component,qa);
  return read.component;
}
function markdown(root,task,suffix) {
  const read = readSource(root,`briefs/${task}-${suffix}`), c = read.component;
  if (read.text !== null) {
    const match = read.text.match(/^\*\*Status: (VALIDATED|GO|NO-GO)\*\*(?:[ \t].*)?\r?$/m) ||
      read.text.match(/^\*\*Status:\*\* (GO|NO-GO)(?:[ \t].*)?\r?$/m);
    c.value = {text:read.text.slice(0,2000),status:match?.[1] || null}; c.truncated = read.text.length > 2000;
  }
  return c;
}
function manifest(root,task) {
  const read = readSource(root,`briefs/${task}-manifest.txt`), c = read.component;
  if (read.text !== null) {
    const lines = read.text.split(/\r?\n/), separator = lines.indexOf("---");
    const entries = separator < 0 ? [] : lines.slice(separator + 1).filter(line => line.trim().length);
    c.value = arraySummary(entries,(entry,s) => scalar(entry,s),c);
  }
  return c;
}
function history(value,offset,limit,root,digest) {
  if (!value) return {items:[],total:null,next_cursor:null,truncated:false};
  const total = value.events.length;
  const items = value.events.slice(offset,offset+limit).map((event,index) => {
    const state = {truncated:false}, reason = scalar(event.reason,state);
    const actorUsable = typeof event.by === "string" && event.by.length > 0;
    const timeUsable = typeof event.at === "string" && event.at.length <= 2000 && Number.isFinite(Date.parse(event.at));
    return {id:`event:${offset+index}`,source_index:offset+index,phase:event.phase,outcome:typeof event.outcome === "string" ? event.outcome : null,
      reason,reason_truncated:state.truncated,
      actor:{availability:actorUsable ? "valid" : "unknown",value:actorUsable ? event.by.slice(0,2000) : null,truncated:actorUsable && event.by.length > 2000},
      time:{availability:timeUsable ? "valid" : "unknown",value:timeUsable ? event.at : null}};
  });
  return {items,total,next_cursor:continuation("history",root,offset+items.length,total,digest),truncated:items.length < total};
}
function tuples(components) { return components.map(({source,availability,reason,digest}) => ({source,availability,reason,digest})); }
function envelope(kind,root,resource,sources,request,data) {
  request = {...request,schema_digest:resource.schema_digest,coverage_digest:resource.coverage_digest};
  const value = {schema_version:1,kind,generated_at:new Date().toISOString(),schema:{id:SCHEMA_ID,digest:resource.schema_digest},root,
    version:hash(JSON.stringify({sources,request})),coverage:resource.coverage,data};
  serialize(value); return value;
}
function scan(root) {
  const result = {availability:"valid",reason:null,names:[],unsafe_names_count:0};
  let directory;
  try {
    const target = path.join(root,"briefs");
    try { io.safeAncestors(target); } catch { result.availability="invalid"; result.reason="unsafe"; return result; }
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory()) { result.availability="invalid"; result.reason="unsafe"; return result; }
    directory = fs.opendirSync(target);
    const names = new Set(); let count = 0;
    for (;;) {
      const entry = directory.readSync(); if (!entry) break;
      if (++count > 10000) { result.availability="unknown"; result.reason="scan-limit"; return result; }
      const match = entry.name.match(/^(.*)-(?:state\.json|intake\.md)$/);
      if (!match) continue;
      if (match[1].length <= 120 && TASK.test(match[1])) names.add(match[1]); else result.unsafe_names_count++;
    }
    result.names = [...names].sort(); return result;
  } catch (error) { result.availability=error.code === "ENOENT" ? "absent" : "invalid"; result.reason=error.code === "ENOENT" ? null : "read"; return result; }
  finally { if (directory) directory.closeSync(); }
}
function list(root, options={}) {
  optionsFor(options,["schema_version","limit","cursor"]);
  const limit = pageLimit(options.limit,25,100), absolute = rootPath(root), cursor = cursorShape(options.cursor,"catalog",absolute);
  const resource = resources(), catalog = scan(absolute);
  const complete = catalog.availability === "valid", total = complete ? catalog.names.length : null;
  const fingerprint = complete ? hash(JSON.stringify(catalog.names)) : null;
  const offset = offsetFor(cursor,total,fingerprint);
  const observed = [];
  const items = catalog.names.slice(offset,offset+limit).map(task => {
    const read = ledger(absolute,task); observed.push(read.component);
    return {task,ledger:read.component,mode:read.value?.mode ?? null,latest_completed:read.value ? latest(read.value) : null,history_total:read.value?.events.length ?? null};
  });
  const data = {availability:catalog.availability,reason:catalog.reason,items,total,
    next_cursor:complete ? continuation("catalog",absolute,offset+items.length,total,fingerprint) : null,
    catalog_fingerprint:fingerprint,unsafe_names_count:catalog.unsafe_names_count};
  return envelope("pipeline-list",absolute,resource,[{source:"briefs",availability:catalog.availability,reason:catalog.reason,digest:null},...tuples(observed)],
    {kind:"pipeline-list",limit,offset,catalog_fingerprint:fingerprint},data);
}
function show(root,task,options={}) {
  optionsFor(options,["schema_version","history_limit","history_cursor"]); taskName(task);
  const limit = pageLimit(options.history_limit,50,200), absolute = rootPath(root), cursor = cursorShape(options.history_cursor,"history",absolute);
  const resource = resources(), read = ledger(absolute,task);
  const offset = offsetFor(cursor,read.value?.events.length ?? null,read.component.digest);
  const components = {ledger:read.component,
    intake:markdown(absolute,task,"intake.md"),spec:markdown(absolute,task,"spec.md"),plan:markdown(absolute,task,"plan.md"),
    implementation:markdown(absolute,task,"impl.md"),review:report(absolute,task,"review.json",resource),
    qa_state:report(absolute,task,"qa-state.json",resource),qa:markdown(absolute,task,"qa.md"),manifest:manifest(absolute,task)};
  const values = Object.values(components), availability = values.some(c => c.availability === "valid") ? "valid" : values.some(c => c.availability === "invalid") ? "invalid" : "absent";
  const verdicts = [components.review.value?.status,components.qa_state.value?.status,components.qa.value?.status].filter(s => s === "GO" || s === "NO-GO");
  const data = {task,availability,components,history:history(read.value,offset,limit,absolute,read.component.digest),
    mode:read.value?.mode ?? null,latest_completed:read.value ? latest(read.value) : null,
    verdict_disagreement:verdicts.length > 1 ? new Set(verdicts).size > 1 : null};
  return envelope("pipeline-task",absolute,resource,tuples(values),{kind:"pipeline-task",task,history_limit:limit,offset},data);
}
function capabilities(options={}) {
  optionsFor(options,["schema_version"]); const resource = resources();
  return envelope("pipeline-capabilities",null,resource,[],{kind:"pipeline-capabilities"},{coverage_version:1,limits:LIMITS});
}
function main(argv) {
  try {
    const [command,...args] = argv;
    if (!["list","show","capabilities"].includes(command)) fail("invalid-request", "Expected list, show or capabilities");
    const allowed = command === "list" ? ["root","limit","cursor","schema-version"] : command === "show" ? ["root","task","history-limit","history-cursor","schema-version"] : ["schema-version"];
    const parsed = {};
    for (let index=0; index<args.length; index+=2) {
      const flag = args[index];
      if (!flag?.startsWith("--") || !allowed.includes(flag.slice(2)) || index+1 >= args.length || Object.hasOwn(parsed,flag.slice(2))) fail("invalid-request","Unknown, duplicate or incomplete option");
      parsed[flag.slice(2)] = args[index+1];
    }
    const options = {};
    for (const [key,value] of Object.entries(parsed)) {
      if (key === "root" || key === "task") continue;
      if (["limit","history-limit","schema-version"].includes(key)) {
        if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) fail("invalid-request","Malformed integer option");
        options[key.replaceAll("-","_")] = Number(value);
      } else options[key.replaceAll("-","_")] = value;
    }
    const result = command === "list" ? list(parsed.root ?? process.cwd(),options) : command === "show" ? show(parsed.root ?? process.cwd(),parsed.task,options) : capabilities(options);
    process.stdout.write(serialize(result));
  } catch (error) {
    const known = error instanceof ObservationError ? error : new ObservationError("runtime-resource","Observation runtime failure");
    process.stderr.write(JSON.stringify({schema_version:1,kind:"error",error:{code:known.code,message:known.message}})+"\n"); process.exitCode=2;
  }
}
module.exports = {list,show,capabilities,validateLedger,serialize,ObservationError};
if (require.main === module) main(process.argv.slice(2));
