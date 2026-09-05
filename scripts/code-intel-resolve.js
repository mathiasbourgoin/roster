#!/usr/bin/env node
// code-intel-resolve.js — CommonJS, buildless (runs directly, no dist compile).
//
// Shared resolver for the code-intel pack consumer seam (specs/code-intel-packs.md,
// FR-020–044). Consumers (roster-qa, roster-doctor, roster-audit, code-quality-auditor)
// call this instead of re-implementing pack resolution: packs are recognised purely by
// their SKILL.md frontmatter contract (`capability: code-intel` + `provides` + `entry` +
// `requires_tools`) over the projected runtime skill dirs — never via the registry or
// harness.json (FR-023), so private/user-authored packs are first-class (FR-024).
//
// Usage:  node scripts/code-intel-resolve.js <list|gate|audit|doctor> [--root <dir>]
//                                            [--timeout <sec>] [--properties <path>]
// Exit:   list/audit/doctor → 0 (doctor is advisory-only per FR-044)
//         gate → 0 pass/skip/degraded, 1 invariant violated, 2 malformed declaration
//         64 → usage error

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EXIT_USAGE = 64;
const DEFAULT_TIMEOUT_SEC = 120;
const PROVIDES_VALUES = ["gate", "audit-section", "init"];

// ---------------------------------------------------------------------------
// Frontmatter (CJS mirror of scripts/lib/frontmatter.ts — flat key:value only;
// indented/nested YAML is intentionally skipped, lists must be inline `[a, b]`)
// ---------------------------------------------------------------------------

// Strip quotes only when they are a matched pair — unlike frontmatter.ts's parseScalar,
// this never mangles a value that merely ENDS in a quote (e.g. `entry: bash -c 'exit 3'`).
function stripMatchedQuotes(value) {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first) {
    return value.slice(1, -1);
  }
  return value;
}

function parseInlineArray(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => stripMatchedQuotes(item.trim()))
    .filter(Boolean);
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if ((lines[0] || "").trim() !== "---") return null;
  const fm = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") return fm;
    if (!line || line.startsWith(" ") || line.startsWith("\t")) continue;
    const sep = line.indexOf(":");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) continue;
    fm[key] =
      value.startsWith("[") && value.endsWith("]") ? parseInlineArray(value) : stripMatchedQuotes(value);
  }
  return null; // unterminated frontmatter
}

// ---------------------------------------------------------------------------
// list — pack resolution (FR-021/022/024)
// ---------------------------------------------------------------------------

function skillRoots(root) {
  const roots = [".agents/skills", ".opencode/skills"];
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, ".harness/extensions.json"), "utf8"));
  } catch {
    return roots; // absent or malformed extensions.json is silently tolerated
  }
  const extensions = Array.isArray(raw && raw.extensions) ? raw.extensions : [];
  for (const ext of extensions) {
    const extraRoots = Array.isArray(ext && ext.runtime_roots) ? ext.runtime_roots : [];
    for (const rel of extraRoots) {
      if (typeof rel === "string" && rel && !roots.includes(rel)) roots.push(rel);
    }
  }
  return roots;
}

// All <root>/<runtime>/<dir>/SKILL.md candidates, in root-priority order
// (.agents first — it wins dedupe per FR-022).
function readSkillCandidates(root) {
  const candidates = [];
  for (const rel of skillRoots(root)) {
    const runtimeDir = path.join(root, rel);
    let entries;
    try {
      entries = fs.readdirSync(runtimeDir).sort();
    } catch {
      continue;
    }
    for (const base of entries) {
      const skillDir = path.join(runtimeDir, base);
      const skillFile = path.join(skillDir, "SKILL.md");
      let content;
      try {
        content = fs.readFileSync(skillFile, "utf8");
      } catch {
        continue;
      }
      candidates.push({ base, dir: skillDir, file: skillFile, content, drift: false });
    }
  }
  return candidates;
}

function buildPackRecord(candidate, fm) {
  const violations = [];
  const provides = typeof fm.provides === "string" ? fm.provides : "";
  const entry = typeof fm.entry === "string" ? fm.entry : "";
  if (!provides) violations.push("missing provides");
  else if (!PROVIDES_VALUES.includes(provides)) {
    violations.push(`provides "${provides}" is not one of ${PROVIDES_VALUES.join("|")}`);
  }
  if (!entry) violations.push("missing entry");
  return {
    name: typeof fm.name === "string" && fm.name ? fm.name : candidate.base,
    dir: candidate.dir,
    file: candidate.file,
    provides,
    entry,
    requires_tools: Array.isArray(fm.requires_tools) ? fm.requires_tools : [],
    drift: candidate.drift,
    valid: violations.length === 0,
    violations,
  };
}

function listPacks(root) {
  const byBase = new Map(); // skill dir basename → winning candidate (first root wins)
  for (const candidate of readSkillCandidates(root)) {
    const winner = byBase.get(candidate.base);
    if (!winner) byBase.set(candidate.base, candidate);
    else if (candidate.content !== winner.content) winner.drift = true;
  }
  const packs = [];
  for (const candidate of byBase.values()) {
    const fm = parseFrontmatter(candidate.content);
    if (!fm || fm.capability !== "code-intel") continue;
    packs.push(buildPackRecord(candidate, fm));
  }
  return packs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// entry execution (shared by gate/audit)
// ---------------------------------------------------------------------------

// `entry` script paths are declared relative to the skill dir (schema/skill-schema.md)
// but the command runs with cwd = project root. Rewrite only the token right after the
// interpreter, and only when it names an existing file inside the skill dir.
function resolveEntryCommand(entry, skillDir) {
  const parts = entry.split(/\s+/);
  const scriptToken = parts[1];
  if (scriptToken && !scriptToken.startsWith("-") && !path.isAbsolute(scriptToken)) {
    const candidate = path.join(skillDir, scriptToken);
    if (fs.existsSync(candidate)) {
      parts[1] = `"${candidate}"`;
      return parts.join(" ");
    }
  }
  return entry;
}

function runEntry(pack, args, root, timeoutSec) {
  const command = resolveEntryCommand(pack.entry, pack.dir);
  const result = spawnSync("bash", ["-c", `${command} "$@"`, "bash", ...args], {
    cwd: root,
    env: Object.assign({}, process.env, { SKILL_DIR: pack.dir }),
    encoding: "utf8",
    timeout: timeoutSec * 1000,
    killSignal: "SIGKILL",
  });
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  if (timedOut) {
    return { exit: 3, reason: `timeout after ${timeoutSec}s`, stdout: result.stdout || "", stderr: result.stderr || "" };
  }
  if (result.status === null) {
    return { exit: 3, reason: `killed by signal ${result.signal}`, stdout: result.stdout || "", stderr: result.stderr || "" };
  }
  return { exit: result.status, reason: `entry exited ${result.status}`, stdout: result.stdout || "", stderr: result.stderr || "" };
}

// ---------------------------------------------------------------------------
// gate — GateExitContract (FR-025–038)
// ---------------------------------------------------------------------------

function extractCodeIntelBlock(propertiesPath) {
  let text;
  try {
    text = fs.readFileSync(propertiesPath, "utf8");
  } catch {
    return { present: false, lines: [] };
  }
  let inBlock = false;
  let found = false;
  const blockLines = [];
  for (const line of text.split(/\r?\n/)) {
    if (!inBlock && line.trim() === "```code-intel") {
      inBlock = true;
      found = true;
      continue;
    }
    if (inBlock && line.trim().startsWith("```")) {
      inBlock = false;
      continue;
    }
    if (inBlock) blockLines.push(line);
  }
  return { present: found, lines: blockLines };
}

// Each non-empty line must be a JSON object with string id/type/description + object check.
function validateInvariantLines(lines) {
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let declaration;
    try {
      declaration = JSON.parse(line);
    } catch (err) {
      return { ok: false, error: `line ${i + 1} is not valid JSON: ${err.message}` };
    }
    const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
    const shapeOk =
      isObject(declaration) &&
      typeof declaration.id === "string" &&
      typeof declaration.type === "string" &&
      typeof declaration.description === "string" &&
      isObject(declaration.check);
    if (!shapeOk) {
      return {
        ok: false,
        error: `line ${i + 1} must be an object with string id, type, description and object check`,
      };
    }
    count += 1;
  }
  return { ok: true, count };
}

// Any exit outside the 0/1/2/3 contract is a pack malfunction → degraded (3), not a violation.
function normalizeGateExit(exit) {
  return exit === 0 || exit === 1 || exit === 2 || exit === 3 ? exit : 3;
}

function runGatePacks(gatePacks, blockPath, root, timeoutSec) {
  const outcome = { sawViolation: false, sawMalformed: false, degraded: [] };
  for (const pack of gatePacks) {
    const run = runEntry(pack, [blockPath], root, timeoutSec);
    const exit = normalizeGateExit(run.exit);
    console.log(`GATE ${pack.name}: exit ${exit}`);
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    if (exit === 1) outcome.sawViolation = true;
    else if (exit === 2) outcome.sawMalformed = true;
    else if (exit === 3) outcome.degraded.push({ name: pack.name, reason: run.reason });
  }
  return outcome;
}

function cmdGate(opts) {
  const propertiesPath = opts.properties || path.join(opts.root, "kb", "properties.md");
  const block = extractCodeIntelBlock(propertiesPath);
  if (!block.present) {
    console.log("SKIP: no code-intel block");
    console.log("RESULT: skip");
    return 0;
  }
  const validated = validateInvariantLines(block.lines);
  if (!validated.ok) {
    console.error(`MALFORMED: code-intel declaration in ${propertiesPath} — ${validated.error}`);
    console.log("RESULT: malformed");
    return 2;
  }
  if (validated.count === 0) console.log("NOTE: 0 invariants declared — gate packs still run");
  const gatePacks = listPacks(opts.root).filter((p) => p.valid && p.provides === "gate");
  if (gatePacks.length === 0) {
    console.log("SKIP: no installed gate packs");
    console.log("RESULT: skip");
    return 0;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-intel-gate-"));
  const blockPath = path.join(tmpDir, "invariants.jsonl");
  fs.writeFileSync(blockPath, block.lines.join("\n") + "\n");
  let outcome;
  try {
    outcome = runGatePacks(gatePacks, blockPath, opts.root, opts.timeout);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  if (outcome.sawViolation) {
    console.log("RESULT: fail");
    return 1;
  }
  if (outcome.sawMalformed) {
    console.error("MALFORMED: a gate pack rejected the code-intel declaration (exit 2)");
    console.log("RESULT: malformed");
    return 2;
  }
  if (outcome.degraded.length > 0) {
    for (const d of outcome.degraded) console.log(`DEGRADED: ${d.name}: ${d.reason}`);
    console.log("RESULT: degraded");
    return 0;
  }
  console.log("RESULT: pass");
  return 0;
}

// ---------------------------------------------------------------------------
// audit — audit-section providers (FR-045–050); always exit 0 (advisory)
// ---------------------------------------------------------------------------

function hasFreshnessHeader(stdout) {
  const firstContentLine = (stdout.split(/\r?\n/).find((l) => l.trim() !== "") || "").trimStart();
  return (
    firstContentLine.startsWith("<!-- index-freshness:") ||
    firstContentLine.startsWith("Index freshness:")
  );
}

function cmdAudit(opts) {
  const auditPacks = listPacks(opts.root).filter((p) => p.valid && p.provides === "audit-section");
  for (const pack of auditPacks) {
    const run = runEntry(pack, [], opts.root, opts.timeout);
    if (run.exit !== 0) {
      console.log(`DEGRADED ${pack.name}: ${run.reason}`);
      continue;
    }
    if (!hasFreshnessHeader(run.stdout)) {
      console.log(`DEGRADED ${pack.name}: fragment is missing the mandatory index-freshness header`);
      continue;
    }
    console.log(`SECTION ${pack.name}`);
    process.stdout.write(run.stdout.endsWith("\n") ? run.stdout : run.stdout + "\n");
  }
  return 0;
}

// ---------------------------------------------------------------------------
// doctor — advisory only, never exits non-zero for pack problems (FR-039–044)
// ---------------------------------------------------------------------------

function toolOnPath(tool) {
  const result = spawnSync("bash", ["-c", 'command -v "$1"', "bash", tool], { encoding: "utf8" });
  return result.status === 0;
}

function cmdDoctor(opts) {
  const packs = listPacks(opts.root);
  if (packs.length === 0) {
    console.log("code-intel packs: none installed");
    return 0;
  }
  console.log(`code-intel packs (${packs.length}):`);
  for (const pack of packs) {
    console.log(`  ${pack.name} — provides: ${pack.provides || "(missing)"}, entry: ${pack.entry || "(missing)"}`);
  }
  for (const pack of packs) {
    for (const violation of pack.violations) console.log(`WARN contract: ${pack.name}: ${violation}`);
    if (pack.drift) console.log(`WARN drift: ${pack.name}`);
    for (const tool of pack.requires_tools) {
      if (!toolOnPath(tool)) console.log(`WARN pack degraded: tool-missing:${tool} (${pack.name})`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseOpts(args) {
  const opts = { root: process.cwd(), timeout: DEFAULT_TIMEOUT_SEC, properties: null };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag !== "--root" && flag !== "--timeout" && flag !== "--properties") return null;
    if (value === undefined) return null;
    i += 1;
    if (flag === "--root") opts.root = path.resolve(value);
    else if (flag === "--properties") opts.properties = path.resolve(value);
    else {
      opts.timeout = Number(value);
      if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) return null;
    }
  }
  return opts;
}

function usage() {
  console.error(
    "usage: node scripts/code-intel-resolve.js <list|gate|audit|doctor> [--root <dir>] [--timeout <sec>] [--properties <path>]",
  );
}

function main(argv) {
  const [command, ...rest] = argv.slice(2);
  const opts = parseOpts(rest);
  if (!opts) {
    usage();
    return EXIT_USAGE;
  }
  if (command === "list") {
    console.log(JSON.stringify(listPacks(opts.root), null, 2));
    return 0;
  }
  if (command === "gate") return cmdGate(opts);
  if (command === "audit") return cmdAudit(opts);
  if (command === "doctor") return cmdDoctor(opts);
  usage();
  return EXIT_USAGE;
}

module.exports = { parseFrontmatter, listPacks, extractCodeIntelBlock, validateInvariantLines, main };

if (require.main === module) process.exit(main(process.argv));
