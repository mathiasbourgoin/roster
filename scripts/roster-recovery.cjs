#!/usr/bin/env node
"use strict";
// Manual, local artifact analysis only. No hooks, worker execution or source writes.
const fs = require("node:fs");
const path = require("node:path");
const core = require("./roster-roadmap.cjs");
const { missionById } = require("./roster-roadmap-missions.cjs");
const { readJSON, atomicWrite, safeAncestors } = core.io;
const THRESHOLD = 3;
const PHASES = { question: ["COMPLETED"], research: ["COMPLETED"], intake: ["VALIDATED"], spec: ["VALIDATED", "SKIPPED", "BOUNCED"], plan: ["COMPLETED"], implement: ["COMPLETED", "PARTIAL"], review: ["GO", "NO-GO"], qa: ["GO", "NO-GO"], ship: ["COMPLETED", "BLOCKED"] };
function fail(message) { throw new Error(message); }
function text(value, label) { if (typeof value !== "string" || !value.trim()) fail(`${label} must be a nonempty string`); }
function keys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}: unknown field ${key}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`${label}: missing field ${key}`);
}
function same(a, b) { return core.hash(a) === core.hash(b); }
function integer(value, label) { if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a nonnegative integer`); }
function strings(value, label) {
  if (!Array.isArray(value) || !value.length) fail(`${label} must be a nonempty array`);
  value.forEach(item => text(item, label));
  if (new Set(value).size !== value.length) fail(`${label} contains duplicates`);
}
function recoveryFile(source) {
  return source.kind === "board" ? path.join(source.identity.source, `recovery-${source.identity.task_id}.json`) : `${source.identity.source}.recovery-${source.identity.phase}.json`;
}
function readArtifact(file) {
  safeAncestors(file);
  try { fs.lstatSync(file); } catch (err) { if (err.code === "ENOENT") return null; throw err; }
  return readJSON(file);
}
function boardSource(ctx, taskId) {
  if (!ctx.state.acceptance || ctx.state.acceptance.contract_digest !== core.hash(ctx.contract)) fail("recovery requires an accepted, unchanged roadmap");
  const task = missionById(ctx, taskId);
  if (!task) fail(`unknown task ${taskId}`);
  const identity = { kind: "board", source: path.resolve(ctx.board), board_id: ctx.state.board_id, contract_digest: ctx.state.acceptance.contract_digest, task_id: taskId };
  let receiptIndex = 0;
  const entries = ctx.state.events.map(event => event.action === "record" ? { event, receipt: ctx.state.receipts[receiptIndex++] } : { event });
  if (receiptIndex !== ctx.state.receipts.length) fail("receipt/event history mismatch");
  const observations = [], seen = new Set();
  entries.forEach((entry, source_index) => {
    const r = entry.receipt;
    if (!r) return;
    if (seen.has(r.attempt_id)) fail("duplicate attempt id"); seen.add(r.attempt_id);
    if (r.task_id === taskId) observations.push({ id: r.attempt_id, outcome: r.result === "done" ? "GO" : "NO-GO", source_index, evidence: r });
  });
  const current = ctx.state.tasks[taskId], exhausted = current.attempts >= task.policy.max_attempts;
  const blockers = [];
  if (exhausted) blockers.push("attempt budget exhausted; revised roadmap decision required");
  if (task.policy.on_failure !== "retry" && observations.some(o => o.outcome === "NO-GO")) blockers.push("policy does not authorize retry");
  if (["active", "blocked"].includes(current.status)) blockers.push("reconcile owned/interrupted work through the roadmap core before retry");
  if (current.status === "done") blockers.push("task already done");
  if (current.status === "queued") { const reason = core.canClaimBasic(ctx, task); if (reason) blockers.push(reason); }
  return { kind: "board", identity, entries, observations, exhausted, attempts: current.attempts, max_attempts: task.policy.max_attempts, reconciliation_required: ["active", "blocked"].includes(current.status), blockers };
}
function ledgerSource(file, phase) {
  if (!["review", "qa"].includes(phase)) fail("--phase must be review or qa");
  const source = path.resolve(file), ledger = readJSON(source);
  keys(ledger, ["task", "mode", "current_phase", "events"], "pipeline ledger");
  if (typeof ledger.task !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ledger.task)) fail("pipeline ledger task must be the canonical slug");
  if (!["express-lite", "express", "fast", "full"].includes(ledger.mode)) fail("invalid pipeline mode");
  if (!Object.hasOwn(PHASES, ledger.current_phase)) fail("invalid current_phase");
  if (!Array.isArray(ledger.events)) fail("ledger events must be an array");
  ledger.events.forEach(event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) fail("ledger event must be an object");
    for (const key of Object.keys(event)) if (!["phase", "outcome", "by", "at", "reason"].includes(key)) fail(`unknown ledger event field ${key}`);
    if (!Object.hasOwn(PHASES, event.phase) || !PHASES[event.phase].includes(event.outcome)) fail("invalid ledger phase/outcome");
    text(event.by, "event.by");
    if (event.reason !== undefined) text(event.reason, "event.reason");
    if (event.at !== undefined && (typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)))) fail("event.at must be an ISO date string");
  });
  if (ledger.events.length && ledger.current_phase !== ledger.events.at(-1).phase) fail("current_phase differs from latest event");
  const identity = { kind: "pipeline", source, task_id: ledger.task, phase, mode: ledger.mode };
  const observations = ledger.events.flatMap((event, source_index) => event.phase === phase ? [{ id: `event:${source_index}`, outcome: event.outcome, source_index, evidence: event }] : []);
  return { kind: "pipeline", identity, entries: ledger.events, observations, exhausted: null, attempts: null, max_attempts: null, reconciliation_required: null, blockers: ["external review/QA caps, convergence, acceptance and worker reconciliation remain authoritative"] };
}
function prefixDigest(source, count) { return core.hash({ identity: source.identity, entries: source.entries.slice(0, count) }); }
function streak(source, after = 0, until = source.entries.length) {
  let failures = [];
  for (const item of source.observations) {
    if (item.source_index < after || item.source_index >= until) continue;
    if (item.outcome === "GO") failures = []; else failures.push(item.id);
  }
  return failures;
}
const DECISION_FIELDS = ["identity", "source_count", "source_digest", "failure_ids", "actor", "basis", "diagnosis", "changed_strategy", "next_discriminating_check", "evidence"];
function validateDecision(decision) {
  keys(decision, DECISION_FIELDS, "reframe decision");
  for (const field of ["actor", "basis", "diagnosis", "changed_strategy", "next_discriminating_check"]) text(decision[field], `decision.${field}`);
  strings(decision.evidence, "decision.evidence"); strings(decision.failure_ids, "decision.failure_ids");
  integer(decision.source_count, "decision.source_count");
  if (typeof decision.source_digest !== "string" || !/^[a-f0-9]{64}$/.test(decision.source_digest)) fail("decision.source_digest must be SHA-256");
}
function validateReframes(source, artifact) {
  if (artifact === null || artifact === undefined) return [];
  keys(artifact, ["schema_version", "identity", "records"], "recovery artifact");
  if (artifact.schema_version !== 1 || !same(artifact.identity, source.identity)) fail("recovery artifact identity/schema mismatch");
  if (!Array.isArray(artifact.records)) fail("recovery records must be an array");
  let last = 0, previous = null;
  for (const record of artifact.records) {
    keys(record, ["decision", "previous_digest", "record_digest", "at"], "reframe record");
    const d = record.decision; validateDecision(d);
    if (!same(d.identity, source.identity)) fail("reframe identity mismatch");
    if (d.source_count <= last || d.source_count > source.entries.length) fail("stale or deleted source prefix in reframe history");
    if (d.source_digest !== prefixDigest(source, d.source_count)) fail("reframe source prefix changed");
    const failures = streak(source, last, d.source_count);
    if (failures.length < THRESHOLD || !same(d.failure_ids, failures)) fail("forged reframe reset: failure observations do not meet threshold");
    text(record.at, "reframe.at");
    if (!Number.isFinite(Date.parse(record.at))) fail("invalid reframe timestamp");
    if (record.previous_digest !== previous || record.record_digest !== core.hash({ decision: d, previous_digest: previous, at: record.at })) fail("reframe append-only chain mismatch");
    last = d.source_count; previous = record.record_digest;
  }
  return artifact.records;
}
function analyze(source, artifact) {
  const reframes = validateReframes(source, artifact), anchor = reframes.at(-1)?.decision.source_count || 0;
  const failure_ids = streak(source, anchor), reframe_needed = failure_ids.length >= THRESHOLD;
  const retry_blockers = [...source.blockers];
  if (reframe_needed) retry_blockers.push("three consecutive unsuccessful missions require diagnosed changed strategy");
  return {
    status: reframe_needed ? "needs-reframe" : "within-budget", threshold: THRESHOLD,
    identity: source.identity, source_count: source.entries.length, source_digest: prefixDigest(source, source.entries.length),
    recovery_file: recoveryFile(source), failure_ids, observations: source.observations,
    consecutive_failures: failure_ids.length, historical_consecutive_failures: streak(source).length,
    total_failures: source.observations.filter(o => o.outcome === "NO-GO").length,
    reframe_needed, recovery_allows_retry: !reframe_needed,
    retry_allowed: source.kind === "pipeline" ? null : retry_blockers.length === 0,
    retry_blockers, exhausted: source.exhausted, attempts: source.attempts, max_attempts: source.max_attempts,
    reconciliation_required: source.reconciliation_required, reframes,
    assurance: "Local recorded assertions; no authentication, source mutation, budget reset, acceptance bypass or worker control. within-budget describes only this recovery threshold; it is not GO."
  };
}
// ctx must come from core.readBoard(); pure analysis does not reload or mutate it.
function analyzeBoard(ctx, taskId, artifact = null) { return analyze(boardSource(ctx, taskId), artifact); }
function inspectBoard(ctx, taskId) {
  const source = boardSource(ctx, taskId);
  return analyze(source, readArtifact(recoveryFile(source)));
}
function loadSource(options) {
  if (options.board) {
    if (options.ledger || options.phase || !options.task) fail("--board requires --task and cannot be combined with --ledger/--phase");
    return boardSource(core.readBoard(options.board), options.task);
  }
  if (!options.ledger || !options.phase || options.task) fail("supply --board BOARD --task TASK or --ledger FILE --phase review|qa");
  return ledgerSource(options.ledger, options.phase);
}
function reframe(options) {
  const initial = loadSource(options), file = recoveryFile(initial), lock = `${file}.lock`;
  safeAncestors(file); safeAncestors(lock);
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch (err) { fail(`recovery lock unavailable (${err.code}); inspect its owner before explicit recovery`); }
  try {
    const source = loadSource(options), artifact = readArtifact(file), current = analyze(source, artifact);
    if (!current.reframe_needed) fail("reframe requires three consecutive unsuccessful missions since the last valid reframe or success");
    const decision = readJSON(options.decision); validateDecision(decision);
    if (!same(decision.identity, current.identity)) fail("decision identity mismatch");
    if (decision.source_count !== current.source_count || decision.source_digest !== current.source_digest || !same(decision.failure_ids, current.failure_ids)) fail("stale decision or mismatched failure observations");
    const records = artifact?.records || [], at = new Date().toISOString(), previous_digest = records.at(-1)?.record_digest || null;
    const record = { decision, previous_digest, at, record_digest: core.hash({ decision, previous_digest, at }) };
    const next = { schema_version: 1, identity: source.identity, records: [...records, record] };
    // Detect a concurrent source append/change before replacing our own artifact.
    const latest = loadSource(options);
    if (!same(latest.identity, source.identity) || prefixDigest(latest, latest.entries.length) !== current.source_digest || latest.entries.length !== current.source_count) fail("source changed during reframe; inspect fresh status");
    validateReframes(latest, next); atomicWrite(file, next);
    return analyze(latest, next);
  } finally { fs.rmdirSync(lock); }
}
function main(argv) {
  if (argv.length === 1 && ["help", "--help"].includes(argv[0])) return { usage: "roster-recovery.cjs <status|check|reframe> --board BOARD --task TASK | --ledger FILE --phase review|qa [--decision FILE]", threshold: THRESHOLD, activation: "Manual only; status/check are read-only. Reframe writes only the separate recovery artifact." };
  const [command, ...args] = argv;
  if (!["status", "check", "reframe"].includes(command)) fail("expected status, check or reframe");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].startsWith("--") ? args[i].slice(2) : "";
    if (!["board", "task", "ledger", "phase", ...(command === "reframe" ? ["decision"] : [])].includes(key) || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith("--")) fail("unknown/duplicate option or missing --name value");
    options[key] = args[i + 1];
  }
  if (command === "reframe") { text(options.decision, "--decision"); return reframe(options); }
  const source = loadSource(options);
  return analyze(source, readArtifact(recoveryFile(source)));
}
module.exports = { main, analyzeBoard, inspectBoard, THRESHOLD };
if (require.main === module) {
  try {
    const result = main(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (process.argv[2] === "check" && result.reframe_needed) process.exitCode = 2;
  }
  catch (err) { process.stdout.write(JSON.stringify({ status: "error", error: err.message }) + "\n"); process.exitCode = 1; }
}
