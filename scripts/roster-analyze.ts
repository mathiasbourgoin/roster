#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { analyze } from "./resource-analysis/analyze";
import { compactAnalysis } from "./resource-analysis/compact";
import { Observation, TASK_TYPES } from "./resource-analysis/types";
import { LIMITS, validateInput, validateObservation } from "./resource-analysis/validate";

// Bundled from source by build-analysis.mjs, including the existing bounded artifact IO.
// The supported runtime entry point is roster-analyze.cjs, not the intermediate tsc file.
const { readBytes, safeAncestors, atomicWrite }: {
  readBytes(file: string, options: { strict: boolean }): Buffer;
  safeAncestors(file: string): void;
  atomicWrite(file: string, value: string): void;
} = require("./roster-artifacts.cjs");
function decode(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
function readDocument(file: string): unknown { return JSON.parse(decode(readBytes(file, { strict: true }))); }
function initialAbsence(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
    && !("reason" in error && error.reason === "changed");
}
function readMemory(file: string): Observation[] {
  let bytes: Buffer;
  try { bytes = readBytes(file, { strict: true }); }
  catch (error) { if (initialAbsence(error)) throw new Error("memory missing; use record to create it, or omit --memory"); throw error; }
  return parseMemory(bytes);
}
function parseMemory(bytes: Buffer): Observation[] {
  if (bytes.length && bytes.at(-1) !== 10) throw new Error("memory has an incomplete final line; reconcile before use");
  const lines = decode(bytes).split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > LIMITS.observations) throw new Error("memory exceeds observation limit");
  const rows = lines.map((line, i) => {
    if (!line.trim()) throw new Error(`empty memory record at line ${i + 1}`);
    const row: unknown = JSON.parse(line); validateObservation(row); return row;
  });
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("duplicate observation id in memory");
  return rows;
}
function record(file: string, value: unknown) {
  validateObservation(value);
  safeAncestors(file);
  const lock = `${path.resolve(file)}.lock`;
  const fd = fs.openSync(lock, "wx", 0o600);
  try {
    let bytes: Buffer = Buffer.alloc(0);
    try { bytes = readBytes(file, { strict: true }); }
    catch (error) { if (!initialAbsence(error)) throw error; }
    const rows = parseMemory(bytes);
    const existing = rows.find(r => r.id === value.id);
    if (existing) {
      if (!isDeepStrictEqual(existing, value)) throw new Error("observation id already has different content");
      return { recorded: false, duplicate: true, id: value.id };
    }
    if (rows.length >= LIMITS.observations) throw new Error("memory exceeds observation limit");
    const updated = decode(bytes) + JSON.stringify(value) + "\n";
    atomicWrite(file, updated);
    return { recorded: true, duplicate: false, id: value.id };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function summarize(rows: Observation[]) {
  const groups = new Map<string, Observation[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.project, [...row.languages].sort(), [...row.task_types].sort(), row.resource_id, row.runtime, row.model, row.profile, row.route, row.cost_mode, row.currency]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return { schema_version: 1, observations: rows.length, groups: [...groups].map(([key, values]) => {
    const [project, languages, task_types, resource_id, runtime, model, profile, route, cost_mode, currency] = JSON.parse(key);
    const verified = values.filter(v => v.verified && ["success", "failure"].includes(v.outcome));
    const metrics = Object.fromEntries(["input_tokens", "cached_input_tokens", "output_tokens", "duration_seconds", "actual_cost"].map(k => {
      const known = values.map(v => v[k as keyof Observation]).filter((x): x is number => typeof x === "number");
      return [k, { samples: known.length, total: known.length ? known.reduce((a, b) => a + b, 0) : null }];
    }));
    return { project, languages, task_types, resource_id, runtime, model, profile, route, cost_mode, currency,
      attempts: values.length, verified_attempts: verified.length, verified_successes: verified.filter(v => v.outcome === "success").length, metrics };
  }) };
}
const commands: Record<string, string[]> = {
  analyze: ["input", "memory", "objective", "cost-weight", "format"], record: ["memory", "observation"], memory: ["memory"], taxonomy: [],
};
function main(argv: string[]): void {
  const [command, ...args] = argv;
  if (!Object.hasOwn(commands, command)) throw new Error("usage: roster-analyze.cjs analyze --input FILE [--memory FILE] [--objective cost|duration|balanced] [--cost-weight 0..1] [--format full|compact] | record --memory FILE --observation FILE | memory --memory FILE | taxonomy");
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flag.startsWith("--") || !commands[command].includes(flag.slice(2)) || opts.has(flag.slice(2)) || args[i + 1] === undefined || args[i + 1].startsWith("--")) throw new Error(`invalid, duplicate or incomplete option: ${flag}`);
    opts.set(flag.slice(2), args[i + 1]);
  }
  const required = (key: string) => { const v = opts.get(key); if (!v) throw new Error(`missing --${key}`); return v; };
  let result: unknown;
  if (command === "taxonomy") result = { schema_version: 1, task_types: TASK_TYPES, extensible: true };
  else if (command === "record") result = record(required("memory"), readDocument(required("observation")));
  else if (command === "memory") result = summarize(readMemory(required("memory")));
  else {
    const format = opts.get("format") ?? "full";
    if (!["full", "compact"].includes(format)) throw new Error("--format must be full or compact");
    const input = readDocument(required("input")); validateInput(input);
    if (opts.has("memory")) input.memory = [...input.memory, ...readMemory(opts.get("memory")!)];
    if (opts.has("objective")) input.policy.objective = opts.get("objective") as typeof input.policy.objective;
    if (opts.has("cost-weight")) { const weight = opts.get("cost-weight")!; if (!weight.trim()) throw new Error("invalid cost weight"); input.policy.cost_weight = Number(weight); }
    const analysis = analyze(input); result = format === "compact" ? compactAnalysis(input, analysis) : analysis;
    if (analysis.status !== "ok") process.exitCode = 2;
  }
  const output = JSON.stringify(result, null, 2) + "\n";
  if (Buffer.byteLength(output) > LIMITS.bytes) throw new Error("output exceeds byte limit");
  process.stdout.write(output);
}
try { main(process.argv.slice(2)); }
catch (error) { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n"); process.exitCode = 1; }
