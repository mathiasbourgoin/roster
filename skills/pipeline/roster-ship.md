---
name: roster-ship
description: Carries a reviewed, QA'd branch through to a merged PR.
when_to_use: "Use after roster-qa returns GO. Trigger: 'ship this', 'roster-ship'."
version: 1.4.1
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

Block conditions (these are refusals to enter ship — they do **not** emit a
`ship`/`BLOCKED` ledger event, which is reserved for the Output Contract's definition):
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

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-ship",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Never a merge commit — rebase-merge only
- Never push without an explicit human gate
- Never ship if review.json is NO-GO or absent, or if qa.md is NO-GO; qa.md may be absent **only** in express mode (which skips QA)
- Never commit files outside the task scope
- If CI fails after push → do not merge, report
