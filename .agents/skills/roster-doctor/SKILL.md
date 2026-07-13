---
name: roster-doctor
description: Health check and dev-environment pre-flight for the roster install and its build/test/lint tooling.
when_to_use: "Use before starting work, or when unsure the toolchain actually runs. Trigger: 'is my setup ok', 'roster-doctor'."
version: 1.4.0
domain: pipeline
phase: null
tags: [doctor, health, preflight, environment, readiness]
allowed_tools: [Read, Bash, AskUserQuestion, Skill]
preamble: true
friction_log: true
human_gate: none
pipeline_role:
  triggered_by: "user (/roster-doctor) or roster-run pre-flight before an implementation phase"
  receives: "optional mode arg — full (default) | preflight (dev-env readiness only) | status [<task>] (pipeline timeline)"
  produces: "a health report + READY/NOT-READY verdict; on NOT-READY, an install/configure escalation; or a per-task pipeline timeline in status mode"
---


# Roster Preamble

## Principles

### Completeness

Do not defer tests, documentation, or robustness in the name of speed.
"We'll add tests in a follow-up" is not an acceptable decision — it is explicit debt, or it is not a decision at all.

### Search Before Build

Before creating anything, verify what already exists:
1. Local (current repo, harness, KB)
2. Roster (index.json, roster GitHub)
3. Web (if webfetch available)

### Anti-Sycophancy

Do not validate a direction if you have a grounded objection.
Do not say "good idea" before verifying it is a good idea.
If you spot a problem, say so — clearly, factually, without softening.
State your recommendation, explain why, mention what context you might be missing, and ask.

### User Sovereignty

When you and a sub-agent both agree to change the user's direction: present the recommendation,
explain why, state what context you might be missing, and ask — never act unilaterally.

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

Canonical entry template (append to `skills-meta/friction.jsonl`; set `"skill"` to your
skill's name — extra documented fields like `event` or `mode` are allowed):

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "<skill-name>",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

Schema: `schema/skill-schema.md`.


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
| `/roster-doctor status [<task>]` | Section 4 only → pipeline progress timeline | Human, to see where a task stands |

Read the argument: `preflight` runs Section 2 only; `status` runs Section 4 only; otherwise run the full check (Sections 1 + 2).

## Steps

### 1. Roster install health (skip in preflight mode)

Run and tabulate. Never fail the whole check on one miss — collect all findings.

```bash
# Tooling
printf 'bash: %s\n' "${BASH_VERSION:-unknown}"; [ "${BASH_VERSINFO[0]:-0}" -ge 4 ] && echo "  bash>=4 ✓" || echo "  bash<4 ✗ (installer needs >=4)"
for t in jq git gh curl; do command -v "$t" >/dev/null 2>&1 && echo "$t ✓" || echo "$t ✗"; done
# Release channel the project was installed from (sentinel written by install.sh). Default
# "stable" when no marker exists (installs predating channels, or an explicit stable install).
ch="$(cat .claude/.roster-channel .opencode/.roster-channel .agents/skills/recruit/.roster-channel 2>/dev/null | head -1)"
echo "channel: ${ch:-stable (default — no .roster-channel marker)}"
# Harness manifest valid
[ -f .harness/harness.json ] && { jq empty .harness/harness.json 2>/dev/null && echo "harness.json ✓ valid" || echo "harness.json ✗ invalid JSON"; } || echo "harness.json — absent"
# Pipeline skills present (at least the entry point), per runtime
for p in .claude/commands/roster-run.md .agents/skills/roster-run/SKILL.md; do [ -f "$p" ] && echo "pipeline skills ✓ ($p)"; done
# Projection / source drift (only when the dev checkout is present)
[ -f scripts/sync-harness.sh ] && bash scripts/sync-harness.sh --check 2>&1 | tail -1
[ -f scripts/check-recruiter-sync.js ] && node scripts/check-recruiter-sync.js 2>&1 | tail -1
```

Report each as ✓ / ✗ / absent. `gh` absent is a warning (only `/roster-ship` PR creation needs it), not a failure.

**Review-tool bundle (detailed report; the gate itself lives in Section 2 — F-3).**

```bash
[ -f scripts/review-bundle-install.sh ] && bash scripts/review-bundle-install.sh verify || echo "review bundle: verify script absent or reported problems (see Section 2)"
```

Print every file/sha/`node` line the script emits. FR-157/158: if `git ls-files` shows any of
the manifest's paths tracked while also matching a machine-state pattern (see roster-init.md's
four gitignore globs), print the exact `git rm --cached <path>` remediation — never execute it.

```bash
# Workflow templates health (Phase 1: JSON syntax only — cwr lint requires cwr CLI)
if [ -d workflows/templates ]; then
  for f in workflows/templates/*.cwr.json; do
    [ -f "$f" ] && { jq empty "$f" 2>/dev/null && echo "$(basename $f) ✓" || echo "$(basename $f) ✗ invalid JSON"; }
  done
else
  echo "workflows/templates/: absent ✗ (workflow dispatch unavailable)"
fi
# Workflow instances gitignore check
if ls workflows/*.cwr.json 2>/dev/null | grep -v '/templates/' | grep -q .; then
  grep -q 'workflows/\*\.cwr\.json' .gitignore || \
    echo "⚠ WARN: workflow instances present but not gitignored — add 'workflows/*.cwr.json' to .gitignore (and '!workflows/templates/*.cwr.json' to preserve templates)"
fi
```

**Capability tag check (formal skills).** Flag skills whose description mentions formal tools but whose frontmatter lacks a `capability:` tag — they are invisible to `roster-formal-verify`'s tool resolution:

```bash
for f in skills/pipeline/*.md; do
  # Extract the name: field from frontmatter
  skill_name=$(grep -m1 "^name:" "$f" 2>/dev/null | sed 's/^name: *//')
  # Skip roster-* orchestration skills — they describe the formal route but are NOT backends.
  # The check targets third-party tool skills (e.g. formal-apparatus) that perform verification.
  case "$skill_name" in roster-*) continue ;; esac
  # Case-insensitive: match description lines containing formal tool names
  if grep -qi "^description:.*\(formal\|rocq\|coq\|quint\)" "$f"; then
    if ! grep -q "^capability:" "$f"; then
      echo "⚠ WARN: $f ($skill_name) — description mentions formal tools but lacks 'capability:' field"
    fi
  fi
done
```

Warnings, not failures. Fix: add `capability: formal-rocq` or `capability: formal-quint` to the skill's frontmatter (patch `formal-apparatus` before running `roster-formal-verify` if it was installed untagged).

**Code-intel packs.** List installed code-intel packs and their contract health. In the roster
dev checkout the resolver does this deterministically — prefer it when the script exists:

```bash
[ -f scripts/code-intel-resolve.js ] && node scripts/code-intel-resolve.js doctor
```

When the resolver is absent (a consumer project), run the equivalent greps inline over the
projected runtime skill dirs (`.agents/skills/` first, then `.opencode/skills/`, deduplicated
by directory name — the `.agents` copy wins):

```bash
seen=""
for f in .agents/skills/*/SKILL.md .opencode/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  d=$(basename "$(dirname "$f")")
  case " $seen " in *" $d "*) continue ;; esac; seen="$seen $d"
  grep -q '^capability: code-intel' "$f" || continue
  echo "pack: $d ($f)"
  grep -q '^provides:' "$f" || echo "WARN contract: $d: missing provides"
  grep -q '^entry:' "$f" || echo "WARN contract: $d: missing entry"
  grep -Eq '^provides: (gate|audit-section|init)$' "$f" || ! grep -q '^provides:' "$f" \
    || echo "WARN contract: $d: provides is not one of gate|audit-section|init"
done
# Drift between the two runtime projections (consumers use the .agents copy)
for a in .agents/skills/*/SKILL.md; do
  [ -f "$a" ] || continue
  grep -q '^capability: code-intel' "$a" || continue
  o=".opencode/skills/$(basename "$(dirname "$a")")/SKILL.md"
  [ -f "$o" ] && ! cmp -s "$a" "$o" && echo "WARN drift: $(basename "$(dirname "$a")")"
done
```

The resolver additionally checks each pack's execution trust (execution trust model,
`schema/skill-schema.md`): a pack whose SKILL.md matches neither an extension install
record in `.harness/extensions.json` nor an explicit ack in `.harness/code-intel-ack.json`
is reported as `WARN unacknowledged: <skill> (entry will not execute until acked)` — the
fix is a one-time `node scripts/code-intel-resolve.js ack <skill>` after reviewing the
pack. In the inline fallback, note untrusted packs factually if the ack file is absent.

Report the pack list and every `WARN` line verbatim. Warnings, never failures. Doctor MUST NOT
flag installed packs that are missing from the public registry — private and user-authored
packs are legitimate and are silently tolerated (list them factually, no warning).

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

**Review-tool bundle gate (F-3 — runs here so `/roster-doctor preflight` enforces it; contributes to NOT-READY).**

Only a gate when a bundle-requiring skill is installed (FR-141 — check `requires_review_bundle`
in the installed projection, `.claude/commands/` primary, `.agents/skills/` fallback; a
disagreement between the two is a drift warning, and the stricter (max) requirement wins):

```bash
req=$(grep -h '^requires_review_bundle:' .claude/commands/roster-review.md .agents/skills/roster-review/SKILL.md 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' | sort -Vr | head -1)
if [ -n "$req" ]; then
  if [ -f scripts/review-bundle-install.sh ]; then bash scripts/review-bundle-install.sh verify; ok=$?
  else ok=1
  fi
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 && \
    { git check-ignore -q scripts/review-bundle.manifest.json 2>/dev/null || ! git ls-files --error-unmatch scripts/review-bundle.manifest.json >/dev/null 2>&1; } && \
    echo "bundle not committed"
fi
```

No network call (FR-142 — `verify` only reads local files). On any failure — absent, sha
mismatch, `node` missing, or "bundle not committed" (F-6: gitignored/untracked in a git
consumer repo) — the verdict is **NOT-READY**, reason `stale-install`, with the runbook: "Run:
bash scripts/review-bundle-install.sh install --from-raw <url> (or --from-checkout <dir>), then
/recruit update." (FR-143). A repo with no bundle-requiring skill installed skips this gate
entirely — it is not a general-purpose readiness check.

A sha-mismatch specifically (a modified file, the shared wrapper included, F-5) carries its own
recovery line verbatim from `verify`'s output: re-run install/upgrade with `--force` to reinstall
from source, or manually restore the file to match the sha recorded in the manifest. Report that
line as-is — do not paraphrase it away.

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

**Code-intel pack tools (ADVISORY — runs in preflight too).** Check each installed pack's
`requires_tools` binaries with `command -v` (the resolver's `doctor` subcommand does this when
`scripts/code-intel-resolve.js` exists; otherwise inline):

```bash
seen=""
for f in .agents/skills/*/SKILL.md .opencode/skills/*/SKILL.md; do
  [ -f "$f" ] && grep -q '^capability: code-intel' "$f" || continue
  d=$(basename "$(dirname "$f")")
  case " $seen " in *" $d "*) continue ;; esac; seen="$seen $d"
  tools=$(grep -m1 '^requires_tools:' "$f" | sed 's/^requires_tools:[[:space:]]*\[//; s/\].*//; s/,/ /g')
  for t in $tools; do
    command -v "$t" >/dev/null 2>&1 || echo "WARN pack degraded: tool-missing:$t ($d)"
  done
done
```

These lines are advisory only: they MUST NOT contribute to a NOT-READY verdict. Code-intel
packs are optional additions — a missing pack binary degrades that pack (its gate reports
exit 3 and its audit section is skipped), it never blocks pipeline routing. Report the
`WARN pack degraded: tool-missing:<tool>` lines alongside the gate records, but compute
READY/NOT-READY from the project's own gates exclusively.

### 3. Verdict + escalation

- **READY** — every detected gate is `runnable` (or legitimately absent for the project type).
- **NOT-READY** — any gate is `tool-missing`, `not-configured`, or `fails` — including the
  review-tool bundle gate above (reason `stale-install`, with its runbook) when a
  bundle-requiring skill is installed.

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

### 4. Pipeline status (status mode only)

Render the durable, append-only state ledger each pipeline phase writes (see the preamble's
*Pipeline State* section). This is read-only — it never writes or repairs the ledger.

**Select the ledger(s).** If a task was named, target only its ledger; otherwise list all:

```bash
if [ -n "<task>" ]; then
  [ -f "briefs/<task>-state.json" ] && echo "briefs/<task>-state.json" \
    || echo "no ledger for <task> — it has not started, or predates state tracking (inspect briefs/<task>-* directly)"
else
  ls briefs/*-state.json 2>/dev/null || echo "no pipeline state recorded"
fi
```

For each selected ledger, print the timeline in **recorded (append) order** — the order phases
actually completed, which for a re-run after a NO-GO is e.g. `implement, review, implement,
review` and is itself informative:

Validate each ledger against the **byte-identical schema gate roster-run's Step 3 uses** (not
just a JSON parse), so `status` flags exactly the ledgers a resume would reject — a
valid-JSON-but-malformed ledger (empty `events`, bad `mode`, slug/`current_phase` mismatch,
`current_phase` not in the mode's sequence, or an illegal last-event outcome) is a finding, not a
clean render. The expected slug is the file's own basename (`briefs/<slug>-state.json`):

```bash
# LEDGER_SCHEMA is the SAME predicate as roster-run Step 3 — keep the two copies identical.
# Byte-identity mechanically enforced by `scripts/check-pipeline-install.js`.
LEDGER_SCHEMA='
  {express:["implement","review","ship"],
   fast:["implement","review","qa","ship"],
   full:["question","research","intake","spec","plan","implement","review","qa","ship"]} as $seq
  | {intake:["VALIDATED"],spec:["VALIDATED","SKIPPED","BOUNCED"],
     review:["GO","NO-GO"],qa:["GO","NO-GO"],ship:["COMPLETED","BLOCKED"],
     question:["COMPLETED"],research:["COMPLETED"],plan:["COMPLETED"],implement:["COMPLETED","PARTIAL"]} as $vocab
  | .current_phase as $cp | .mode as $m | (.events[-1]) as $last
  | (.task == $t)
    and ($seq[$m] != null)
    and ($cp|type=="string")
    and (.events|type=="array") and ((.events|length)>0)
    and (all(.events[]; . as $e
          | ($e|type)=="object"
          and ($e.phase|type=="string")
          and (($vocab[$e.phase] // []) | index($e.outcome) != null)
          and (($e|has("reason")|not) or ($e.reason|type=="string"))))
    and ($last.phase == $cp)
    and (($seq[$m]|index($cp)) != null)
'
for f in <selected ledgers>; do
  # The expected slug is the file's own basename (status scans whatever ledgers exist, so it
  # derives `$t` from the filename — unlike roster-run, which knows the task slug from its arg).
  slug="${f#briefs/}"; slug="${slug%-state.json}"
  if jq -e --arg t "$slug" "$LEDGER_SCHEMA" "$f" >/dev/null 2>&1; then
    jq -r '
      "Task: \(.task)  [\(.mode) mode]  — last completed: \(.current_phase)",
      (.events[] | "  \(.phase): \(.outcome)\(if .at then "  (\(.at))" else "" end)\(if .by then "  ·\(.by)" else "" end)")
    ' "$f"
  else
    echo "  ⚠ $f is invalid JSON or fails the ledger schema — corrupt; report it, do not rewrite it. Skipping next-phase computation."
  fi
done
```

Compute the next phase (below) only for ledgers that passed the schema gate.

Then state the **next phase** roster-run would resume into, computed from `current_phase` **in
the recorded `mode`'s sequence** (express: implement→review→ship; fast: implement→review→qa→ship;
full: question→research→intake→spec→plan→implement→review→qa→ship):

- If `current_phase` is the last in its mode's sequence (`ship`), print `next: complete` when
  the latest `ship` outcome is `COMPLETED`; if it is `BLOCKED`, print `next: halted (ship
  BLOCKED)` plus the event's `reason` if present.
- If `current_phase` is an outcome-bearing phase (`intake`/`spec`/`review`/`qa`), note that the
  actual route is verdict-dependent (read the brief's VALIDATED/SKIPPED/BOUNCED or GO/NO-GO) —
  don't assert a positional successor.
- If `current_phase` is `implement` with latest outcome `PARTIAL`, print `next: implement
  (re-run — PARTIAL)`; with `COMPLETED`, print the positional successor as usual.
- Otherwise print the positional successor in that mode's sequence.

A malformed ledger is reported as a finding (above) — never crash, never rewrite it; a corrupt
ledger is something the human resolves.

## Output Contract

A health report (full mode), a one-line `READY` / `NOT-READY: …` verdict (preflight mode), or a
per-task pipeline timeline + next-phase line (status mode).
No source files modified — including the state ledger, which is read-only here.
Tool installation happens only after explicit human approval.

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

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-doctor"`.

## Rules

- Never modify source code — this skill only reports and (with consent) installs tooling.
- Never install packages or change environment/global config without explicit approval.
- Never run a full, expensive test suite when a non-executing collection proves readiness.
- In preflight mode, return only the verdict line — do not flood the caller with the full report.
- A missing `gh` is a warning, never a readiness failure.
