---
name: roster-review
description: Fix-first review with conditional specialists — produces a structured GO/NO-GO verdict.
version: 1.5.1
domain: pipeline
phase: review
preamble: true
friction_log: true
allowed_tools: [Read, Edit, Bash, Agent, AskUserQuestion]
human_gate: after
tunables:
  auto_fix_threshold_lines: 20
  always_run_spec_compliance: true
artifacts:
  reads:
    - briefs/<task>-impl.md
    - briefs/<task>-reviewer.md
    - git diff (current)
  writes:
    - briefs/<task>-review.json
pipeline_role:
  triggered_by: /roster-implement completed
  receives: briefs/<task>-impl.md + current diff
  produces: briefs/<task>-review.json GO or NO-GO
---

---
name: roster-preamble
version: 1.6.0
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

### Pipeline State

If your skill's `phase:` frontmatter field is **non-null** (i.e. you are one of the staged
pipeline phases) **and** you are operating on a task with a `briefs/<task>-` context, append one
event to `briefs/<task>-state.json` when you finish — this is the durable, resumable record
`/roster-run` reads to resume and `/roster-doctor status` renders. Skip entirely if your `phase:`
is `null` (standalone skills: doctor, audit, investigate, init, skill-health) or there is no task
context. Create the file if absent; preserve every prior `events` entry:

```json
{
  "task": "<slug>",
  "mode": "express|fast|full",
  "current_phase": "implement",
  "events": [
    { "phase": "implement", "outcome": "COMPLETED", "at": "<ISO-8601 or omit>", "by": "roster-implement" }
  ]
}
```

Rules for writing your event:

- **`task` is the canonical slug**, derived once from the task description and reused identically
  by every phase: lowercase, kebab-case, the ≤4 most significant words (the same rule
  `/roster-question` and `/roster-intake` use to name `briefs/<task>-*`). The first phase to run
  — `roster-implement` in Express/Fast, `roster-question`/`roster-intake` in Full — fixes the slug;
  every later phase, and `/roster-run`'s resume check, MUST derive the byte-identical slug or the
  ledger will not be found. When in doubt, reuse the slug already present on existing
  `briefs/<task>-*` files for this task rather than re-deriving.
- **`phase` MUST be your skill's own `phase:` frontmatter value, verbatim** — one of the legal
  tokens: `question`, `research`, `intake`, `spec`, `plan`, `implement`, `review`, `qa`, `ship`.
  Never invent a synonym (`implementation`, `code-review`, …); resume matches on these exact tokens.
- **`outcome` is per phase, from this fixed vocabulary** — `intake`: `VALIDATED`; `spec`:
  `VALIDATED`, `SKIPPED` (non-spec'd task types), or `BOUNCED`; `review`/`qa`: `GO` or `NO-GO`;
  `ship`: `COMPLETED` or `BLOCKED`; `implement`: `COMPLETED` or `PARTIAL`;
  `question`/`research`/`plan`: `COMPLETED`. Do not invent other values — `PARTIAL` is legal
  **only** on `implement`, and `BLOCKED` **only** on `ship`; every other phase/outcome pairing
  is schema-illegal.
- **Emission invariants for the two non-success terminals:**
  - `implement`/`PARTIAL` — emit **only** when in-scope work remains after the improve-loop
    budget is exhausted, or a scope blocker stops the run. Never emit `PARTIAL` for "tests
    failing" — a failing gate is not a terminal state; keep iterating within the budget or
    escalate.
  - `ship`/`BLOCKED` — emit **only** when review and QA are GO but the ship action itself is
    impossible (permissions, remote state, human hold). A NO-GO gate is not `BLOCKED`.
  - Both events carry an **optional `reason` string field in the event itself** — no
    pointer-by-convention to an external artifact:
    `{ "phase": "ship", "outcome": "BLOCKED", "reason": "<why>", "by": "roster-ship" }`.
  - **Artifact writes happen BEFORE the event append.** Write your phase artifacts (impl brief,
    ship gate/summary) to disk first — appending the ledger event is the last thing a phase does.
- **Resume semantics** (read by `/roster-run` Step 1.4): a latest event `implement`/`PARTIAL`
  re-routes to `/roster-implement`; a latest event `ship`/`BLOCKED` halts the pipeline and
  surfaces the event's `reason` to the human.
- **Append-only audit trail.** Always push a *new* event — never rewrite or delete a prior one.
  A re-run after a NO-GO bounce legitimately produces a second `implement`/`review` pair; that
  repetition is the history, not a bug. Set `current_phase` to your phase (the latest completed).
- `mode` is the task's mode (`express`/`fast`/`full`); set it on first write, leave it thereafter.
- Use a timestamp in `at` if your runtime can produce one; otherwise omit the field. `by` is your
  skill name (or `human-gate` for a gate decision).


# Roster Review

You conduct a structured, fix-first review. Mechanical corrections are applied without asking. Ambiguities are grouped into one question. You produce a structured JSON verdict.

**Golden rule:** every claim must cite the file and line. Never "probably" or "likely".

## Mode Awareness

**Read the mode from `briefs/<task>-impl.md`** (field `mode: express|fast|full`). If absent, infer from context.

| Mode | Review scope | Specialist invocation | Escalation check |
|---|---|---|---|
| **Express** | Correctness + security only. Skip spec/KB compliance — no spec impact expected. | `reviewer` agent only. Skip `spec-compliance`, `code-quality-auditor`, `architect` unless diff > 5 files. | Mandatory — see below |
| **Fast** | Full review. Spec/KB compliance only if KB exists. | `reviewer` + conditionals per normal rules. | Mandatory — see below |
| **Full** | Full review. All specialists per normal rules. | All conditionals apply. | N/A |

### Mode Escalation Check (Express and Fast only)

After reading the diff, check for signs the task scope exceeded its mode:

| Signal | Escalation |
|---|---|
| New public API, interface, or exported function | Recommend upgrading to Full (spec needed) |
| Behaviour change affecting callers beyond the reported fix | Recommend upgrading to Full |
| Design decision made implicitly in the code (no brief, no spec) | Recommend upgrading to Fast if Express, or Full if Fast |
| Spec or KB update is clearly needed but was not done | Flag as `escalation_needed: true` in verdict |

If escalation is needed: set `escalation_needed: true` and `escalation_reason`. **Do not block GO** — it is informational; the human decides whether to loop back.

## Input Contract

Read in order:
1. `briefs/<task>-reviewer.md` — context and points of attention
2. `briefs/<task>-impl.md` — modified files and decisions made
3. `git diff main...HEAD` — the complete diff

If `briefs/<task>-impl.md` is absent: ⛔ stop — review cannot start without the implementation scope.

`briefs/<task>-reviewer.md` is absent by design in Express/Fast mode. Do not block — proceed from the impl brief and diff alone.

## Steps

### 1. Read the diff

```bash
git diff main...HEAD
git log main...HEAD --oneline
```

Read each modified file in its entirety — not just the diff lines.

### 2. Fix-first: auto corrections

Apply the following mechanical corrections without asking:

| Category | Examples | Auto-fix threshold |
|---|---|---|
| Dead code | Unused variables, unused imports | Always |
| Magic numbers | Inline constants → named constants | Always |
| Stale comments | Comments that contradict the code | Always |
| Style / format | Local style inconsistencies, trailing whitespace | Always |
| Obvious DRY | Identical copy-paste block 3+ lines | If < `tunables.auto_fix_threshold_lines` |

**Do not auto-fix:**
- Security (auth, injection, XSS) → always in findings
- Race conditions → always in findings
- Visible behavior changes → always ask
- Refactors > `tunables.auto_fix_threshold_lines` lines → always ask

After each auto-fix, verify that quality gates still pass.

### 3. Conditional specialists

Spawn specialists based on scope. Each specialist receives:
- The complete diff
- The `briefs/<task>-reviewer.md`
- Their own instructions (path below)

| Specialist | Condition | Path / Invocation |
|---|---|---|
| `spec-compliance` (per-feature) | `specs/<task-slug>.md` exists | Invoke `spec-compliance-auditor` with spec path as `$ARGUMENTS` |
| `spec-compliance` | Always if KB exists (`kb/spec.md` present) | Skill — read `skills/kb/spec-compliance-auditor.md` and invoke via `Skill` tool or spawn as sub-agent with this content |
| `code-quality-auditor` | Always if KB exists (`kb/properties.md` present) | Skill — read `skills/kb/code-quality-auditor.md`; provide diff + `kb/properties.md` + `kb/glossary.md` + reviewer.md |
| `architect` | Medium or large blast radius (>3 files modified or public module) | `.claude/agents/architect.md` |
| `terminal-ux-reviewer` | TUI scope detected in diff or brief | `.claude/agents/terminal-ux-reviewer.md` |
| `reviewer` (agent) | Always | `.claude/agents/reviewer.md` |
| `cross-runtime-reviewer` | A runtime CLI other than the host is on `PATH` (`codex` or `opencode`) | See **Cross-Runtime Review** below — an independent second-model pass |

### Cross-Runtime Review

When a **different** runtime CLI is available, run an independent adversarial pass. Detection (auto-on):

```bash
command -v codex >/dev/null 2>&1 && echo "codex available"
command -v opencode >/dev/null 2>&1 && echo "opencode available"
```

If neither is present (or only the host runtime), **skip silently**.

Otherwise shell out non-interactively (e.g. `codex exec "<prompt>"`). Pass the diff and `briefs/<task>-review.json`; instruct it to return **only findings the primary missed**, as JSON in the standard finding schema with `specialist: "<runtime>-xruntime"`.

**Augment, never rewrite.** Append returned objects to `cross_runtime_findings`. Do **not** edit primary `findings` entries.

**GO authority:** any `cross_runtime_findings` entry that is CRITICAL or HIGH (OPEN) sets `status: NO-GO` with `no_go_reason.type = "cross-runtime-finding"`.

**KB-conditional check:** `[ -d kb ] && [ -f kb/properties.md ] && echo "KB present" || echo "KB absent"`

If KB is present, `code-quality-auditor` findings are merged into the review table. Critical KB violations are auto-classified as HIGH severity.

When findings have `category: "spec"` and severity CRITICAL or HIGH:
- Set `no_go_reason.type = "spec-ac-failure"` in the verdict
- Populate `no_go_reason.failed_acs` with the AC identifiers from those findings

**Expected findings format from each specialist:**

```json
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
  "confidence": 1-5,
  "path": "file/path.ml",
  "line": 42,
  "category": "correctness|security|architecture|ux|spec|style",
  "summary": "Short problem description",
  "evidence": "File X line Y — exact code quote",
  "fix": "What to do",
  "fingerprint": "path:line:category",
  "specialist": "architect|reviewer|spec-compliance|terminal-ux-reviewer"
}
```

### 4. Deduplication

If two specialists report the same finding (same `fingerprint` or same path+line+category):
- Keep the finding with the highest severity
- Note that both specialists converged (confidence signal)

### 5. Group ambiguities

Collect all findings that require a human decision (severity HIGH+ on behavior changes, security, design).

Present in **one single** `AskUserQuestion`:

```
I have questions on [N] points before finalizing the review:

1. [path:line] — <finding summary> — <option A vs option B>
2. [path:line] — ...

For each point: A, B, or free-form answer.
```

Never ask multiple separate questions. One single pass.

### 6. Write the verdict

Produce `briefs/<task>-review.json`:

```json
{
  "task": "<task-slug>",
  "date": "<ISO-8601>",
  "status": "GO|NO-GO",
  "auto_fixes_applied": [
    {
      "path": "file.ml",
      "line": 10,
      "category": "dead-code",
      "description": "Removed unused variable `x`"
    }
  ],
  "findings": [
    {
      "severity": "HIGH",
      "confidence": 4,
      "path": "file.ml",
      "line": 42,
      "category": "correctness",
      "summary": "...",
      "evidence": "...",
      "fix": "...",
      "fingerprint": "file.ml:42:correctness",
      "specialist": "reviewer",
      "status": "OPEN|RESOLVED|ACCEPTED"
    }
  ],
  "cross_runtime_findings": [
    {
      "severity": "HIGH",
      "confidence": 4,
      "path": "file.ml",
      "line": 42,
      "category": "correctness",
      "summary": "...",
      "evidence": "...",
      "fix": "...",
      "fingerprint": "file.ml:42:correctness",
      "specialist": "codex-xruntime",
      "status": "OPEN"
    }
  ],
  "summary": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "auto_fixed": 0
  },
  "no_go_reason": {
    "type": null,
    "failed_acs": []
  },
  "mode": "express|fast|full",
  "escalation_needed": false,
  "escalation_reason": null
  // type values: null | "spec-ac-failure" | "code-plan-failure" | "cross-runtime-finding"
  // escalation_reason: null | "new-public-api" | "implicit-design-decision" | "spec-update-needed" | "behaviour-change"
  // cross_runtime_findings: appended by the cross-runtime reviewer (augment-only); omit the key entirely if no second runtime ran
}
```

**GO status if:** no CRITICAL or HIGH OPEN finding **in either `findings` or `cross_runtime_findings`**.
**NO-GO status if:** at least one CRITICAL or HIGH OPEN finding (primary or cross-runtime) not resolved or explicitly accepted. A cross-runtime CRITICAL/HIGH sets `no_go_reason.type = "cross-runtime-finding"`.

### 7. Human gate

Present a one-line summary: auto-fixes applied, finding counts by severity, GO/NO-GO status. If NO-GO, name the HIGH+ findings to resolve. Wait for explicit human confirmation before proceeding.

## Output Contract

`briefs/<task>-review.json` with GO or NO-GO status and all findings documented.

**If GO:** `/roster-qa` can start. **If NO-GO:** return to `/roster-implement` with OPEN findings. **If `no_go_reason.type == "spec-ac-failure"`:** return to `/roster-spec` — spec ACs were not met.

## When to Go Back

| Condition | Action |
|---|---|
| NO-GO verdict — fixes required | Stop — return to `/roster-implement` with OPEN findings listed |
| Research reveals a design flaw missed in planning | Stop — re-run `/roster-plan` or `/roster-intake` before fixes |
| `code-quality-auditor` returns Critical KB violations | Auto-classify as HIGH finding → NO-GO unless immediately auto-fixable |
| `escalation_needed: true` in Express/Fast mode | Present to human — they decide whether to loop back to `/roster-spec` or accept as-is |

## What Next

**Primary path (GO, Express mode):** `/roster-ship` — Express skips QA
**Primary path (GO, Fast/Full mode):** `/roster-qa`
**Primary path (NO-GO):** `/roster-implement` — pass `briefs/<task>-review.json` as context
**Alternatives:**
- `/roster-audit` — if broader code quality concerns were flagged beyond this task

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

- Every claim must cite file and line — never "probably"
- "Looks good" is not a finding — omit it
- A caught error is not automatically safe — check blast radius: does it abort a whole request/transaction/batch? If so, flag as correctness/security
- One grouped AskUserQuestion — never multiple separate questions
- Verify quality gates after each auto-fix
- Specialists must produce JSON findings — reject free-form text
- Do not auto-fix visible behavior changes even if under the line threshold
