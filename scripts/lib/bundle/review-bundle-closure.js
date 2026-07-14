// scripts/lib/review-bundle-closure.js — CommonJS, zero-dep.
//
// Derives the review-tool bundle's file closure from the REQUIRE GRAPH (FR-125), rather than
// a hand-maintained list. Two edge kinds are recognized, matching every static file reference
// actually present in the review-tool sources:
//   1. `require("./relative/literal")` — ordinary CommonJS module edges.
//   2. `path.resolve(__dirname, "a", "b", ...)` where every segment after `__dirname` is a
//      string literal — covers non-require file references (xruntime-review.js's WRAPPER
//      constant pointing at xruntime-exec.sh; finding-schema.js's dynamic schema require()).
// Any other dynamic construction (process.cwd(), a passed-in root, os.tmpdir()) is runtime
// data, not a static closure edge, and is deliberately NOT followed.
//
// Walking is scoped to .js files only — a discovered edge that resolves to a non-.js file
// (the wrapper .sh, the schema .json) is recorded as a leaf, not walked further.
//
// Maintainer note: only these two patterns are ever walked. A string-concatenated path
// (`"./lib/" + name`), a require built from a computed variable with no literal segments, or
// any other cwd-relative or runtime-assembled reference escapes BOTH this closure walk and the
// FR-127 closure-escape CI check silently — such a file would be required at runtime but never
// appear in the manifest, and the check would have nothing to flag. Do not introduce one of
// these patterns in a bundle file; keep every file reference either a literal require() or a
// path.resolve/join(__dirname, "literal", ...) call.

"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;
const RESOLVE_RE = /path\.(?:resolve|join)\(\s*__dirname\s*,([^)]*)\)/g;
const LITERAL_SEGMENT_RE = /["']([^"']+)["']/g;

/**
 * Strip `//` line comments and `/* *\/` block comments so a require() mentioned in a doc
 * comment (e.g. an example usage line) is never mistaken for a real edge. Deliberately naive
 * (no string-literal awareness) — safe here because none of the walked sources embed a `//`
 * or `/*` inside a string literal.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Extract every statically-derivable file edge (relative-to-file paths) from JS source text. */
function extractEdges(text) {
  const code = stripComments(text);
  const edges = [];
  let m;
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(code))) {
    if (m[1].startsWith(".")) edges.push(m[1].split("/"));
  }
  RESOLVE_RE.lastIndex = 0;
  while ((m = RESOLVE_RE.exec(code))) {
    const segs = [];
    let s;
    LITERAL_SEGMENT_RE.lastIndex = 0;
    while ((s = LITERAL_SEGMENT_RE.exec(m[1]))) segs.push(s[1]);
    if (segs.length) edges.push(segs);
  }
  return edges;
}

/** Resolve a require()-style relative path to an absolute .js file path, adding .js if bare. */
function resolveModule(fromDir, edgeSegments) {
  let p = path.resolve(fromDir, ...edgeSegments);
  if (!fs.existsSync(p) && fs.existsSync(p + ".js")) p += ".js";
  return p;
}

/**
 * Walk the require graph starting at `entryFiles` (absolute paths), returning the full closure
 * as a Set of absolute paths (entries included). Non-.js leaves (wrapper, schema) are included
 * but not walked further — they carry no requires of their own.
 */
function computeClosure(entryFiles) {
  const seen = new Set();
  const queue = [...entryFiles];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith(".js") || !fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const dir = path.dirname(file);
    for (const segs of extractEdges(text)) {
      const resolved = resolveModule(dir, segs);
      if (!seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

module.exports = { computeClosure, extractEdges, resolveModule };
