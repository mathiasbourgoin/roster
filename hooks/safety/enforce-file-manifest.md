---
name: enforce-file-manifest
description: Deny Edit/Write outside the active task's declared file manifest — surgical-implementation freeze layer, fail-open when no Full-mode implement phase is active.
event: PreToolUse
matcher: Edit|Write
version: 1.0.0
timeout: 5000
---

# Enforce File Manifest (Surgical Freeze)

Intercepts Edit/Write tool calls while a Full-mode implement phase is active and denies edits to
repo files outside the task's declared manifest (`briefs/<task>-manifest.txt`, grammar pinned in
`skills/pipeline/roster-implement.md` §1.5). Spec: `specs/surgical-implementation.md` (US-3).

**Deny mechanism:** exit 0 with JSON `hookSpecificOutput.permissionDecision: "deny"` on stdout —
Claude Code's documented contract (https://code.claude.com/docs/en/hooks.md). Exit codes do NOT
deny here: exit 1 is a *non-blocking* error in Claude Code; only exit 2 (stderr) or the JSON form
blocks. Allow = exit 0 with no output.

## Behavior

| State | Result |
|---|---|
| `briefs/ACTIVE_TASK` absent or empty | allow (fail-open — no active implement phase) |
| Named manifest file missing | allow (fail-open — stale or foreign slot) |
| `git rev-parse --show-toplevel` fails | allow (not a git repo context) |
| Path outside the repo root | allow (scratchpad//tmp are legitimate; the manifest governs repo files only) |
| Path IS `briefs/ACTIVE_TASK` or the active manifest | **deny** — control files, checked before any allowance; Bash-only writes |
| Path matches a manifest entry (exact, or `dir/` prefix) | allow |
| Anything else | **deny** with escalation + recovery instructions |

The hook deliberately skips header validation (it needs only the entries after `---`); a
malformed manifest fails loudly in the review gate (`check-scope-diff.sh` exit 2), not here.

## Known gaps — best-effort defense-in-depth, NOT a security boundary

Same trust model as `block-dangerous-commands`: this hook catches *accidental* scope drift; the
escalation rules and the review scope gate (`scripts/check-scope-diff.sh`) are the real controls.

- **Bash** — file writes via shell (`echo >`, `sed -i`, `git checkout`) are unmatched by design
  (control-file lifecycle and scope-finding reverts depend on this).
- **NotebookEdit** and any other write-capable tool outside the `Edit|Write` matcher.
- **MCP tools** — invisible to tool hooks.
- **Git worktrees** — the control files are gitignored and absent in worktree checkouts; the hook
  fail-opens there. The review scope gate is the backstop.
- **Concurrent sessions** — `briefs/ACTIVE_TASK` is a single slot; a second session is frozen to
  the first task's manifest until the slot is cleared.
- **Portability** — requires `jq` and GNU `realpath -m` (same environment assumptions as the
  other tool hooks; macOS without coreutils lacks `realpath -m`).

## Command

```command
#!/bin/bash
INPUT=$(cat -)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
}

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$ROOT" ] || exit 0
[ -f "$ROOT/briefs/ACTIVE_TASK" ] || exit 0
SLUG=$(head -n1 "$ROOT/briefs/ACTIVE_TASK" | tr -d '[:space:]')
[ -z "$SLUG" ] && exit 0
MANIFEST="$ROOT/briefs/${SLUG}-manifest.txt"
[ -f "$MANIFEST" ] || exit 0

ABS=$(realpath -m -- "$FILE_PATH" 2>/dev/null) || exit 0
case "$ABS" in
  "$ROOT"/*) REL="${ABS#"$ROOT"/}" ;;
  *) exit 0 ;;
esac

# Control files first — denied before any allowance is evaluated
if [ "$REL" = "briefs/ACTIVE_TASK" ] || [ "$REL" = "briefs/${SLUG}-manifest.txt" ]; then
  deny "BLOCKED: $REL is a scope-control file for task $SLUG. Control files are edited via Bash only, after human approval. Stale state from a crashed phase? After human confirmation: rm briefs/ACTIVE_TASK (Bash)."
fi

ALLOWED=0
IN_BODY=0
while IFS= read -r line || [ -n "$line" ]; do
  if [ "$IN_BODY" -eq 0 ]; then
    [ "$line" = "---" ] && IN_BODY=1
    continue
  fi
  [ -z "$line" ] && continue
  case "$line" in
    */)
      case "$REL" in
        "$line"*) ALLOWED=1; break ;;
      esac
      ;;
    *)
      if [ "$REL" = "$line" ]; then ALLOWED=1; break; fi
      ;;
  esac
done < "$MANIFEST"

[ "$ALLOWED" -eq 1 ] && exit 0
deny "BLOCKED: $REL is outside the declared file manifest for task $SLUG. If this file is genuinely needed: ask the human to approve extending briefs/${SLUG}-manifest.txt, extend it via Bash, then retry the edit. Stale state from a crashed phase? After human confirmation: rm briefs/ACTIVE_TASK (Bash)."
```

## Installed As

The installed `settings.json` hook command is **generated from the `## Command` block above** by
`sync-harness.sh` (`build_hooks_json` → `extract_command_block`). The live result is written to
`.claude/settings.local.json` under `hooks.PreToolUse` with `matcher: "Edit|Write"`.
