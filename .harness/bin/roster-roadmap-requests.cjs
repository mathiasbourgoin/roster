"use strict";

// Advisory annex: what the coordinator waits for from the human operator.
// Never consulted by claim/next/release; labels are unauthenticated assertions and
// secrets must never be stored (see schema/roadmap-requests-schema.md, rule D5).
const fs = require("node:fs");
const path = require("node:path");
const core = () => require("./roster-roadmap.cjs");
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
// One character rule shared by write-time refusal and render-time cleaning (FR-003, FR-018):
// C0, DEL and C1 controls, every Unicode format character (Cf) and the line/paragraph separators.
const CONTROL = "\\x00-\\x1f\\x7f-\\x9f", FORMAT = "\\p{Cf}\\u2028\\u2029";
const STRICT = new RegExp(`[${CONTROL}${FORMAT}]`, "u");
const MULTILINE = new RegExp(`[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f${FORMAT}]`, "u");
const CONTROL_ALL = new RegExp(`[${CONTROL}]`, "gu"), FORMAT_ALL = new RegExp(`[${FORMAT}]`, "gu");
const cleanText = value => String(value ?? "").replace(CONTROL_ALL, " ").replace(FORMAT_ALL, "");
const MULTILINE_KEYS = ["text", "reason"];
const KINDS = ["decision", "supply", "action", "information"];
const NEEDS = ["blocking", "before-task", "later"];
const STATUSES = ["open", "answered", "withdrawn"];
const ACTIONS = ["open", "answer", "withdraw", "journal"];
const REQUEST_KEYS = ["id", "to", "kind", "text", "task_id", "need", "refs", "created_at", "created_by", "status", "supersedes", "answer", "withdrawal"];
const MAX_REQUESTS = 500, MAX_OPEN = 100, OPEN_BUDGET = 512 * 1024;
// Size of one item in the view block; open requests are measured with their derived view
// fields at their longest values, so a write accepted here never truncates the view's open items.
const itemBytes = item => Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
const OPEN_DECORATION = { due: "unscheduled", task_state: "unknown", closed_at: null, superseded_by: null };
const isOpen = request => request.status === "open";
const openBytes = list => list.filter(isOpen).reduce((sum, request) => sum + itemBytes({ ...request, ...OPEN_DECORATION }), 0);
const fail = message => { throw new Error(`requests: ${message}`); };

function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`); }
function exact(value, names, label) {
  object(value, label);
  const keys = Object.keys(value);
  if (keys.length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail(`${label} must have exactly the fields ${names.join(", ")}`);
}
function allowed(value, required, optional, label) {
  object(value, label);
  if (Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail(`${label} contains unknown fields`);
  for (const name of required) if (!Object.hasOwn(value, name)) fail(`${label} requires ${name}`);
}
function str(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must be nonempty text of at most ${max} characters`);
}
function ident(value, label) { if (typeof value !== "string" || !ID.test(value)) fail(`${label} must be a safe identifier`); }
function oneOf(value, values, label) { if (!values.includes(value)) fail(`${label} must be one of ${values.join(", ")}`); }
function instant(value, label) {
  if (typeof value !== "string" || !INSTANT.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`${label} must be a UTC ISO timestamp`);
}
function assertChars(value, key = "") {
  if (typeof value === "string") {
    if ((MULTILINE_KEYS.includes(key) ? MULTILINE : STRICT).test(value)) fail(`${key || "value"} contains control, bidirectional or invisible characters`);
  } else if (Array.isArray(value)) value.forEach(item => assertChars(item, key));
  else if (value && typeof value === "object") for (const [name, item] of Object.entries(value)) { assertChars(name); assertChars(item, name); }
}

function validateAnswer(request, i) {
  const label = `request ${i} answer`;
  if (request.status === "answered") {
    exact(request.answer, ["text", "by", "at", "relayed_by"], label);
    str(request.answer.text, `${label}.text`, 2000); str(request.answer.by, `${label}.by`, 200);
    instant(request.answer.at, `${label}.at`); ident(request.answer.relayed_by, `${label}.relayed_by`);
  } else if (request.answer !== null) fail(`${label} requires status answered`);
  if (request.status === "withdrawn") {
    exact(request.withdrawal, ["reason", "by", "at"], `request ${i} withdrawal`);
    str(request.withdrawal.reason, `request ${i} withdrawal.reason`, 2000); ident(request.withdrawal.by, `request ${i} withdrawal.by`);
    instant(request.withdrawal.at, `request ${i} withdrawal.at`);
  } else if (request.withdrawal !== null) fail(`request ${i} withdrawal requires status withdrawn`);
}
function validateRequest(request, i) {
  const label = `request ${i}`;
  exact(request, REQUEST_KEYS, label);
  ident(request.id, `${label}.id`);
  exact(request.to, ["kind", "label"], `${label}.to`); oneOf(request.to.kind, ["role", "person"], `${label}.to.kind`); str(request.to.label, `${label}.to.label`, 200);
  oneOf(request.kind, KINDS, `${label}.kind`); str(request.text, `${label}.text`, 2000);
  if (request.task_id !== null) ident(request.task_id, `${label}.task_id`);
  oneOf(request.need, NEEDS, `${label}.need`);
  if (request.need === "before-task" && request.task_id === null) fail(`${label}: need before-task requires a task`);
  if (!Array.isArray(request.refs) || request.refs.length > 10) fail(`${label}.refs must be an array of at most 10 references`);
  request.refs.forEach(ref => str(ref, `${label}.refs`, 500));
  instant(request.created_at, `${label}.created_at`); ident(request.created_by, `${label}.created_by`);
  oneOf(request.status, STATUSES, `${label}.status`);
  if (request.supersedes !== null) ident(request.supersedes, `${label}.supersedes`);
  validateAnswer(request, i);
}
function validateLinks(requests) {
  const byId = new Map(), superseded = new Set();
  for (const request of requests) { if (byId.has(request.id)) fail(`duplicate request id ${request.id}`); byId.set(request.id, request); }
  for (const request of requests) {
    if (request.supersedes === null) continue;
    const target = byId.get(request.supersedes);
    if (!target || target === request) fail(`request ${request.id} supersedes an unknown request`);
    if (target.status === "open") fail(`request ${request.id} supersedes a request that is still open`);
    if (superseded.has(target.id)) fail(`request ${target.id} is superseded twice`);
    superseded.add(target.id);
  }
}
function validateAnnex(annex, ctx) {
  exact(annex, ["schema_version", "board_id", "revision", "journal", "requests", "history"], "annex");
  if (annex.schema_version !== 1) fail("unsupported annex schema_version");
  if (annex.board_id !== ctx.contract.id) fail("annex belongs to a different board");
  if (!Array.isArray(annex.requests) || !Array.isArray(annex.history)) fail("requests and history must be arrays");
  if (!Number.isSafeInteger(annex.revision) || annex.revision !== annex.history.length) fail("revision must equal the history length");
  if (annex.journal !== null) str(annex.journal, "journal", 1000);
  if (annex.requests.length > MAX_REQUESTS) fail(`at most ${MAX_REQUESTS} requests per board`);
  annex.requests.forEach(validateRequest); validateLinks(annex.requests);
  if (annex.requests.filter(isOpen).length > MAX_OPEN) fail(`at most ${MAX_OPEN} open requests`);
  annex.history.forEach((entry, i) => {
    exact(entry, ["revision", "action", "request_id", "coordinator", "at"], `history ${i}`);
    if (entry.revision !== i + 1) fail("history revisions must be contiguous");
    oneOf(entry.action, ACTIONS, `history ${i}.action`);
    if (entry.request_id !== null) ident(entry.request_id, `history ${i}.request_id`);
    ident(entry.coordinator, `history ${i}.coordinator`); instant(entry.at, `history ${i}.at`);
  });
}
// Annex and file-system refusals are plain Errors (or carry a system code); anything else
// (TypeError, RangeError...) is a programming error and must not pass for an invalid annex.
const dataError = error => error instanceof Error && (error.constructor === Error || typeof error.code === "string");
function annexFile(ctx) { return path.join(ctx.board, "requests.json"); }
function readAnnex(ctx) {
  const file = annexFile(ctx);
  try {
    core().io.safeAncestors(file);
    try { fs.lstatSync(file); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { status: "absent", reason: null, annex: { schema_version: 1, board_id: ctx.contract.id, revision: 0, journal: null, requests: [], history: [] } };
    }
    const annex = core().io.readJSON(file);
    validateAnnex(annex, ctx);
    return { status: "valid", reason: null, annex };
  } catch (error) {
    if (!dataError(error)) throw error;
    return { status: "invalid", reason: error.message, annex: null };
  }
}

function opOpen(ctx, annex, input, meta) {
  if (ctx.state.global_receipt) fail("request-open is refused on a globally complete board");
  allowed(input, ["id", "to", "kind", "text", "need"], ["task_id", "refs", "supersedes"], "request file");
  const request = { id: input.id, to: input.to, kind: input.kind, text: input.text, task_id: input.task_id ?? null, need: input.need, refs: input.refs ?? [],
    created_at: meta.at, created_by: meta.coordinator, status: "open", supersedes: input.supersedes ?? null, answer: null, withdrawal: null };
  validateRequest(request, annex.requests.length);
  if (annex.requests.some(other => other.id === request.id)) fail(`request id ${request.id} is already used`);
  const tasks = Array.isArray(ctx.contract.tasks) ? ctx.contract.tasks : [];
  if (request.task_id !== null && !tasks.some(task => task.id === request.task_id)) fail(`unknown task ${request.task_id}`);
  if (annex.requests.length >= MAX_REQUESTS) fail(`at most ${MAX_REQUESTS} requests per board`);
  if (annex.requests.filter(isOpen).length >= MAX_OPEN) fail(`at most ${MAX_OPEN} open requests; answer or withdraw some first`);
  if (request.supersedes !== null) {
    const target = annex.requests.find(other => other.id === request.supersedes);
    if (!target) fail(`cannot supersede unknown request ${request.supersedes}`);
    if (target.status === "open") fail(`cannot supersede open request ${target.id}; answer or withdraw it first`);
    if (annex.requests.some(other => other.supersedes === target.id)) fail(`request ${target.id} is already superseded`);
  }
  annex.requests.push(request);
  return { action: "open", request_id: request.id };
}
function openRequest(annex, id) {
  ident(id, "--id");
  const request = annex.requests.find(other => other.id === id);
  if (!request) fail(`unknown request ${id}`);
  if (request.status !== "open") fail(`request ${id} is already ${request.status}; terminal states are final`);
  return request;
}
function opAnswer(ctx, annex, input, meta) {
  exact(input, ["text", "by"], "answer file");
  const request = openRequest(annex, meta.id);
  request.status = "answered";
  request.answer = { text: input.text, by: input.by, at: meta.at, relayed_by: meta.coordinator };
  return { action: "answer", request_id: request.id };
}
function opWithdraw(ctx, annex, input, meta) {
  exact(input, ["reason"], "withdrawal file");
  const request = openRequest(annex, meta.id);
  request.status = "withdrawn";
  request.withdrawal = { reason: input.reason, by: meta.coordinator, at: meta.at };
  return { action: "withdraw", request_id: request.id };
}
function opJournal(ctx, annex, input) {
  exact(input, ["path"], "journal file");
  annex.journal = input.path;
  return { action: "journal", request_id: null };
}
const SPEC = {
  "request-open": { file: "request", apply: opOpen },
  "request-answer": { file: "answer", apply: opAnswer, id: true },
  "request-withdraw": { file: "withdrawal", apply: opWithdraw, id: true },
  "request-journal": { file: "journal", apply: opJournal },
};
function parseOptions(spec, options) {
  ident(options.coordinator, "--coordinator");
  if (!/^\d+$/.test(options.revision || "") || !Number.isSafeInteger(Number(options.revision))) fail("--revision must be the current requests revision");
  if (typeof options[spec.file] !== "string" || !options[spec.file]) fail(`--${spec.file} FILE is required`);
  if (spec.id) ident(options.id, "--id"); else if (options.id !== undefined) fail("--id is not accepted by this command");
  return Number(options.revision);
}
function locked(root, run) {
  const lock = path.join(root, ".lock");
  core().io.safeAncestors(lock);
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (error) { fail(`board lock unavailable (${error.code}); inspect before explicit lock recovery`); }
  try { return run(); } finally { fs.rmdirSync(lock); }
}
function commit(root, name, options, revision) {
  const spec = SPEC[name], ctx = core().readBoard(root, true);
  if (ctx.state.acceptance && ctx.state.coordinator !== options.coordinator) fail("foreign coordinator; use the designated coordinator");
  const read = readAnnex(ctx);
  if (read.status === "invalid") fail(`annex invalid (${read.reason}); repair requests.json explicitly before writing`);
  const annex = read.annex;
  if (revision !== annex.revision) fail(`stale requests revision: expected ${revision}, current ${annex.revision}`);
  const input = core().io.readJSON(options[spec.file]);
  assertChars(input);
  const at = new Date().toISOString();
  const done = spec.apply(ctx, annex, input, { id: options.id, coordinator: options.coordinator, at });
  annex.history.push({ revision: annex.history.length + 1, action: done.action, request_id: done.request_id, coordinator: options.coordinator, at });
  annex.revision = annex.history.length;
  validateAnnex(annex, ctx);
  if (name === "request-open" && openBytes(annex.requests) > OPEN_BUDGET) fail(`open requests would exceed ${OPEN_BUDGET} bytes of UTF-8; shorten them, or answer or withdraw some first`);
  core().io.atomicWrite(annexFile(ctx), annex);
  return { requests_revision: annex.revision, action: done.action, request_id: done.request_id, written: true };
}
function command(board, name, options) {
  const revision = parseOptions(SPEC[name], options), root = path.resolve(board);
  core().io.safeAncestors(root);
  core().readBoard(root, true);
  return locked(root, () => commit(root, name, options, revision));
}

module.exports = { command, readAnnex, cleanText, itemBytes, OPEN_BUDGET };
