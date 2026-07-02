/**
 * roster hook executor — runs the "real" steps of a skill hook file.
 *
 * Enforces: run:, test:, timeout:, retry:, log:, label:, goto:, on_error:
 * Returns as pending_llm_steps: prompt:, loop:, parallel:
 *
 * CLI usage:
 *   node dist/scripts/run-hook.js <pre|post> <skill-name> [hook-dir]
 *
 * Exit codes:
 *   0  pass      — all real steps passed, no pending LLM steps
 *   1  abort     — pre-hook hard failure (on_error: stop)
 *   2  warn      — post-hook soft failure (on_error: warn)
 *   3  pending   — pass but pending_llm_steps non-empty (LLM must handle them)
 *   4  skip      — hook file absent or re-entrance guard active
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseHookFile, stepOperator, Step, OnError } from "./lib/hook-parser";

// ─── Public types ─────────────────────────────────────────────────────────────

export type Outcome = "pass" | "abort" | "warn" | "skip" | "pending";

export interface HookResult {
  skill: string;
  event: "pre" | "post";
  outcome: Outcome;
  steps_run: number;
  pending_llm_steps: Step[];
  abort_reason: string | null;
  warn_reasons: string[];
  skip_reason: string | null;
  log: string[];
}

export interface RunHookOptions {
  /** Inline hook file content (for testing). Overrides hookDir lookup. */
  content?: string;
  event: "pre" | "post";
  skill: string;
  /** Directory containing <skill>/<event>.md. Defaults to .harness/hooks/skills */
  hookDir?: string;
  /**
   * Directory containing friction.jsonl. Defaults to cwd-relative `skills-meta/`.
   * If the directory does not exist, friction logging is skipped with a stderr
   * warning — the directory is never created by the hook runner.
   */
  metaDir?: string;
}

/**
 * Friction record appended to skills-meta/friction.jsonl after each executed hook.
 * Canonical 8 keys (check-friction-shape compliant) + hook extras (spec US-6/AC-16).
 * `outcome` is the runner's real state machine: pass|warn|abort|pending — `skip`
 * is NEVER logged (nothing executed; re-entrant runs would double-count).
 * `loop_iterations` is reserved for native loop execution and stays null in v1;
 * the `loop-N` outcome form is likewise reserved (loops are LLM-deferred today).
 */
export interface HookFrictionRecord {
  date: string;
  skill: string;
  task: string | null;
  frictions: string[];
  methods: string[];
  suggestion_type: null;
  suggestion: null;
  effort_estimate: null;
  hook: "pre" | "post";
  outcome: Exclude<Outcome, "skip">;
  duration_ms: number;
  loop_iterations: null;
}

// ─── Shell execution ──────────────────────────────────────────────────────────

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function execShell(cmd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    // Do not leak the re-entrance guard into shell children. A `run:` step is a shell
    // command, not a nested skill dispatch — if it (transitively) invokes the hook runner
    // (e.g. `npm test` running run-hook.test.js), that nested run must execute normally,
    // not short-circuit on ROSTER_HOOK_RUNNING.
    const childEnv = { ...process.env };
    delete childEnv.ROSTER_HOOK_RUNNING;

    execFile("sh", ["-c", cmd], { signal: ac.signal, timeout: timeoutMs, env: childEnv }, (err, stdout, stderr) => {
      clearTimeout(timer);
      if (err) {
        const timedOut = (err as NodeJS.ErrnoException).code === "ABORT_ERR" || err.killed === true;
        resolve({ exitCode: typeof err.code === "number" ? err.code : 1, stdout: stdout ?? "", stderr: stderr ?? "", timedOut });
      } else {
        resolve({ exitCode: 0, stdout: stdout ?? "", stderr: stderr ?? "", timedOut: false });
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Executor ─────────────────────────────────────────────────────────────────

class HookExecutor {
  private steps: Step[];
  private event: "pre" | "post";
  private skill: string;
  private currentTimeoutMs = 30_000; // default 30s per run: step
  private log: string[] = [];
  private stepsRun = 0;
  private pendingLlm: Step[] = [];
  private warnTriggered = false;
  private warnReasons: string[] = [];
  private abortReason: string | null = null;
  private hookOnError?: OnError;

  constructor(steps: Step[], event: "pre" | "post", skill: string, hookOnError?: OnError) {
    this.steps = steps;
    this.event = event;
    this.skill = skill;
    this.hookOnError = hookOnError;
  }

  private emit(msg: string): void {
    this.log.push(msg);
    process.stderr.write(msg + "\n");
  }

  private defaultOnError(): OnError {
    // Hook-level frontmatter on_error is the default for every step; fall back to the
    // event default (pre→stop, post→warn) only when the hook declares none.
    return this.hookOnError ?? (this.event === "pre" ? "stop" : "warn");
  }

  private resolveOnError(step: Step): OnError {
    const s = step as unknown as Record<string, unknown>;
    return (s["on_error"] as OnError | undefined) ?? this.defaultOnError();
  }

  /** Run a single shell command. Returns ExecResult. */
  private async shell(cmd: string): Promise<ExecResult> {
    return execShell(cmd, this.currentTimeoutMs);
  }

  /** Execute a flat list of steps. Returns null=continue, "abort"=hard stop, "warn"=soft stop. */
  private async execSteps(steps: Step[]): Promise<null | "abort" | "warn"> {
    // Build label index for goto
    const labelIndex = new Map<string, number>();
    steps.forEach((s, i) => {
      if (stepOperator(s) === "label") labelIndex.set((s as { label: string }).label, i);
    });

    let i = 0;
    let lastRunStep: { cmd: string; stepIndex: number } | null = null;
    let jumpCount = 0;
    const jumpCap = Math.max(500, 10 * steps.length);

    while (i < steps.length) {
      const step = steps[i];
      const op = stepOperator(step);
      this.stepsRun++;

      switch (op) {
        // ── log: ────────────────────────────────────────────────────────────
        case "log": {
          this.emit(`[log] ${(step as { log: string }).log}`);
          i++;
          break;
        }

        // ── label: ──────────────────────────────────────────────────────────
        case "label": {
          i++;
          break;
        }

        // ── goto: ───────────────────────────────────────────────────────────
        case "goto": {
          const target = (step as { goto: string }).goto;
          const targetIdx = labelIndex.get(target);
          if (targetIdx !== undefined) {
            if (targetIdx < i) {
              jumpCount++;
              if (jumpCount > jumpCap) {
                this.emit(`[error] goto loop cap exceeded (${jumpCount} backward jumps) — aborting`);
                this.abortReason = `goto loop cap exceeded (${jumpCount} backward jumps)`;
                return "abort";
              }
            }
            this.emit(`[goto] → label:${target} (step ${targetIdx + 1})`);
            i = targetIdx;
          } else {
            // pipeline-level goto — return as pending
            this.emit(`[goto] → pipeline step "${target}" (LLM-interpreted)`);
            this.pendingLlm.push(step);
            i++;
          }
          break;
        }

        // ── timeout: ────────────────────────────────────────────────────────
        case "timeout": {
          const raw = (step as { timeout: number | string }).timeout;
          this.currentTimeoutMs = typeof raw === "number" ? raw : parseInt(String(raw), 10);          this.emit(`[timeout] current shell timeout set to ${this.currentTimeoutMs}ms`);
          i++;
          break;
        }

        // ── run: ────────────────────────────────────────────────────────────
        case "run": {
          const cmd = (step as { run: string }).run;
          this.emit(`[run] ${cmd}`);
          const res = await this.shell(cmd);

          const failed = res.timedOut || res.exitCode !== 0;
          lastRunStep = { cmd, stepIndex: i };

          if (failed) {
            const reason = res.timedOut
              ? `step ${i + 1}: "${cmd}" timed out after ${this.currentTimeoutMs}ms`
              : `step ${i + 1}: "${cmd}" exited with code ${res.exitCode}`;
            this.emit(`[run] ✗ ${res.timedOut ? "timed out" : `exit ${res.exitCode}`}${res.stderr ? `: ${res.stderr.trim()}` : ""}`);

            // Peek ahead: if next step is retry:, defer error handling to retry:
            const nextStep = steps[i + 1];
            if (nextStep && stepOperator(nextStep) === "retry") {
              i++;
              break; // let retry: handle the failure
            }

            const onErr = this.resolveOnError(step);
            const outcome = await this.handleError(reason, onErr);
            if (outcome) return outcome;
          } else {
            this.emit(`[run] ✓ exit 0`);
          }
          i++;
          break;
        }

        // ── retry: ──────────────────────────────────────────────────────────
        case "retry": {
          const maxRetries = (step as { retry: number }).retry;
          const backoff = (step as { retry: number; backoff?: number }).backoff ?? 0;

          if (!lastRunStep) {
            this.emit(`[retry] no previous run: step to retry — skipping`);
            i++;
            break;
          }

          const { cmd, stepIndex } = lastRunStep;
          let succeeded = false;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (backoff > 0) await sleep(backoff);
            this.emit(`[retry] attempt ${attempt}/${maxRetries}: ${cmd}`);
            const res = await this.shell(cmd);
            if (res.exitCode === 0 && !res.timedOut) {
              this.emit(`[retry] ✓ succeeded on attempt ${attempt}`);
              succeeded = true;
              break;
            }
            this.emit(`[retry] ✗ attempt ${attempt} failed (exit ${res.exitCode})`);
          }

          if (!succeeded) {
            const onErr = this.resolveOnError(steps[stepIndex]);
            const outcome = await this.handleError(
              `step ${stepIndex + 1}: "${cmd}" failed after ${maxRetries} retries`,
              onErr
            );
            if (outcome) return outcome;
          }

          lastRunStep = null;
          i++;
          break;
        }

        // ── test: ───────────────────────────────────────────────────────────
        case "test": {
          const testStep = step as {
            test: string;
            on_true?: Step[];
            on_false?: Step[];
          };
          this.emit(`[test] ${testStep.test}`);
          const res = await this.shell(testStep.test);
          const branch = res.exitCode === 0 ? "on_true" : "on_false";
          const branchSteps = testStep[branch] ?? [];
          this.emit(`[test] → ${branch} (${branchSteps.length} step(s))`);
          if (branchSteps.length > 0) {
            const outcome = await this.execSteps(branchSteps);
            if (outcome) return outcome;
          }
          i++;
          break;
        }

        // ── prompt: / loop: / parallel: → pending LLM ─────────────────────
        case "prompt":
        case "loop":
        case "parallel": {
          this.emit(`[${op}] → deferred to LLM (pending_llm_steps)`);
          this.pendingLlm.push(step);
          i++;
          break;
        }

        // ── include: / output: → no-op (already inlined or metadata) ───────
        case "include":
        case "output": {
          i++;
          break;
        }

        default: {
          this.emit(`[unknown] step operator "${op}" — skipping`);
          i++;
        }
      }
    }

    return null;
  }

  private async handleError(reason: string, onError: OnError): Promise<"abort" | "warn" | null> {
    switch (onError) {
      case "stop":
        this.emit(`[error] abort: ${reason}`);
        this.abortReason = reason;
        return "abort";
      case "warn":
        this.emit(`[error] warn: ${reason}`);
        this.warnTriggered = true;
        this.warnReasons.push(reason);
        return null;
      case "skip":
        this.emit(`[error] skip: ${reason}`);
        return null;
      case "ignore":
        return null;
      default:
        // Unknown on_error (e.g. a stale/invalid value the parser somehow let through):
        // fail CLOSED — never silently pass a failing step.
        this.emit(`[error] abort: ${reason} (unknown on_error "${String(onError)}" — failing closed)`);
        this.abortReason = `${reason} (unknown on_error "${String(onError)}" — failing closed)`;
        return "abort";
    }
  }

  async run(): Promise<HookResult> {
    const outcome = await this.execSteps(this.steps);

    let finalOutcome: Outcome;
    if (outcome === "abort") {
      finalOutcome = "abort";
    } else if (this.warnTriggered) {
      finalOutcome = "warn";
    } else if (this.pendingLlm.length > 0) {
      finalOutcome = "pending";
    } else {
      finalOutcome = "pass";
    }

    return {
      skill: this.skill,
      event: this.event,
      outcome: finalOutcome,
      steps_run: this.stepsRun,
      pending_llm_steps: this.pendingLlm,
      abort_reason: outcome === "abort" ? this.abortReason : null,
      warn_reasons: [...this.warnReasons],
      skip_reason: null,
      log: this.log,
    };
  }
}

// ─── Friction logging (spec US-6 / AC-16) ─────────────────────────────────────
//
// scripts/run-hook.ts is the SINGLE programmatic writer of skills-meta/friction.jsonl.
// roster-skill-health is a read-only consumer. Every record is exactly one line
// (single appendFile call, newline-stripped reason strings) so concurrent appends
// cannot interleave partial records.

/** Collapse all newlines/CRs to single spaces — single-line JSONL invariant (R6). */
function stripNewlines(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

export function buildFrictionRecord(result: HookResult, durationMs: number): HookFrictionRecord {
  const frictions =
    result.outcome === "abort" && result.abort_reason !== null
      ? [stripNewlines(result.abort_reason)]
      : result.outcome === "warn"
        ? result.warn_reasons.map(stripNewlines)
        : [];

  return {
    date: new Date().toISOString().slice(0, 10),
    skill: result.skill,
    task: process.env.TASK ?? null,
    frictions,
    methods: [],
    suggestion_type: null,
    suggestion: null,
    effort_estimate: null,
    hook: result.event,
    outcome: result.outcome as Exclude<Outcome, "skip">,
    duration_ms: durationMs,
    loop_iterations: null,
  };
}

/**
 * Append one friction record to <metaDir>/friction.jsonl. Skips (stderr note)
 * when metaDir is absent — installed projects may not have skills-meta/; the
 * runner never creates it. One appendFile call = one atomic single-line record.
 */
async function appendFriction(record: HookFrictionRecord, metaDir: string): Promise<void> {
  try {
    await fs.access(metaDir);
  } catch {
    process.stderr.write(`[friction] skills-meta dir absent (${metaDir}) — friction logging skipped\n`);
    return;
  }
  await fs.appendFile(path.join(metaDir, "friction.jsonl"), JSON.stringify(record) + "\n", "utf-8");
}

// ─── Public entry point ───────────────────────────────────────────────────────

const SKIP_RESULT = (skill: string, event: "pre" | "post", reason: string): HookResult => ({
  skill,
  event,
  outcome: "skip",
  steps_run: 0,
  pending_llm_steps: [],
  abort_reason: null,
  warn_reasons: [],
  skip_reason: reason,
  log: [],
});

export async function runHook(opts: RunHookOptions): Promise<HookResult> {
  const { event, skill } = opts;

  // Re-entrance guard
  if (process.env.ROSTER_HOOK_RUNNING === "1") {
    return SKIP_RESULT(skill, event, "re-entrance guard: ROSTER_HOOK_RUNNING is set");
  }

  let content: string;

  if (opts.content !== undefined) {
    content = opts.content;
  } else {
    const hookDir =
      opts.hookDir ?? path.resolve(process.cwd(), ".harness/hooks/skills");
    const inlined = path.join(hookDir, skill, `${event}.inlined.md`);
    const normal = path.join(hookDir, skill, `${event}.md`);

    try {
      content = await fs.readFile(inlined, "utf-8");
    } catch {
      try {
        content = await fs.readFile(normal, "utf-8");
      } catch {
        return SKIP_RESULT(skill, event, `hook file not found: ${normal}`);
      }
    }
  }

  const parsed = parseHookFile(content);
  const executor = new HookExecutor(parsed.steps, event, skill, parsed.frontmatter.on_error);

  process.env.ROSTER_HOOK_RUNNING = "1";
  let result: HookResult;
  const startedMs = Date.now();
  try {
    result = await executor.run();
  } finally {
    delete process.env.ROSTER_HOOK_RUNNING;
  }
  const durationMs = Date.now() - startedMs;

  // Friction append is AWAITED here, before main()'s process.exit — a
  // fire-and-forget write would truncate abort records (R5). Fail-open: a
  // logging failure must never fail the hook itself (stderr warning only).
  // `skip` outcomes never reach this point — nothing executed, nothing logged.
  const metaDir = opts.metaDir ?? path.resolve(process.cwd(), "skills-meta");
  try {
    await appendFriction(buildFrictionRecord(result, durationMs), metaDir);
  } catch (err) {
    process.stderr.write(`[friction] failed to append friction record: ${String(err)}\n`);
  }

  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , event, skill, hookDir] = process.argv;

  if (!event || !skill || (event !== "pre" && event !== "post")) {
    console.error("Usage: run-hook <pre|post> <skill-name> [hook-dir]");
    process.exit(1);
  }

  const result = await runHook({
    event: event as "pre" | "post",
    skill,
    ...(hookDir ? { hookDir } : {}),
  });

  console.log(JSON.stringify(result, null, 2));

  switch (result.outcome) {
    case "pass":    process.exit(0); break;
    case "abort":   process.exit(1); break;
    case "warn":    process.exit(2); break;
    case "pending": process.exit(3); break;
    case "skip":    process.exit(4); break;
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
