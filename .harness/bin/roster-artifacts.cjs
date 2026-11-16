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
  try {
    return JSON.parse(readBytes(file).toString("utf8"));
  } catch (err) { fail(`cannot read ${file}: ${err.message}`); }
}
// Bounds actual consumption as well as initial size. Ancestor checks are best
// effort, not protection against hostile concurrent ancestor replacement.
function readBytes(file, options = {}) {
  let fd, sawInitialStat = false;
  const reject = (reason, message) => { const error = new Error(message); error.reason = reason; throw error; };
  try {
    try { safeAncestors(file); } catch (error) { reject("unsafe", error.message); }
    const stat = fs.lstatSync(file);
    sawInitialStat = true;
    if (!stat.isFile() || (options.strict && stat.nlink !== 1)) reject("unsafe", `expected regular file ${file}`);
    if (stat.size > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
    // A final-component swap to a FIFO must not block before descriptor validation.
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || (options.strict && opened.nlink !== 1)) reject("unsafe", `expected regular file ${file}`);
    const same = (a,b) => ["dev","ino","size","mtimeMs","ctimeMs","nlink"].every(k => a[k] === b[k]);
    if (options.strict && !same(stat,opened)) reject("changed", "source changed");
    if (opened.size > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
    const chunks = []; let total = 0;
    for (;;) {
      if (options.strict && total === opened.size) break;
      const nextSize = Math.min(65536, MAX_JSON_BYTES + 1 - total, options.strict ? opened.size - total : Infinity);
      if (options.beforeRead) options.beforeRead(nextSize);
      const chunk = Buffer.allocUnsafe(nextSize);
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      if (options.onRead) options.onRead(count);
      total += count;
      if (total > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
      chunks.push(chunk.subarray(0, count));
    }
    if (!options.strict && fs.fstatSync(fd).size > MAX_JSON_BYTES) reject("oversized", `oversized JSON file ${file}`);
    if (options.strict) {
      const after = fs.fstatSync(fd), current = fs.lstatSync(file);
      if (!same(opened,after) || !same(after,current) || !current.isFile() || total !== after.size) reject("changed", "source changed");
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (!error.reason) error.reason = options.strict && sawInitialStat && ["ENOENT", "ENOTDIR"].includes(error.code) ? "changed" : error.code === "ELOOP" ? "unsafe" : "read";
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
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
module.exports = { readJSON, readBytes, atomicWrite, safeAncestors, MAX_JSON_BYTES };
