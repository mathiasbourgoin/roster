// Regression test for review C1: a project that PERSISTS state to disk must not
// produce FALSE cross-stage regressions when a later stage's cumulative suite
// re-runs earlier tests. With per-run nonce namespacing, the S3 run uses fresh
// ids that cannot collide with the S2 run's persisted accounts.
//
// Before the fix (fixed ids), the S3 cumulative run would re-POST already-existing
// ids (409) and re-deposit onto persisted balances, causing spurious failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { runSuite } from "../lib/conformance-runner.mjs";
import { waitForReady } from "../lib/http.mjs";
import { tests as s2tests } from "../problems/ledger-service/conformance/s2.mjs";
import { tests as s3tests } from "../problems/ledger-service/conformance/s3.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(dir, "fixtures/ref-ledger-persistent/server.mjs");

function start(dataFile) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [server], {
      env: { ...process.env, PORT: "0", DATA_FILE: dataFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const t = setTimeout(() => reject(new Error("start timeout")), 5000);
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/LISTENING (\d+)/);
      if (m) {
        clearTimeout(t);
        resolve({ proc, port: Number(m[1]) });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function runStage(dataFile, suiteTests, nonce) {
  const s = await start(dataFile);
  const base = `http://127.0.0.1:${s.port}`;
  try {
    await waitForReady(base);
    return await runSuite(suiteTests(base, nonce));
  } finally {
    s.proc.kill();
  }
}

test("persistent store across stage restarts does NOT cause false regressions (C1)", async () => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "qc-persist-")), "data.json");

  // S2 scoring run (nonce n1) against an initially-empty persisted store.
  const r2 = await runStage(dataFile, s2tests, "n1");
  assert.equal(r2.filter((x) => !x.pass).length, 0, "S2 failures: " + JSON.stringify(r2.filter((x) => !x.pass)));

  // Restart against the SAME data file; S3 cumulative run (nonce n2) re-runs all
  // S1+S2 tests. Fresh nonce => no collision with persisted n1 accounts.
  const r3 = await runStage(dataFile, s3tests, "n2");
  assert.equal(
    r3.filter((x) => !x.pass).length,
    0,
    "false regressions from persistence: " + JSON.stringify(r3.filter((x) => !x.pass))
  );
});
