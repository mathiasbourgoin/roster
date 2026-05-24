---
name: roster-ship
description: Ship — conventional commits, rebase-merge, GitHub PR. Gated on review + QA go.
version: 1.2.0
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
- `briefs/<task>-review.json` — **BLOCK** if status is `NO-GO`
- `briefs/<task>-qa.md` — **BLOCK** if status is `NO-GO`
- `briefs/<task>-impl.md` — for commit messages

If either is NO-GO or absent:
> ⛔ BLOCKED: `<file>` is NO-GO or missing.
> Resolve the reported issues before shipping.

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

### 3. Rebase on main

```bash
git fetch origin
git rebase origin/main
```

If conflicts → resolve within the task scope only. If conflict is out of scope, report to the human.

### 4. Human gate — before push

Present:
```
Commits prepared:
  <short sha> type(scope): description
  ...

Branch: <name>
Target: main

Push and open PR?
```

Wait for confirmation.

### 5. Push and PR

```bash
git push origin <branch> --force-with-lease
gh pr create \
  --title "type(scope): description" \
  --body "$(cat briefs/<task>-impl.md | head -20)

Closes #N" \
  --base main
```

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
  ```bash
  git add kb/
  git commit -m "docs(kb): sync KB with <task-slug> changes"
  git push
  ```
→ If KB is **absent**: skip silently.

## Output Contract

GitHub PR opened (then merged after human approval), or BLOCKED status documented.

**Next:** tech-lead / human with merge confirmation.

**Increment metabolism counter:** After a GO ship (PR opened or merged), increment `completed_tasks` in `.harness/harness.json` (or `.claude/harness.json` if `.harness/` absent):

```bash
# read → increment → write (jq required)
jq '.layers.metabolism.completed_tasks += 1' .harness/harness.json > /tmp/hj && mv /tmp/hj .harness/harness.json
```

If `jq` is not available or the file does not exist, note the missed increment in the friction log without blocking.

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
- Never ship if review.json or qa.md is NO-GO or absent
- Never commit files outside the task scope
- If CI fails after push → do not merge, report
