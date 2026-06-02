---
name: roster-doctor
description: Health check + pipeline pre-flight — verifies roster install integrity and that the project's dev environment (build/test/lint/format) is actually runnable before work starts.
version: 1.0.0
domain: pipeline
phase: null
tags: [doctor, health, preflight, environment, readiness]
allowed_tools: [Read, Bash, AskUserQuestion, Skill]
preamble: true
friction_log: true
human_gate: none
pipeline_role:
  triggered_by: "user (/roster-doctor) or roster-run pre-flight before an implementation phase"
  receives: "optional mode arg — full (default) | preflight (dev-env readiness only)"
  produces: "a health report + READY/NOT-READY verdict; on NOT-READY, an install/configure escalation"
---

---
name: roster-preamble
version: 1.4.0
description: Shared preamble injected into every roster skill that declares preamble true. Not a standalone command.
---

# Roster Preamble

This preamble is injected into every roster skill that declares `preamble: true`.
It encodes the non-negotiable principles that govern all skill runs.

---

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
A short-term shortcut is rarely faster than a complete solution.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

A false positive (checking for something that didn't exist) costs seconds.
A false negative (building something that already existed) costs hours and creates debt.

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction:
→ present the recommendation
→ explain why you both think it is better
→ state what context you might be missing
→ ask

Never act unilaterally in this case. The decision belongs to the user.

### Escalation

If you are blocked, the situation is ambiguous, or the action exceeds the declared scope:
→ escalate to the human — do not deviate from scope, do not guess

### Asking Questions

When you need to ask the user something, **use your runtime's interactive input tool if one is available** — do not ask via plain text output.

Known runtime tool names:

| Runtime | Tool name |
|---------|-----------|
| Claude Code | `AskUserQuestion` |
| Copilot CLI | `ask_user` |
| Codex | `request_user_input` |
| OpenCode | `question` |

Rules:
- One question at a time — never bundle multiple questions into one message
- Prefer multiple-choice options over open-ended when the answer space is predictable
- If no interactive tool is available, output a clearly marked plain-text question and wait for the user's reply before proceeding

### Friction Log

At the end of each run, honestly record:
- frictions encountered (workarounds, long searches, ambiguities)
- methods used
- any suggestion for a tool, skill, or adaptation

This is not a performance review. It is cross-run memory.
Format: see `skills-meta/friction.jsonl`.


# Roster Doctor

You verify two things and modify no source code: (1) the roster installation is intact, and
(2) the project's dev environment is actually runnable — build compiles, tests execute,
linter/formatter are installed. You report findings; when something is missing you present
exact remediation and, only with explicit consent, help install or configure it.

## Modes

| Invocation | Runs | Used by |
|---|---|---|
| `/roster-doctor` (full, default) | Section 1 + Section 2 + report | Human, on demand |
| `/roster-doctor preflight` | Section 2 only → `READY` / `NOT-READY` verdict | `roster-run` before an implementation phase |

Read the argument: if it is `preflight`, skip Section 1.

## Steps

### 1. Roster install health (skip in preflight mode)

Run and tabulate. Never fail the whole check on one miss — collect all findings.

```bash
# Tooling
printf 'bash: %s\n' "${BASH_VERSION:-unknown}"; [ "${BASH_VERSINFO[0]:-0}" -ge 4 ] && echo "  bash>=4 ✓" || echo "  bash<4 ✗ (installer needs >=4)"
for t in jq git gh curl; do command -v "$t" >/dev/null 2>&1 && echo "$t ✓" || echo "$t ✗"; done
# Harness manifest valid
[ -f .harness/harness.json ] && { jq empty .harness/harness.json 2>/dev/null && echo "harness.json ✓ valid" || echo "harness.json ✗ invalid JSON"; } || echo "harness.json — absent"
# Pipeline skills present (at least the entry point), per runtime
for p in .claude/commands/roster-run.md .agents/skills/roster-run/SKILL.md; do [ -f "$p" ] && echo "pipeline skills ✓ ($p)"; done
# Projection / source drift (only when the dev checkout is present)
[ -f scripts/sync-harness.sh ] && bash scripts/sync-harness.sh --check 2>&1 | tail -1
[ -f scripts/check-recruiter-sync.js ] && node scripts/check-recruiter-sync.js 2>&1 | tail -1
```

Report each as ✓ / ✗ / absent. `gh` absent is a warning (only `/roster-ship` PR creation needs it), not a failure.

### 2. Project dev-env readiness

**Detect the gate commands.** Prefer explicit harness tunables when present, else infer from
project signals (mirror of the `post-edit-lint` hook's detection):

```bash
# Explicit tunables win, if the manifest declares them
jq -r '.. | objects | (.test_command // .build_command // .lint_command // empty)' .harness/harness.json 2>/dev/null

# Otherwise detect by manifest file → toolchain
ls package.json Cargo.toml dune-project pyproject.toml go.mod 2>/dev/null
```

| Signal | build | test | lint / format | underlying tool(s) |
|---|---|---|---|---|
| `package.json` | `npm run build` if script present | `npm test` if script present | eslint/biome if configured | `node`, `npm` |
| `Cargo.toml` | `cargo build` | `cargo test` | `cargo fmt --check`, `cargo clippy` | `cargo` |
| `dune-project` | `dune build` | `dune test` | `dune fmt` (`.ocamlformat`) | `dune`, `opam` |
| `pyproject.toml` | — | `pytest` | `ruff`/`flake8` if configured | `python`, `pytest`, `ruff` |
| `go.mod` | `go build ./...` | `go test ./...` | `golangci-lint` if `.golangci.yml` | `go` |

**Verify, cheapest signal first — do not run the full suite blindly:**

1. **Tool presence:** `command -v <tool>` for every underlying tool the detected gates need.
   A missing tool is the most common and most actionable failure.
2. **Command resolves:** confirm the build/test/lint command is defined (e.g. the npm script
   exists: `jq -e '.scripts.test' package.json`).
3. **Build runs:** attempt the build command (bounded). A clean baseline build is the
   strongest readiness signal.
4. **Tests collect:** prefer a non-executing collection where available (`pytest --collect-only`,
   `cargo test --no-run`, `go test ./... -run x -count=0`) over a full run — confirms the test
   harness is wired without paying full runtime.

Record, per gate, one of: `runnable` / `tool-missing:<tool>` / `not-configured` / `fails:<short reason>`.

### 3. Verdict + escalation

- **READY** — every detected gate is `runnable` (or legitimately absent for the project type).
- **NOT-READY** — any gate is `tool-missing`, `not-configured`, or `fails`.

On **NOT-READY**, present exactly what is missing with concrete remediation, then ask
(via the interactive question tool) before changing anything:

```
Dev environment is NOT READY to start the pipeline:
  ✗ tests: pytest not installed
  ✗ lint:  ruff configured in pyproject.toml but not installed
Fix options:
  A) Install the missing tools now (I'll run: pip install pytest ruff)
  B) I'll configure it myself — re-run /roster-doctor when done
  C) Proceed anyway (NOT recommended — the pipeline will fail at the quality gate)
```

Only install/configure on explicit approval (option A). Never install global packages or
modify environment config without consent — this is an escalation trigger.

In **preflight** mode, return the single-line verdict to the caller and do not print the full
report: `READY` or `NOT-READY: <comma-separated reasons>`.

## Output Contract

A health report (full mode) or a one-line `READY` / `NOT-READY: …` verdict (preflight mode).
No source files modified. Tool installation happens only after explicit human approval.

## When to Go Back

| Condition | Action |
|---|---|
| `NOT-READY` and user declines to fix | Stop — do not proceed into the pipeline; report blocked |
| Roster install health shows projection drift | Point the user at `./scripts/sync-harness.sh`; do not auto-sync from here |
| Detected gate commands are ambiguous (multiple toolchains) | Ask the user which is authoritative before verdict |

## What Next

**From full mode:** report only — the human decides next action.
**From preflight (`READY`):** `roster-run` continues routing.
**From preflight (`NOT-READY`):** `roster-run` halts at the gate until resolved.

> 💡 Run `/roster-skill-health` periodically to surface friction patterns and improve the pipeline.

## Friction Log

```jsonl
{
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never modify source code — this skill only reports and (with consent) installs tooling.
- Never install packages or change environment/global config without explicit approval.
- Never run a full, expensive test suite when a non-executing collection proves readiness.
- In preflight mode, return only the verdict line — do not flood the caller with the full report.
- A missing `gh` is a warning, never a readiness failure.
