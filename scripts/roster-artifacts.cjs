"use strict";
// Shared local artifact IO for the portable roadmap companions.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const MAX_JSON_BYTES = 16 * 1024 * 1024;
function fail(message) { throw new Error(message); }
function safeAncestors(target) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) fail(`unsafe symlink at ${current}`); }
    catch (err) { if (err.code !== "ENOENT") throw err; }
  }
}
function readJSON(file) {
  safeAncestors(file);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) fail(`expected regular file ${file}`);
    if (stat.size > MAX_JSON_BYTES) fail(`oversized JSON file ${file}`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) { fail(`cannot read ${file}: ${err.message}`); }
}
function atomicWrite(file, value) {
  safeAncestors(file);
  const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) fail(`serialized artifact size exceeds ${MAX_JSON_BYTES} byte limit; keep long evidence in referenced files`);
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, serialized);
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
  }
}
module.exports = { readJSON, atomicWrite, safeAncestors };
