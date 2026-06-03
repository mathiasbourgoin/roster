---
name: escalation
description: Default escalation triggers — pause and ask the human before destructive or high-impact actions.
scope: global
category: safety
version: 1.0.0
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

Prose states the intent; deny-rules + env config enforce it. A new escalation trigger above should
be paired with a deny-rule wherever the operation is mechanically expressible.

(Verified against Claude Code docs 2026-06-03: `permissions.deny` and `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`
are real; a `CLAUDE_CODE_SCRIPT_CAPS` knob is **not** real and was dropped from this recommendation.)
