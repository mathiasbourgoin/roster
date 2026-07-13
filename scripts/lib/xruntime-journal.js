// scripts/lib/xruntime-journal.js — CommonJS.
//
// Journal + persisted-state I/O for scripts/xruntime-review.js
// (FR-095..098, Amendment D-2, D-8). The journal is append-forever per task
// (briefs/<task>-xruntime.jsonl); review.json state is read-only here — the
// helper reads only the PERSISTED briefs/<task>-review.json, never a
// `.draft` file (V-1).
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SLUG_RE = /^[a-z0-9-]+$/;

function validSlug(task) {
  return typeof task === "string" && SLUG_RE.test(task);
}

function journalPath(root, task) {
  return path.resolve(root, "briefs", `${task}-xruntime.jsonl`);
}

function reviewJsonPath(root, task) {
  return path.resolve(root, "briefs", `${task}-review.json`);
}

// D-8: warn (stderr) when briefs/ is not actually git-ignored in this repo —
// a consumer repo without the ignore would see the append-forever journal as
// a standing untracked file visible to the scope gate. Non-blocking.
function warnIfBriefsNotIgnored(root) {
  try {
    execSync("git check-ignore briefs/", { cwd: root, stdio: "ignore" });
  } catch (e) {
    process.stderr.write(
      "xruntime-review: warning — briefs/ is not git-ignored in this repo; the append-forever " +
        "journal will be a standing untracked file visible to the scope gate (D-8).\n"
    );
  }
}

// FR-095/096: append exactly one JSON line per invocation, after — never
// during — the wrapper subprocess. Journal-append failure is reported to the
// caller (never silently healthy, FR-096).
function appendJournalLine(root, task, entry) {
  const line = JSON.stringify(entry);
  try {
    fs.mkdirSync(path.resolve(root, "briefs"), { recursive: true });
    fs.appendFileSync(journalPath(root, task), line + "\n");
  } catch (e) {
    return { ok: false, error: e.message, line };
  }
  return { ok: true, line };
}

// Reads the persisted review.json. Absent or malformed both resolve to
// `null` (treated as "no prior state" — a malformed file must not be able to
// force a refusal the human never asked for).
function readReviewJson(root, task) {
  const p = reviewJsonPath(root, task);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return null;
  }
}

// D-2: FR-097 refusal applies ONLY when the persisted review.json has
// `status: "NO-GO"` (mid-cycle) — a persisted GO or an absent file means a
// fresh cycle is starting, so a prior degraded state is stale and must not
// permanently ban the runtime (O-2). `--human-retry` always bypasses.
function shouldRefuseDegraded(reviewJson, runtime, currentDigest, humanRetry) {
  if (humanRetry) return false;
  if (!reviewJson || reviewJson.status !== "NO-GO") return false;
  const entry = reviewJson.cross_runtime && reviewJson.cross_runtime[runtime];
  if (!entry || entry.status !== "degraded") return false;
  return entry.config_digest === currentDigest;
}

module.exports = {
  validSlug,
  journalPath,
  reviewJsonPath,
  warnIfBriefsNotIgnored,
  appendJournalLine,
  readReviewJson,
  shouldRefuseDegraded,
};
