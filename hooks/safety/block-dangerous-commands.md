---
name: block-dangerous-commands
description: Block destructive shell commands — rm -rf, force push to any branch, SQL drops, chmod 777, pipe to shell, destructive HTTP mutations.
event: PreToolUse
matcher: Bash
version: 1.2.0
timeout: 5000
---

# Block Dangerous Shell Commands

Intercepts Bash tool calls and rejects commands matching known destructive patterns. A non-zero exit blocks the tool call and shows the reason to the model.

`permissions.deny` in `.claude/settings.json` is the primary enforcement layer for
Claude Code; this hook is defense-in-depth for patterns that require shell parsing logic.

> Note: MCP tool calls (e.g. direct API mutations via MCP servers) are invisible to Bash hooks.
> The deny rules in `.claude/settings.json` and human escalation are the controls there.

## Blocked Patterns

| Pattern | Reason |
|---------|--------|
| `rm -rf <any-path>` | Recursive deletion with force flag — confirm path before running |
| `git push --force` / `git push -f` to any branch | Rewrites shared history (not just main/master) — use `--force-with-lease` instead |
| `git reset --hard` | Discards uncommitted work irreversibly |
| `DROP TABLE`, `DROP DATABASE`, `TRUNCATE` | Destructive SQL — data loss |
| `DELETE FROM ...` without `WHERE` | Deletes all rows — data loss |
| `git clean -f` / `--force` | Irreversibly deletes untracked files |
| `chmod 777` | Removes all permission restrictions — security violation |
| `curl ... \| sh`, `wget ... \| sh` | Arbitrary remote code execution |
| `curl -X POST/PUT/DELETE/PATCH` | Destructive HTTP mutations — confirm endpoint before running |

## Command

```command
#!/bin/bash
INPUT=$(cat -)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Best-effort, defense-in-depth against ACCIDENTAL destructive commands — NOT a security
# boundary. Regex cannot fully parse shell+SQL; deliberate obfuscation (encoding, variable
# indirection, eval, comments/quoting) can evade it. The escalation rules + human gate are
# the real protection. `permissions.deny` in `.claude/settings.json` is the primary layer;
# this hook covers patterns requiring shell parsing. Patterns use POSIX [[:space:]] (not \s)
# so the guards also fire under BSD/macOS grep.

# rm -rf targeting any non-whitespace path (not just root/home/cwd)
if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*[[:space:]]+[^[:space:]]'; then
  echo "BLOCKED: 'rm -rf' requires confirmation. Verify the target path before proceeding."
  exit 1
fi
if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*[[:space:]]+[^[:space:]]'; then
  echo "BLOCKED: 'rm -rf' requires confirmation. Verify the target path before proceeding."
  exit 1
fi

# git push --force / -f to any branch (--force-with-lease is permitted — it is a safe alternative)
if echo "$COMMAND" | grep -qE 'git[[:space:]]+push[[:space:]]+.*--force([[:space:]]|$)' && ! echo "$COMMAND" | grep -q 'force-with-lease'; then
  echo "BLOCKED: Force push to any branch is not allowed. Use --force-with-lease instead."
  exit 1
fi
if echo "$COMMAND" | grep -qE 'git[[:space:]]+push[[:space:]]+.*[[:space:]]-f([[:space:]]|$)'; then
  echo "BLOCKED: Force push (-f) to any branch is not allowed. Use --force-with-lease instead."
  exit 1
fi

# git reset --hard (any target)
if echo "$COMMAND" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  echo "BLOCKED: 'git reset --hard' discards work irreversibly. Ask the user for confirmation first."
  exit 1
fi

# Destructive SQL
if echo "$COMMAND" | grep -qiE '(DROP[[:space:]]+TABLE|DROP[[:space:]]+DATABASE|TRUNCATE)\b'; then
  echo "BLOCKED: Destructive SQL detected. Ask the user for confirmation first."
  exit 1
fi

# DELETE without a WHERE clause (removes all rows) — best-effort, PER STATEMENT.
# Split on ';' (statement terminator) and flag any statement that has DELETE FROM but no
# WHERE anywhere within it — WHERE may be on a following line, so the whole statement (incl.
# newlines) is one awk record. Uppercased first for portable case-insensitivity (no gawk
# IGNORECASE dependency). Conservative: a bare "DELETE FROM" in a commit message / grep also
# blocks (fail-safe — the documented best-effort trade-off). Statements separated only by a
# newline (no ';') are treated as one record — an accepted limitation of a regex guard.
DELETE_NO_WHERE=$(printf '%s' "$COMMAND" | tr '[:lower:]' '[:upper:]' | awk 'BEGIN{RS=";"; c=0} /DELETE[[:space:]]+FROM/ && !/(^|[^[:alnum:]_])WHERE([^[:alnum:]_]|$)/ {c++} END{print c+0}')
if [ "${DELETE_NO_WHERE:-0}" -gt 0 ]; then
  echo "BLOCKED: a 'DELETE FROM' statement has no WHERE clause (removes all rows). Add WHERE or confirm explicitly."
  exit 1
fi

# git clean -f / --force (irreversibly deletes untracked files) — best-effort, PER SEGMENT.
# Join backslash-newline continuations, then split on ; & | and newlines so a chained or
# continued destructive clean can't hide behind a sibling dry-run. Allow global options
# (git -C path clean); exempt -n / --dry-run (the suggested preview).
CLEAN_NORM=$(printf '%s' "$COMMAND" | sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n/ /g')
DANGER_CLEAN=$(printf '%s' "$CLEAN_NORM" | tr ';&|' '\n' | grep -iE 'git[[:space:]].*clean' | grep -iE '(-[a-zA-Z]*f|--force)' | grep -ivcE '(-[a-zA-Z]*n|--dry-run)')
if [ "${DANGER_CLEAN:-0}" -gt 0 ]; then
  echo "BLOCKED: 'git clean -f' permanently deletes untracked files. Preview with 'git clean -n' first, then confirm."
  exit 1
fi

# chmod 777
if echo "$COMMAND" | grep -qE 'chmod[[:space:]]+777'; then
  echo "BLOCKED: 'chmod 777' removes all permission restrictions. Use a more restrictive mode."
  exit 1
fi

# Piping remote content to shell
if echo "$COMMAND" | grep -qE '(curl|wget)[[:space:]]+.*\|[[:space:]]*(ba)?sh'; then
  echo "BLOCKED: Piping remote content to shell is arbitrary code execution. Download and inspect first."
  exit 1
fi

# curl/wget with destructive HTTP methods (POST/PUT/DELETE/PATCH) to prevent accidental mutations
if echo "$COMMAND" | grep -qiE '(curl|wget)[[:space:]].*-X[[:space:]]+(POST|PUT|DELETE|PATCH)\b'; then
  echo "BLOCKED: curl/wget with a destructive HTTP method (POST/PUT/DELETE/PATCH) requires confirmation. Verify the endpoint and payload first."
  exit 1
fi

exit 0
```

## Installed As

The installed `settings.json` hook command is **generated from the `## Command` block above**
by `sync-harness.sh` (`build_hooks_json` → `extract_command_block`) — there is no second
hand-maintained copy to keep in sync. The live result is written to
`.claude/settings.local.json` under `hooks.PreToolUse` with `matcher: "Bash"`.
