// Shared read-only fingerprint of Git-visible superproject state.
// This detects persistent changes, not transient writes or OS-wide confinement.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

function snapshotTree(repoRoot) {
  let cwd = repoRoot;
  const git = (args) => execFileSync("git", args, {
    cwd, stdio: "pipe", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  const root = git(["rev-parse", "--show-toplevel"]).subarray(0, -1);
  cwd = root;
  const hash = crypto.createHash("sha256");
  // Length framing separates arbitrary binary paths/content and missing/type records.
  const record = (value) => {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    hash.update(String(data.length) + ":");
    hash.update(data);
  };
  record(git(["status", "--porcelain=v1", "-z", "-uall"]));
  record(git(["ls-files", "--stage", "-z"]));
  const listing = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const paths = [];
  for (let start = 0, end = 0; end < listing.length; end++) {
    if (listing[end] === 0) { paths.push(listing.subarray(start, end)); start = end + 1; }
  }
  paths.sort(Buffer.compare);
  const chunk = Buffer.alloc(64 * 1024);
  let previous;
  for (const name of paths) {
    if (previous && name.equals(previous)) continue;
    previous = name;
    record(name);
    const absolute = Buffer.concat([root, Buffer.from(path.sep), name]);
    // A replaced tracked directory can be a symlink too. Inspect ancestors
    // from the root outward so their targets are never traversed for hashing.
    let linkedAncestor = false;
    for (let slash = name.indexOf(47); slash !== -1; slash = name.indexOf(47, slash + 1)) {
      const parent = Buffer.concat([root, Buffer.from(path.sep), name.subarray(0, slash)]);
      let parentStat;
      try { parentStat = fs.lstatSync(parent); }
      catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        break;
      }
      if (parentStat.isSymbolicLink()) {
        record("symlink-ancestor");
        record(name.subarray(0, slash));
        record(fs.readlinkSync(parent, { encoding: "buffer" }));
        linkedAncestor = true;
        break;
      }
    }
    if (linkedAncestor) continue;
    let stat;
    try { stat = fs.lstatSync(absolute); }
    catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      record("missing");
      continue;
    }
    record(String(stat.mode));
    if (stat.isSymbolicLink()) record(fs.readlinkSync(absolute, { encoding: "buffer" }));
    else if (stat.isFile()) {
      // Stream large files; no external filters, index refresh, or Git object writes.
      const content = crypto.createHash("sha256");
      const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        let count;
        while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
          content.update(chunk.subarray(0, count));
        }
      } finally { fs.closeSync(fd); }
      record(content.digest());
    } else if (stat.isDirectory()) record("directory"); // Gitlinks: status/index above.
    else throw new Error("unsupported Git-visible file type");
  }
  return hash.digest("hex");
}

if (require.main === module) {
  try { process.stdout.write(snapshotTree(process.cwd()) + "\n"); }
  catch (error) { console.error("tree snapshot unavailable: " + error.message); process.exitCode = 2; }
}

module.exports = { snapshotTree };
