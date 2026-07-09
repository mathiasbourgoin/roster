---
name: roster-ship
description: Carries a reviewed, QA'd branch through to a merged PR.
when_to_use: "Use after roster-qa returns GO. Trigger: 'ship this', 'roster-ship'."
version: 1.4.2
domain: pipeline
phase: ship
preamble: true
friction_log: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: both
tunables:
  merge_strategy: rebase-merge
  commit_convention: conventional
  pre_pr_checks: ""
  friction_warn_threshold: 10
  push_mode: pr  # allowed: pr | direct
  push_target: main
artifacts:
  reads:
    - briefs/<task>-review.json
    - briefs/<task>-qa.md
    - briefs/<task>-impl.md
  writes:
    - PR GitHub (external artifact — not tracked in briefs/)
pipeline_role:
  triggered_by: /roster-qa with GO status
  receives: ready branch, review.json GO, qa.md GO
  produces: PR opened or BLOCKED status with reason
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


### Pipeline State

If your skill's `phase:` frontmatter field is **non-null** (i.e. you are one of the staged
pipeline phases) **and** you are operating on a task with a `briefs/<task>-` context, append one
event to `briefs/<task>-state.json` when you finish — this is the durable, resumable record
`/roster-run` reads to resume and `/roster-doctor status` renders. Skip entirely if your `phase:`
is `null` (the standalone skills — e.g. doctor, audit, investigate, init, skill-health; the `phase:` field itself is the rule, not this list) or there is no task
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
- Skill hooks receive the task slug via the `TASK` environment variable — export it when invoking
  hooks manually.


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


# Roster Ship

You carry the implementation branch through to merge. Conventional commits, rebase-merge only, PR with closing issue. Never ship without the double review + QA gate.

**Token discipline:** terse — links not pastes, one-liner commit subjects.

## Input Contract

Before any action, read:
- `briefs/<task>-review.json` — **BLOCK** if status is `NO-GO`; read its `mode` field
- `briefs/<task>-impl.md` — for commit messages
- `briefs/<task>-qa.md` — **required for `fast`/`full` mode** (BLOCK if NO-GO or absent).
  **Express mode skips QA** (its pipeline is implement → review → ship), so a missing
  `qa.md` is expected and **not** a block when `review.json.mode == "express"`.

If `review.json.mode` is absent and the impl brief has no `Mode:` line, **require human
confirmation before treating a missing `qa.md` as expected** — the mode cannot be safely
inferred without an authoritative source.

Block conditions (refusals to enter ship — not a `ship`/`BLOCKED` ledger event; see the
Output Contract for `BLOCKED` semantics):
> ⛔ DO NOT SHIP: review.json is NO-GO or absent → resolve before shipping.
> ⛔ DO NOT SHIP: qa.md is NO-GO, or absent on a non-express task → run /roster-qa first.

## Steps

### 1. Pre-checks

```bash
git status           # repo clean?
git log --oneline -5 # branch state
```

If the repo is dirty on files outside the task scope → report and ask what to do.

If `tunables.pre_pr_checks` is defined, execute it and block on failure.

### 2. Conventional commits

From `briefs/<task>-impl.md`, build the commits:

**Format:** `type(scope): description`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Rules:
- Description in lowercase, imperative, no trailing period, max 72 chars
- One commit = one logical change that compiles independently
- Body if necessary (why, not what) — separated by a blank line
- Footer: `Closes #N` if issue referenced

```bash
git add <scope files>
git commit -m "type(scope): description"
```

### 3. Rebase on main (`push_mode: pr` only)

This step applies **only in `pr` mode**. In `direct` mode there is **no rebase-onto-main** — the work is fast-forward pushed to `tunables.push_target`'s configured long-lived branch (see Step 5).

```bash
git fetch origin
git rebase origin/main
```

If conflicts → resolve within the task scope only. If conflict is out of scope, report to the human.

### 4. Human gate — before push

Write the ship summary to `briefs/<task>-ship-gate.md`, then present the quiz per the human-validation.md protocol (at minimum 1 comprehension + 1 clarification + 1 consistency-check question). All questions uniform format — do not label by type.

Present:
```
Commits prepared:
  <short sha> type(scope): description
  ...

Branch: <name>
Target: main

Push and open PR?
```

Wait for explicit human confirmation after the quiz passes.

### 5. Push and PR

Behavior depends on `tunables.push_mode` (default `pr` — preserves current behavior):

**`pr` mode (default):**

```bash
git push origin <branch> --force-with-lease
gh pr create \
  --title "type(scope): description" \
  --body "$(cat briefs/<task>-impl.md | head -20)

Closes #N" \
  --base main
```

**`direct` mode:** fast-forward push to the long-lived branch configured in `tunables.push_target` — no PR, no rebase-onto-main (Step 3's rebase and Step 6's PR merge do not apply):

```bash
git push origin HEAD:<push_target>   # must be a fast-forward — never force
```

If the push is not a fast-forward, stop and report — do not force-push (see escalation rules).

### 6. Human gate — merge

After review and CI green:
```bash
gh pr merge <N> --rebase --delete-branch
```

**Rebase merge only.** Never a merge commit, never squash.

### 7. Confirmation

```
✅ Shipped: PR #N merged to main
Branch deleted: <branch>
Closes: #N
```

### 8. KB sync (conditional)

```bash
[ -d kb ] && ([ -f kb/spec.md ] || [ -f kb/index.md ]) && echo "KB present" || echo "KB absent"
```

If KB is **present**:
→ Invoke `skills/kb/kb-update.md` skill.
→ If `kb-update` reports a **contradiction** (code contradicts KB spec):
  - Surface as WARNING in the ship log — **do not attempt to revert the merge**.
  - Open a follow-up task: "KB amendment — `<task-slug>`" (describe the contradiction).
→ If KB updated cleanly:
  Wait for human confirmation before pushing KB changes to main. Then:
  ```bash
  git add kb/
  git commit -m "docs(kb): sync KB with <task-slug> changes"
  git push
  ```
→ If KB is **absent**: skip silently.

## Output Contract

GitHub PR opened (then merged after human approval), or BLOCKED status documented.

**Ledger event.** Per the preamble *Pipeline State*, append your event to
`briefs/<task>-state.json` as the last **contractual** act of the phase — after every ship
artifact is on disk. The metabolism counter, projection sync, and friction reminder below are
post-phase housekeeping, not part of the ship contract: a resumed run seeing `ship`/`COMPLETED`
may assume the ship itself is done even if housekeeping was interrupted.

- **Shipped** → `{ "phase": "ship", "outcome": "COMPLETED", "by": "roster-ship" }`.
- **BLOCKED** → first make sure the block is documented in the ship-gate artifact
  (`briefs/<task>-ship-gate.md`) **on disk**, then append `{ "phase": "ship", "outcome":
  "BLOCKED", "reason": "<...>", "by": "roster-ship" }` — the `reason` string summarizes why the
  ship action is impossible. Emit `BLOCKED` **only** when review and QA are GO but the ship
  action itself cannot be performed (permissions, remote state, human hold) — a NO-GO gate is
  not `BLOCKED` (that is a refusal to enter this skill's push path, handled by the gates above).
  On resume, `/roster-run` halts on a latest `ship`/`BLOCKED` and surfaces this `reason`.

**Next:** tech-lead / human with merge confirmation.

**Increment metabolism counter:** After a GO ship (PR opened or merged), increment `completed_tasks` in `.harness/harness.json` (fall back to `.claude/harness.json` if absent):

```bash
# read → increment → write (jq required; use a project-local temp file, never /tmp)
HARNESS=".harness/harness.json"
[ -f "$HARNESS" ] || HARNESS=".claude/harness.json"
[ -f "$HARNESS" ] && jq '.layers.metabolism.completed_tasks += 1' "$HARNESS" > "${HARNESS}.tmp" && mv "${HARNESS}.tmp" "$HARNESS"
# Sync projections immediately — harness.json drift will fail the next npm test otherwise
[ -f "$HARNESS" ] && ./scripts/sync-harness.sh 2>/dev/null && git add -A && git commit -m "chore(harness): sync .claude projection after metabolism counter bump" || true
```

If `jq` is not available or neither harness file exists, note the missed increment in the friction log without blocking. The sync-harness step is best-effort (`|| true`) — if it fails (e.g. no git or no sync-harness.sh), the increment was still written; the drift will be caught by the next `npm test`.

**Friction reminder:** After incrementing, print the current friction log size.
Substitute `tunables.friction_warn_threshold` for `THRESHOLD` before running:

```bash
# THRESHOLD = tunables.friction_warn_threshold (default 10)
FRICTION_COUNT=$(awk 'END{print NR}' skills-meta/friction.jsonl 2>/dev/null || echo 0)
echo "💡 Friction log: ${FRICTION_COUNT} entries."
[ "$FRICTION_COUNT" -gt "THRESHOLD" ] && echo "⚠️  Consider running /roster-skill-health to surface improvement proposals."
```

## When to Go Back

| Condition | Action |
|---|---|
| QA brief is not GO | Stop — do not ship; return to `/roster-qa` or `/roster-implement` |
| Pre-ship gate check reveals a new failure | Stop — re-run `/roster-qa` before retrying |
| `kb-update` reports code contradicts KB spec | Log WARNING, do not revert — open a KB amendment follow-up task |

## What Next

**Primary path:** Done — PR opened, awaiting human merge approval
**Alternatives:**
- `/roster-intake` — start the next task
- `/roster-skill-health` — good moment to analyze friction after a completed cycle

> 💡 A completed ship is the best time to run `/roster-skill-health` and capture what the cycle taught you.

## Friction Log

Append one entry per run. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "roster-ship"`.

## Rules

- Never a merge commit — rebase-merge only
- Never push without an explicit human gate
- Never commit files outside the task scope
- If CI fails after push → do not merge, report
