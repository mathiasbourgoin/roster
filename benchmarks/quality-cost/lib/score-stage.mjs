// Reusable per-stage scorer for LIVE arm runs (Phase B).
// Usage: node score-stage.mjs <problemDir> <stage> <repoDir>
//
// Starts the produced project via `start.sh` (the run contract): start.sh must
// launch the service in the FOREGROUND on $PORT and print `LISTENING <port>`.
// Then runs that stage's cumulative black-box conformance suite + (S4) the
// invariant, over HTTP only. Prints a JSON stage-result to stdout.
//
// On start failure, every test in the suite is recorded as failed (so a later
// stage that breaks the server surfaces as cross-stage regression downstream).
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { runSuite } from "./conformance-runner.mjs";
import { waitForReady } from "./http.mjs";

const [, , problemDir, stage, repoDir] = process.argv;
if (!problemDir || !stage || !repoDir) {
  console.error("usage: node score-stage.mjs <problemDir> <stage> <repoDir>");
  process.exit(2);
}

const problem = JSON.parse(fs.readFileSync(path.join(problemDir, "problem.json"), "utf8"));
const stageDef = problem.stages.find((s) => s.id === stage);
if (!stageDef) {
  console.error("unknown stage " + stage);
  process.exit(2);
}
const confPath = path.join(problemDir, stageDef.conformance);

// Per-run nonce: namespaces all account ids so that a later stage's cumulative
// suite, run against a project that persists state, never collides with a prior
// run (review C1). Test names are independent of the nonce.
const nonce = "r" + Math.floor(Math.random() * 1e9).toString(36);
const START_TIMEOUT_MS = Number(process.env.BENCH_START_TIMEOUT_MS || 20000);

function startProject(dir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(dir, "start.sh"))) return reject(new Error("no start.sh in repo"));
    const proc = spawn("bash", ["start.sh"], {
      cwd: dir,
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`start timeout (no LISTENING <port> line in ${START_TIMEOUT_MS}ms)`));
    }, START_TIMEOUT_MS);
    const onData = (d) => {
      buf += d.toString();
      // Require a non-zero assigned port; a literal "LISTENING 0" (PORT echoed
      // back) is a contract violation, not a real bind (review M1).
      const m = buf.match(/LISTENING (\d+)/);
      if (m && m[1] !== "0") {
        clearTimeout(timer);
        resolve({ proc, port: Number(m[1]) });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("start.sh exited early (code " + code + ") — server must run in foreground"));
    });
  });
}

const out = { stage, started: false, results: [], invariant: null, error: null };
let started = null;
try {
  started = await startProject(repoDir);
  out.started = true;
  const base = `http://127.0.0.1:${started.port}`;
  await waitForReady(base);
  const confMod = await import(pathToFileURL(confPath).href);
  out.results = await runSuite(confMod.tests(base, nonce));
  if (stageDef.invariant) {
    const invMod = await import(pathToFileURL(path.join(problemDir, stageDef.invariant)).href);
    out.invariant = await invMod.check(base, nonce);
  }
} catch (e) {
  out.error = String((e && e.message) || e);
  // Mark the whole cumulative suite as failed so downstream regression is visible.
  try {
    const confMod = await import(pathToFileURL(confPath).href);
    out.results = confMod
      .tests("http://127.0.0.1:0", nonce)
      .map((t) => ({ name: t.name, pass: false, error: "server did not start: " + out.error }));
    if (stageDef.invariant) out.invariant = { ok: false, violations: ["server did not start"] };
  } catch {
    /* ignore */
  }
} finally {
  if (started && started.proc) started.proc.kill();
}
console.log(JSON.stringify(out));
process.exit(0);
