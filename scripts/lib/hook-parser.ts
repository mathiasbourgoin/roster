/**
 * Shared hook-file parsing utilities used by both the linter and the executor.
 */

import yaml from "js-yaml";

export interface HookFrontmatter {
  name: string;
  version: string;
  event: "pre" | "post";
  skill: string;
  on_error?: "stop" | "warn" | "skip" | "ignore";
}

export type OnError = "stop" | "warn" | "skip" | "ignore";

export interface BaseStep {
  on_error?: OnError;
}

export interface RunStep extends BaseStep {
  run: string;
}
export interface PromptStep extends BaseStep {
  prompt: string;
  agent: string;
}
export interface TestStep extends BaseStep {
  test: string;
  on_true?: Step[];
  on_false?: Step[];
}
export interface LabelStep {
  label: string;
}
export interface GotoStep {
  goto: string;
}
export interface TimeoutStep {
  timeout: number | string; // ms
}
export interface LogStep {
  log: string;
}
export interface RetryStep {
  retry: number;
  backoff?: number; // ms
}
export interface LoopStep extends BaseStep {
  loop: { steps: Step[]; until?: string };
}
export interface ParallelStep extends BaseStep {
  parallel: { agents: string[]; mode?: "first-wins" | "collect-all" };
}
export interface IncludeStep {
  include: string;
}
export interface OutputStep {
  output: string;
}

export type Step =
  | RunStep
  | PromptStep
  | TestStep
  | LabelStep
  | GotoStep
  | TimeoutStep
  | LogStep
  | RetryStep
  | LoopStep
  | ParallelStep
  | IncludeStep
  | OutputStep;

export interface ParsedHook {
  frontmatter: HookFrontmatter;
  steps: Step[];
}

export function parseFrontmatter(content: string): { raw: string; body: string } | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  return { raw: m[0], body: m[1] };
}

export function fmField(fm: string, key: string): string | null {
  const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

export function extractStepsBlock(content: string): string | null {
  const withoutFm = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const fenceRe = /^```ya?ml\r?\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(withoutFm)) !== null) {
    const block = match[1];
    if (/^\s*steps\s*:/m.test(block)) return block;
  }
  return null;
}

export function parseHookFile(content: string): ParsedHook {
  const fm = parseFrontmatter(content);
  if (!fm) throw new Error("Hook file missing frontmatter");

  const name = fmField(fm.body, "name");
  const version = fmField(fm.body, "version");
  const event = fmField(fm.body, "event") as "pre" | "post" | null;
  const skill = fmField(fm.body, "skill");
  const onError = fmField(fm.body, "on_error") as OnError | null;

  if (!name || !version || !event || !skill)
    throw new Error(`Hook frontmatter missing required field(s): name=${name} version=${version} event=${event} skill=${skill}`);

  const stepsBlock = extractStepsBlock(content);
  if (!stepsBlock) throw new Error("Hook file missing ```yaml steps: block");

  const parsed = yaml.load(stepsBlock) as { steps: Step[] };
  if (!parsed?.steps || !Array.isArray(parsed.steps))
    throw new Error("steps: must be a non-empty array");

  // Validate on_error against the values the executor actually implements. Reject malformed
  // hooks at parse time (fail-closed) so an invalid value never silently passes a failing
  // step at runtime — the linter checks this too, but run-hook must not trust that it ran.
  const VALID_ON_ERROR = new Set(["stop", "warn", "skip", "ignore"]);
  if (onError && !VALID_ON_ERROR.has(onError))
    throw new Error(`Invalid frontmatter on_error "${onError}" — allowed: stop|warn|skip|ignore`);
  parsed.steps.forEach((s, i) => {
    const se = (s as unknown as Record<string, unknown>)["on_error"];
    if (se != null && !VALID_ON_ERROR.has(String(se)))
      throw new Error(`Invalid on_error "${String(se)}" in step ${i + 1} — allowed: stop|warn|skip|ignore`);
  });

  return {
    frontmatter: { name, version, event, skill, ...(onError ? { on_error: onError } : {}) },
    steps: parsed.steps,
  };
}

export function stepOperator(step: Step): string {
  return Object.keys(step).find((k) =>
    ["run","prompt","test","label","goto","timeout","log","retry","loop","parallel","include","output"].includes(k)
  ) ?? "unknown";
}
