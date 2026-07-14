/**
 * Helpers for check-hook-structure.ts, extracted to keep the linter under the
 * 500-line file limit (code-quality rule).
 *
 * - collectStepsWithContext: flatten nested steps while tracking whether each
 *   step sits inside a `loop:` body (needed for the break_if/continue_if
 *   outside-loop warning, spec US-4 Sc.4C).
 * - skillInstalled: EC-7 resolution — a hook's target skill counts as installed
 *   if `.harness/skills/<skill>.md` exists OR the skill is registered in
 *   `.harness/harness.json` under `layers.skills` (pipeline skills are
 *   registered there rather than shipped as standalone .md files).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface ContextedStep {
  step: unknown;
  inLoop: boolean;
}

/**
 * Recursively collect all steps (including nested on_true/on_false/steps and
 * loop bodies), preserving traversal order. Steps inside a `loop:` body — at
 * any depth below it — carry `inLoop: true`.
 */
export function collectStepsWithContext(steps: unknown[], inLoop = false): ContextedStep[] {
  const result: ContextedStep[] = [];
  for (const step of steps) {
    result.push({ step, inLoop });
    if (step && typeof step === "object") {
      const s = step as Record<string, unknown>;
      for (const nested of ["on_true", "on_false", "steps"]) {
        if (Array.isArray(s[nested])) {
          result.push(...collectStepsWithContext(s[nested] as unknown[], inLoop));
        }
      }
      if (s["loop"] && typeof s["loop"] === "object") {
        const loopObj = s["loop"] as Record<string, unknown>;
        if (Array.isArray(loopObj["steps"])) {
          result.push(...collectStepsWithContext(loopObj["steps"] as unknown[], true));
        }
      }
    }
  }
  return result;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Skill names registered in harness.json layers.skills — cached per harnessDir. */
const registryCache = new Map<string, Set<string>>();

async function registeredSkills(harnessDir: string): Promise<Set<string>> {
  const cached = registryCache.get(harnessDir);
  if (cached) return cached;

  const names = new Set<string>();
  try {
    const raw = await fs.readFile(path.join(harnessDir, "harness.json"), "utf-8");
    const parsed = JSON.parse(raw) as { layers?: { skills?: unknown[] } };
    for (const entry of parsed.layers?.skills ?? []) {
      if (typeof entry === "string") names.add(entry);
      else if (entry && typeof entry === "object") {
        const n = (entry as Record<string, unknown>)["name"];
        if (typeof n === "string") names.add(n);
      }
    }
  } catch {
    // absent or malformed harness.json → empty registry (file check still applies)
  }
  registryCache.set(harnessDir, names);
  return names;
}

/**
 * EC-7: is the hook's target skill installed in the harness?
 * True if `.harness/skills/<skill>.md` exists or the skill is registered in
 * harness.json layers.skills.
 */
export async function skillInstalled(harnessDir: string, skill: string): Promise<boolean> {
  if (await pathExists(path.join(harnessDir, "skills", `${skill}.md`))) return true;
  return (await registeredSkills(harnessDir)).has(skill);
}
