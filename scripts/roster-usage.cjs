#!/usr/bin/env node
"use strict";

// Manual, read-only aggregate importer. No collectors, subprocesses or pricing lookups.
const fs = require("node:fs");
const path = require("node:path");
const RUNTIMES = ["claude-code", "codex", "opencode", "pi", "cross-runtime", "unknown"];
const LEGACY_RUNTIMES = RUNTIMES.filter(value => value !== "pi");
const SOURCES = ["runtime-observed", "agent-reported"];
const METRICS = ["input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "cost_usd"];
const DEFAULTS = ["skills-meta/cost.jsonl", ".harness/.local/usage.jsonl"];
const MAX_FILE_BYTES = 32 * 1024 * 1024, MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const emptyTotals = () => Object.fromEntries(METRICS.map(metric => [metric, null]));
function invalid() { throw new Error("invalid-record"); }
function shape(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) invalid();
}
function nonempty(value) { if (typeof value !== "string" || !value.trim()) invalid(); }
function timestamp(value) {
  if (typeof value !== "string") invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid();
  const [, y, m, d, h, min, sec, , zone] = match;
  const calendar = new Date(0); calendar.setUTCFullYear(Number(y), Number(m), 0);
  const days = calendar.getUTCDate();
  if (+m < 1 || +m > 12 || +d < 1 || +d > days || +h > 23 || +min > 59 || +sec > 59) invalid();
  if (zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) invalid();
  const result = Date.parse(value); if (!Number.isFinite(result)) invalid(); return result;
}
function validateTotals(totals, nullable) {
  shape(totals, METRICS);
  for (const metric of METRICS) {
    const value = totals[metric];
    if (nullable && value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || metric !== "cost_usd" && !Number.isSafeInteger(value)) invalid();
  }
}
function category(value) { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value) ? value : "unknown"; }
function normalized(record, project) {
  shape(record, ["schema_version", "runtime", "source", "stream_id", "captured_at", "totals"], ["model"]);
  if (record.schema_version !== 1 || !SOURCES.includes(record.source)) invalid();
  nonempty(record.runtime); nonempty(record.stream_id); validateTotals(record.totals, true);
  const runtime = RUNTIMES.includes(record.runtime) ? record.runtime : "unknown";
  return { format: "cumulative", project, runtime, source: record.source, model: category(record.model),
    key: JSON.stringify([project, record.runtime, record.source, record.stream_id]), at: timestamp(record.captured_at), totals: record.totals,
    limitations: runtime === "unknown" ? ["runtime-attribution-unknown"] : [] };
}
function legacy(record, project) {
  shape(record, ["task", "captured_at", "runtime", "join_method", "window", "attribution", "cost_mode", "offline", "totals"], ["phases"]);
  nonempty(record.task);
  if (!LEGACY_RUNTIMES.includes(record.runtime) || !["time-window-ledger", "time-window-ledger-partial", "none"].includes(record.join_method) || record.attribution !== "approximate" || !["auto", "calculate", "display"].includes(record.cost_mode) || record.offline !== true) invalid();
  shape(record.window, ["since", "until"]); validateTotals(record.totals, false);
  const since = record.window.since === null ? null : timestamp(record.window.since);
  const until = record.window.until === null ? null : timestamp(record.window.until);
  if (since !== null && until !== null && since > until) invalid();
  if (record.phases !== undefined) {
    if (!Array.isArray(record.phases)) invalid();
    for (const phase of record.phases) {
      shape(phase, ["phase", "cost_usd", "tokens", "approximate"]); nonempty(phase.phase);
      if (phase.approximate !== true || !Number.isFinite(phase.cost_usd) || phase.cost_usd < 0 || !Number.isSafeInteger(phase.tokens) || phase.tokens < 0) invalid();
    }
  }
  return { format: "legacy-window", project, runtime: record.runtime, source: "ccusage", model: "unknown", since, until,
    key: JSON.stringify([project, record.runtime, since, until]), at: timestamp(record.captured_at), totals: record.totals,
    limitations: ["legacy-time-window-attribution-approximate", "legacy-cost-imported-without-repricing"] };
}
function parseArgs(argv) {
  if (argv.length === 1 && ["--help", "help"].includes(argv[0])) return { help: true };
  if (argv[0] !== "report") throw new Error("invalid-arguments");
  const result = { projects: [], inputs: [] };
  for (let i = 1; i < argv.length; i += 2) {
    if (!["--project", "--input"].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("invalid-arguments");
    result[argv[i] === "--project" ? "projects" : "inputs"].push(argv[i + 1]);
  }
  return result;
}
function selectedFiles(options, cwd, diagnostics) {
  const projects = new Set(), candidates = [];
  for (const root of options.projects.length ? options.projects : [cwd]) {
    try { const project = fs.realpathSync(path.resolve(cwd, root)); if (!fs.statSync(project).isDirectory()) throw new Error(); projects.add(project); }
    catch { diagnostics.invalid_inputs++; }
  }
  for (const project of projects) for (const relative of DEFAULTS) candidates.push({ file: path.join(project, relative), project, explicit: false });
  for (const fileArg of options.inputs) {
    const file = path.resolve(cwd, fileArg);
    const containing = [...projects].filter(project => file.startsWith(project + path.sep)).sort((a, b) => b.length - a.length);
    const project = projects.size === 1 ? [...projects][0] : containing[0];
    if (!project) { diagnostics.invalid_inputs++; continue; }
    candidates.push({ file, project, explicit: true });
  }
  return candidates;
}
function readRecords(candidates, diagnostics, stats) {
  const seen = new Set(), records = [];
  let bytes = 0;
  for (const candidate of candidates) {
    try {
      const file = fs.realpathSync(candidate.file); if (seen.has(file)) continue; seen.add(file);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || bytes + stat.size > MAX_TOTAL_BYTES) throw new Error();
      bytes += stat.size; stats.input_files++; stats.projects.add(candidate.project);
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue; stats.records++;
        try {
          const raw = JSON.parse(line);
          records.push(raw && Object.hasOwn(raw, "schema_version") ? normalized(raw, candidate.project) : legacy(raw, candidate.project));
        } catch { diagnostics.invalid_records++; }
      }
    } catch (error) { if (candidate.explicit || error.code !== "ENOENT") diagnostics.invalid_inputs++; }
  }
  return records;
}
function sameTotals(a, b) { return METRICS.every(metric => a[metric] === b[metric]); }
function latestUnits(records, diagnostics) {
  const streams = new Map();
  for (const record of records) {
    const key = JSON.stringify([record.format, record.key]);
    if (!streams.has(key)) streams.set(key, []); streams.get(key).push(record);
  }
  const units = [];
  for (const snapshots of streams.values()) {
    snapshots.sort((a, b) => a.at - b.at);
    const unit = { ...snapshots.at(-1), limitations: [...new Set(snapshots.flatMap(item => item.limitations))], invalid: false };
    const known = emptyTotals(); let previous;
    for (const snapshot of snapshots) {
      if (previous?.at === snapshot.at && !sameTotals(previous.totals, snapshot.totals)) unit.invalid = true;
      if (unit.format === "cumulative") for (const metric of METRICS) {
        const value = snapshot.totals[metric];
        if (value !== null && known[metric] !== null && value < known[metric]) unit.invalid = true;
        if (value !== null) known[metric] = value;
      }
      previous = snapshot;
    }
    if (unit.format === "cumulative") {
      const models = new Set(snapshots.map(snapshot => snapshot.model));
      if (models.size !== 1 || models.has("unknown")) { unit.model = "unknown"; unit.limitations.push("model-attribution-unknown"); }
    }
    if (unit.invalid) diagnostics.invalid_streams++;
    units.push(unit);
  }
  return units;
}
function coverageProblems(units) {
  const problems = new Set(), projects = new Map();
  if (new Set(units.map(unit => unit.format)).size > 1) problems.add("mixed-format-coverage-unproven");
  for (const unit of units) {
    if (unit.invalid) problems.add("invalid-stream-history");
    if (unit.runtime === "unknown") problems.add("runtime-coverage-unproven");
    if (unit.format === "legacy-window" && (unit.since === null || unit.until === null)) problems.add("legacy-window-bounds-unknown");
    if (!projects.has(unit.project)) projects.set(unit.project, new Map());
    const runtimeGroups = projects.get(unit.project);
    if (!runtimeGroups.has(unit.runtime)) runtimeGroups.set(unit.runtime, []);
    runtimeGroups.get(unit.runtime).push(unit);
  }
  for (const runtimeGroups of projects.values()) {
    if (runtimeGroups.size > 1 && (runtimeGroups.has("cross-runtime") || runtimeGroups.has("unknown"))) problems.add("runtime-coverage-unproven");
    for (const members of runtimeGroups.values()) {
      if (new Set(members.filter(unit => unit.format === "cumulative").map(unit => unit.source)).size > 1) problems.add("cross-source-coverage-unproven");
      const windows = members.filter(unit => unit.format === "legacy-window" && unit.since !== null && unit.until !== null).sort((a, b) => a.since - b.since);
      let end = -Infinity;
      for (const window of windows) {
        if (window.since <= end) problems.add("legacy-window-overlap");
        end = Math.max(end, window.until);
      }
    }
  }
  return [...problems].sort();
}
function aggregate(units, extraProblems = []) {
  const limitations = new Set([...extraProblems, ...coverageProblems(units)]), totals = emptyTotals();
  if (units.length && !limitations.size) for (const metric of METRICS) {
    if (units.some(unit => unit.totals[metric] === null)) continue;
    const sum = units.reduce((total, unit) => total + unit.totals[metric], 0);
    if (!Number.isFinite(sum) || metric !== "cost_usd" && !Number.isSafeInteger(sum)) limitations.add("numeric-aggregate-overflow");
    else totals[metric] = sum;
  }
  return { totals, problems: [...limitations].sort() };
}
function groupsFor(units) {
  const groups = new Map();
  for (const unit of units) {
    const key = JSON.stringify([unit.format, unit.runtime, unit.source, unit.model]);
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(unit);
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, members]) => {
    const first = members[0], combined = aggregate(members);
    return { format: first.format, runtime: first.runtime, source: first.source, model: first.model, totals: combined.totals,
      coverage: { observations: members.length, attribution: first.format === "legacy-window" ? "approximate" : "producer-reported", metrics: metricCoverage(combined.totals) },
      limitations: [...new Set([...combined.problems, ...members.flatMap(unit => unit.limitations)])].sort() };
  });
}
function metricCoverage(totals) { return Object.fromEntries(METRICS.map(metric => [metric, totals[metric] === null ? "unknown" : "complete"])); }
function buildReport(units, diagnostics, stats) {
  const invalidInput = Object.values(diagnostics).some(count => count > 0);
  const combined = aggregate(units, invalidInput ? ["invalid-input-or-stream"] : []);
  const limitations = new Set([...combined.problems, ...units.flatMap(unit => unit.limitations)]);
  if (units.some(unit => unit.format === "cumulative")) limitations.add("producer-asserted-stream-independence");
  if (stats.projects.size > 1) limitations.add("project-scopes-asserted-independent");
  const partial = METRICS.some(metric => combined.totals[metric] === null) || units.some(unit => unit.format === "legacy-window" || unit.model === "unknown");
  return { schema_version: 1, status: invalidInput ? "invalid" : !units.length ? "no-data" : partial ? "partial" : "ok", advisory: true,
    totals: combined.totals, coverage: { selection: "selected-inputs-only", projects: stats.projects.size, input_files: stats.input_files, records: stats.records,
      normalized_streams: units.filter(unit => unit.format === "cumulative").length, legacy_windows: units.filter(unit => unit.format === "legacy-window").length, metrics: metricCoverage(combined.totals) },
    provenance: { runtimes: [...new Set(units.map(unit => unit.runtime))].sort(), sources: [...new Set(units.map(unit => unit.source))].sort(), measurement: "imported-assertions", pricing: "not-performed" },
    groups: groupsFor(units), diagnostics, limitations: [...limitations].sort() };
}
function report(options, cwd) {
  const diagnostics = { invalid_inputs: 0, invalid_records: 0, invalid_streams: 0 };
  const stats = { projects: new Set(), input_files: 0, records: 0 };
  const records = readRecords(selectedFiles(options, cwd, diagnostics), diagnostics, stats);
  return buildReport(latestUnits(records, diagnostics), diagnostics, stats);
}
function main(argv, cwd = process.cwd()) {
  try {
    const options = parseArgs(argv);
    if (options.help) return { usage: "roster-usage.cjs report [--project DIR ...] [--input JSONL ...]", manual: true, read_only: true, normalized_schema_version: 1 };
    return report(options, cwd);
  } catch {
    const result = buildReport([], { invalid_inputs: 1, invalid_records: 0, invalid_streams: 0 }, { projects: new Set(), input_files: 0, records: 0 });
    result.limitations = ["invalid-arguments-or-unavailable-input"]; return result;
  }
}
if (require.main === module) {
  const result = main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status === "invalid") process.exitCode = 1;
}
module.exports = { main };
