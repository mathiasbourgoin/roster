---
name: escalation
description: Default escalation triggers — pause and ask the human before destructive or high-impact actions.
scope: global
category: safety
version: 1.2.0
---

# Default Escalation Triggers

Pause and ask the human for explicit confirmation before performing any of the following:

- **Destructive file operations:** `rm -rf`, mass file deletion, overwriting files outside the current task scope.
- **Destructive git operations:** `git reset --hard`, `git push --force` / `git push -f` to any branch, `git clean -f`.
- **Destructive SQL:** `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `DELETE` without a `WHERE` clause.
- **Force-pushing** to any branch, including feature branches.
- **External API calls with side effects:** `POST`, `PUT`, `DELETE`, or `PATCH` to production endpoints.
- **CI/CD pipeline modifications:** Changing workflow files, build configs, deployment scripts, or pipeline triggers.
- **Auth and security changes:** Modifying permissions, access tokens, secrets, firewall rules, or auth configuration.
- **MCP server changes:** Installing, removing, or modifying MCP server configurations.
- **Handing a write-capable runtime a list of exact edits:** never embed mutation tables,
  patches, or exact before/after pairs in a prompt for a runtime that can write. What is in a
  prompt may be executed, not just read. On 2026-08-25 two secondary review runtimes both exited
  3 with `reason=tree-mutation` on a prompt carrying a table of named code edits. Name the check
  that performs the edits instead of the edits themselves.
- **Shared infrastructure:** Any action affecting resources used by other people or services (databases, message queues, DNS, load balancers).
- **Cost threshold:** Any action exceeding a configurable cost threshold (default: warn on operations that may incur billing).
- **Properties file:** Any action listed in `kb/properties.md` as requiring human approval.

When escalating, state what you intend to do, why, and what the blast radius is. Do not proceed until the human confirms.

## Enforcement (recommended config — make these triggers real, not just declarative)

This file is a *declarative* contract; an agent can ignore prose. Back it with runtime config so
the highest-risk triggers are mechanically enforced (recommendations — apply per project; they are
not auto-applied):

- **Deny-rules are the primary safety layer.** In `.claude/settings.json` (or the runtime
  equivalent), encode the destructive operations above as `permissions.deny` entries (e.g. `Bash`
  patterns for `rm -rf`, `git push --force`, `DROP TABLE`). Deny has the highest precedence — it
  blocks the call before the agent's judgment is involved, which is stronger than this prose.
- **Scrub credentials from subprocess env:** set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` so spawned
  shell commands don't inherit Anthropic/cloud secrets from the parent environment. Caveat: it also
  forces bubblewrap PID-namespace isolation on Linux even if the sandbox is off — it can break under
  Docker/older kernels (<5.1), so validate in your environment before enabling.

### Free text never goes on a command line

Both enforcement layers — `permissions.deny` globs and the `block-dangerous-commands` hook — match
the **whole command text, quoted arguments included**; no rule syntax can tell quoted text from
executed text. A command that merely *quotes* a dangerous one (a commit message describing an
installer bug, a task description, a search pattern) is blocked, often silently. `printf`, `echo`
and heredocs are command text too, so moving the text into them changes nothing.

- Write free text — commit messages, PR/issue/comment bodies, task descriptions, search patterns,
  multi-line scripts — with the runtime's **file-writing tool**, never a shell command.
- Then pass only the path: `git commit -F <file>`, `gh pr create --body-file <file>`,
  `gh issue create --body-file <file>`, `grep -f <file>`, `python3 <file>`.
- Put the file in the project's `briefs/` (a project-local temp location, never `/tmp`) and
  delete it right after use: host projects may track `briefs/`, and a later `git add -A` would
  commit it.
- Two exceptions stay on the command line: a **fixed literal message** that only interpolates a
  slug (e.g. `chore(harness): sync projections`), and a **PR title** (`gh pr create --title` has no
  file form). A title must never quote a command; if it would, rephrase it.

Do not weaken the deny-rules to avoid these false positives — they are the only hard layer on a
checkout whose hook predates `block-dangerous-commands` 1.3.0 (its `exit 1` does not block).

Prose states the intent; deny-rules + env config enforce it. A new escalation trigger above should
be paired with a deny-rule wherever the operation is mechanically expressible.

(Verified against Claude Code docs 2026-06-03: `permissions.deny` and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`
are real; a `CLAUDE_CODE_SCRIPT_CAPS` knob is **not** real and was dropped from this recommendation.)
