---
name: roster-review
description: Fix-first review with conditional specialists — produces a structured GO/NO-GO verdict.
version: 1.0.0
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

# Roster Review

You conduct a structured, fix-first review. Mechanical corrections are applied without asking. Ambiguities are grouped into one single question. You produce a structured JSON verdict.

**Golden rule:** every claim ("it's handled", "tests cover that") must cite the file and line. Never "probably" or "likely".

## Input Contract

Read in order:
1. `briefs/<task>-reviewer.md` — context and points of attention
2. `briefs/<task>-impl.md` — modified files and decisions made
3. `git diff main...HEAD` — the complete diff

If `briefs/<task>-impl.md` is absent:
> ⛔ Impl brief missing. Review cannot start without knowing the implementation scope.

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
| `spec-compliance` | Always if KB exists | Skill — read `skills/kb/spec-compliance-auditor.md` and invoke via `Skill` tool or spawn as sub-agent with this content |
| `architect` | Medium or large blast radius (>3 files modified or public module) | `.claude/agents/architect.md` |
| `terminal-ux-reviewer` | TUI scope detected in diff or brief | `.claude/agents/terminal-ux-reviewer.md` |
| `reviewer` (agent) | Always | `.claude/agents/reviewer.md` |

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
  "summary": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "auto_fixed": 0
  },
  "no_go_reason": null
}
```

**GO status if:** no CRITICAL or HIGH OPEN finding.
**NO-GO status if:** at least one CRITICAL or HIGH OPEN finding not resolved or explicitly accepted.

### 7. Human gate

Present a summary:
```
Review complete.
Auto-fixes applied: <N>
Findings: <N> critical, <N> high, <N> medium, <N> low
Status: GO ✅ / NO-GO ❌

[If NO-GO]: resolve HIGH+ findings before proceeding to QA.
[If GO]: ready for /roster-qa.
```

## Output Contract

`briefs/<task>-review.json` with GO or NO-GO status and all findings documented.

**If GO:** `/roster-qa` can start.
**If NO-GO:** return to `/roster-implement` with OPEN findings.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-review",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Every coverage claim must cite the file and line — never "probably"
- "Looks good" is not a finding — if it's good, don't mention it
- One single grouped AskUserQuestion — never multiple separate questions
- Auto-fixes: verify quality gates after each fix
- Specialists must produce JSON findings — do not accept free-form text as output
- Do not auto-fix visible behavior changes even if under the line threshold
