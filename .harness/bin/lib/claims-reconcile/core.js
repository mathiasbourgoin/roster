"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { SET_ARRAY_KEYS, TIMESTAMP_KEYS } = require("./constants");

class ClaimsError extends Error {
  constructor(reason, message, details) {
    super(message);
    this.name = "ClaimsError";
    this.reason = reason;
    this.details = details || null;
  }
}

function fail(reason, message, details) {
  throw new ClaimsError(reason, message, details);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertClosedObject(value, allowed, label) {
  if (!isObject(value)) fail("invalid-shape", `${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("unknown-field", `${label} has unknown field: ${key}`);
  }
}

function normalizeString(value) {
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}

function compareLexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value, key) {
  if (typeof value === "string") return normalizeString(value);
  if (Array.isArray(value)) {
    const normalized = value.map((item) => canonicalize(item));
    if (SET_ARRAY_KEYS.has(key)) normalized.sort((a, b) => compareLexical(JSON.stringify(a), JSON.stringify(b)));
    return normalized;
  }
  if (!isObject(value)) return value;
  const out = {};
  for (const childKey of Object.keys(value).filter((item) => !TIMESTAMP_KEYS.has(item)).sort(compareLexical)) {
    out[childKey] = canonicalize(value[childKey], childKey);
  }
  return out;
}

function stableStringify(value, pretty = false) {
  return `${JSON.stringify(canonicalize(value), null, pretty ? 2 : 0)}${pretty ? "\n" : ""}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relativePosix(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function lstatIfExists(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function resolveControlledPath(root, requested, label, reason) {
  const candidate = path.resolve(root, requested);
  if (!isInside(root, candidate)) fail(reason, `${label} must be inside the repository root`);
  let current = root;
  for (const component of path.relative(root, candidate).split(path.sep)) {
    current = path.join(current, component);
    const stat = lstatIfExists(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) fail(reason, `${label} must not contain symbolic links: ${relativePosix(root, current)}`);
    const actual = fs.realpathSync(current);
    if (actual !== root && !isInside(root, actual)) fail(reason, `${label} resolves outside the repository root`);
  }
  return candidate;
}

function resolveProjectionDirectory(root, requested, create) {
  const outputDir = resolveControlledPath(root, requested, "projection output", "invalid-output");
  const existing = lstatIfExists(outputDir);
  if (existing && !existing.isDirectory()) fail("invalid-output", "projection output must be a directory");
  if (create) fs.mkdirSync(outputDir, { recursive: true });
  if (fs.existsSync(outputDir)) confirmProjectionDirectory(root, requested, outputDir);
  return outputDir;
}

function confirmProjectionDirectory(root, requested, outputDir) {
  resolveControlledPath(root, requested, "projection output", "invalid-output");
  const actual = fs.realpathSync(outputDir);
  if (!isInside(root, actual)) fail("invalid-output", "projection output resolves outside the repository root");
}

function assertProjectionTargetsSafe(root, outputDir, names) {
  for (const name of names) {
    resolveControlledPath(root, path.join(outputDir, name), `projection target ${name}`, "invalid-output");
  }
}

function readJsonFile(file, missingReason, label) {
  if (!fs.existsSync(file)) fail(missingReason, `${label} not found: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail("malformed-json", `${label} is not valid JSON: ${error.message}`);
  }
}

module.exports = {
  ClaimsError,
  assertClosedObject,
  assertProjectionTargetsSafe,
  canonicalize,
  compareLexical,
  digest,
  fail,
  isInside,
  isObject,
  normalizeString,
  readJsonFile,
  relativePosix,
  resolveControlledPath,
  resolveProjectionDirectory,
  sha256File,
  stableStringify,
};
