---
name: git-conventions
description: Standardizes commit messages, branch names, and PR structure for the current action.
when_to_use: "Use whenever git history or a PR is about to be created. Trigger: 'commit this', 'open a PR'."
version: 1.1.0
---

# Git Conventions

Apply standardized git conventions for the action described in $ARGUMENTS (e.g., "commit this", "create PR", "new branch for auth feature").

## Steps

1. Identify the action requested in `$ARGUMENTS` (commit, branch, PR, or full workflow).
2. Apply the relevant convention sections below.
3. Execute the git command(s) following the format.

## Commit Format

```
<type>: <description>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

- Description: imperative mood, lowercase, no period, under 72 chars.
- Body (optional): blank line after subject, wrap at 80 chars, explain **why** not what.
- Footer (optional): `Closes #123`, `BREAKING CHANGE: <description>`.

Examples:
- `feat: add JWT authentication middleware`
- `fix: prevent null pointer in user lookup`
- `refactor: extract validation into shared module`

## Branch Naming

```
<type>/<short-description>
```

- Kebab-case description, max 4 words.
- Examples: `feat/add-auth`, `fix/null-pointer`, `refactor/extract-validation`
- For issue-linked work: `feat/123-add-auth`

## PR Workflow

When creating a PR:

1. Ensure the branch is pushed with `git push -u origin <branch>`.
2. Write the body with the file-writing tool to `briefs/<branch-slug>-pr-body.md`, then:
   ```bash
   gh pr create --title "<type>: <description>" --body-file briefs/<branch-slug>-pr-body.md && rm -f briefs/<branch-slug>-pr-body.md
   ```
   Template for the body:

```markdown
## Summary
- <1-3 bullet points describing what and why>

## Test plan
- [ ] <specific verification step>
- [ ] <edge case checked>
- [ ] <regression check>
```

3. Title: same format as commit subject (`<type>: <description>`), under 70 chars.
4. Request reviewers if the user specifies them.

## Commit Workflow

When committing:

1. Run `git status` and `git diff --staged` to understand what's staged.
2. If nothing staged, help the user stage relevant files (prefer explicit paths over `git add .`).
3. Draft commit message following the format above.
4. Write the message with the **file-writing tool** (not a shell command) to
   `briefs/<branch-slug>-commit-msg.txt` — `<branch-slug>` is the branch name with `/` replaced
   by `-`, so two sessions in one checkout never overwrite each other's file — then commit from it
   and delete it:
   ```bash
   git commit -F briefs/<branch-slug>-commit-msg.txt && rm -f briefs/<branch-slug>-commit-msg.txt
   ```
   Never put the message on the command line — not in `-m "..."`, not in a heredoc, not in
   `printf`/`echo`: see the free-text rule below.
5. Run `git status` after to confirm success.

## Rules

- **Never** force-push to `main` or `master`.
- **Always** push with `-u` to set upstream tracking.
- Stage specific files by default — `git add .` / `git add -A` are permitted **only** immediately after a full-tree generator run (e.g. `scripts/sync-harness.sh` projection regeneration, where CI's harness-sync check requires every regenerated file staged), and only when everything else in the tree was already staged or clean before the generator ran — never as a way to sweep in unrelated edits.
- **Never** skip pre-commit hooks (`--no-verify`).
- **Free text goes through a file written with the file-writing tool**, never the command line
  (`printf`, `echo` and heredocs included): commit messages, PR and comment bodies, search
  patterns. Both the deny-rules and the dangerous-command hook match the whole command text, so a
  message that merely *quotes* a dangerous command is blocked. Full rule: `rules/safety/escalation.md`,
  "Free text never goes on a command line".
- **Never** commit `.env`, credentials, or secrets — warn the user if these are staged.
- PR descriptions must be comprehensive — reviewers should understand the change without reading code.
- One logical change per commit. Split unrelated changes into separate commits.

## Friction Log

Append one entry at phase exit — when this skill finishes, not at session end. Canonical template and key set: `skills/shared/preamble-friction.md` (schema: `schema/skill-schema.md`). Set `"skill": "git-conventions"`.
