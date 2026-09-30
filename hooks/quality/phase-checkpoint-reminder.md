---
name: phase-checkpoint-reminder
description: Inject a short reminder while a task's implement phase is open (briefs/ACTIVE_TASK set) — names the open phase, since when, and what closing it requires; escalates past a staleness threshold. Informational, fail-open.
event: UserPromptSubmit
version: 1.0.0
timeout: 5000
requires: ["jq"]
---

# Phase Checkpoint Reminder

The pipeline ledger `briefs/<task>-state.json` is append-only and is written only when a phase
**ends**. A phase that is never closed leaves no trace: the ledger keeps showing the previous
phase, `/roster-run` resumes from the wrong position, and nothing downstream notices. This hook
makes an open implement phase visible on every user prompt, so it cannot silently run for a day.

It fires on `UserPromptSubmit` and never blocks: it adds context via
`hookSpecificOutput.additionalContext` on exit 0 (Claude Code's documented contract for this
event, https://code.claude.com/docs/en/hooks.md). Silent = exit 0 with no output.

"Implement is open" is read from the slot `roster-implement` §1.5 already maintains:
`briefs/ACTIVE_TASK` is written at implement start and cleared once the impl brief is written
with Status COMPLETED (a PARTIAL keeps it). The ledger supplies "since when" and what is missing.

## Behavior

| State | Result |
|---|---|
| `jq` not on `PATH` | silent (fail-open) |
| `briefs/ACTIVE_TASK` absent or empty | silent — no implement phase open |
| `briefs/<task>-state.json` missing, invalid JSON, or no events | silent (fail-open) |
| Last event is `implement`/`COMPLETED` but the slot is still set | one line: stale slot, how to clear it |
| Slot set, last event anything else, age < threshold | one line: implement open since `<at>`, what closing requires |
| Same, age ≥ threshold | `STALE` reminder: close now or record `PARTIAL`, log friction for corrections so far |

"What closing requires" is computed, not generic: `briefs/<task>-impl.md` is named only when it
is missing; the ledger event is always named (it is the missing piece whenever this fires); a
present impl brief with no implement event is called out as the half-closed case.

**Age** = now − the last ledger event's `at` (ISO-8601, `Z` or `±HH:MM` offset, optional
fraction). If `at` is absent (it is optional in the preamble contract) or unparseable, the
`ACTIVE_TASK` modification time is used; if neither is available, age is unknown and the
reminder is never `STALE`.

**Threshold** — env `ROSTER_PHASE_STALE_HOURS` (whole hours, default `4`). A non-integer value
falls back to the default. Set it in the environment Claude Code is launched from.

**Project root** — the first of `$CLAUDE_PROJECT_DIR`, the git toplevel of the hook input's
`cwd`, or `cwd` itself that contains `briefs/ACTIVE_TASK`.

## Known gaps

- **Only implement is tracked.** Other phases have no "open" marker (no slot file), so a stalled
  question/research/spec/plan phase is not detected. Implement is where the long-open failure
  occurred and the only phase with a slot.
- **Fires on every prompt while implement is open** — by design (the failure mode is forgetting),
  kept to one line until the threshold. `ROSTER_PHASE_STALE_HOURS` only moves the escalation
  point; there is no per-prompt suppression.
- **Git worktrees** — `briefs/` is gitignored and absent in worktree checkouts; a session rooted
  in a worktree (and without `CLAUDE_PROJECT_DIR`) sees no slot and stays silent.
- **Clock and `at` honesty** — `at` values are written by the model; a wrong timestamp gives a
  wrong age. Age is advisory.
- **Other runtimes** — OpenCode and Codex have no `UserPromptSubmit` projection; this hook is
  Claude Code only.

## Command

```command
#!/bin/bash
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat -)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
GIT_ROOT=$(git -C "${CWD:-.}" rev-parse --show-toplevel 2>/dev/null)
ROOT=""
for cand in "${CLAUDE_PROJECT_DIR:-}" "$GIT_ROOT" "$CWD"; do
  if [ -n "$cand" ] && [ -f "$cand/briefs/ACTIVE_TASK" ]; then ROOT=$cand; break; fi
done
[ -n "$ROOT" ] || exit 0
SLUG=$(head -n1 "$ROOT/briefs/ACTIVE_TASK" | tr -d '[:space:]')
[ -n "$SLUG" ] || exit 0
LEDGER="$ROOT/briefs/${SLUG}-state.json"
[ -f "$LEDGER" ] || exit 0

IMPL=false
[ -f "$ROOT/briefs/${SLUG}-impl.md" ] && IMPL=true
SLOT_AT=$(date -r "$ROOT/briefs/ACTIVE_TASK" +%s 2>/dev/null)
HOURS=${ROSTER_PHASE_STALE_HOURS:-4}
case "$HOURS" in ''|*[!0-9]*) HOURS=4 ;; esac

MSG=$(jq -r --arg t "$SLUG" --argjson impl "$IMPL" --arg slot "$SLOT_AT" --argjson hours "$HOURS" '
  def epoch:
    try (capture("^(?<d>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})?$")
         | ((.d + "Z") | fromdateiso8601)
           - (if (.z // "Z") == "Z" then 0
              else ((.z[1:3] | tonumber) * 3600 + (.z[-2:] | tonumber) * 60)
                   * (if .z[0:1] == "-" then -1 else 1 end) end))
    catch null;
  select(type == "object" and (.events | type) == "array" and (.events | length) > 0)
  | .events[-1] as $last
  | select(($last | type) == "object")
  | "\($last.phase // "?")/\($last.outcome // "?")" as $ev
  | (if ($last.at | type) == "string" then ($last.at | epoch) else null end) as $at
  | ($at // (try ($slot | tonumber) catch null)) as $since
  | (if $since == null then null else ((now - $since) / 3600) end) as $age
  | (if $age == null then "unknown age" else "\(($age * 10 | floor) / 10)h ago" end) as $agetxt
  | (if $since == null then "an unknown time" else ($since | floor | todate) end) as $sincetxt
  | if $last.phase == "implement" and $last.outcome == "COMPLETED" then
      "roster: briefs/ACTIVE_TASK still names \($t), but its ledger already records implement/COMPLETED. The slot should have been cleared at phase end; after human confirmation: rm briefs/ACTIVE_TASK (Bash)."
    else
      ([ (if $impl then empty else "write briefs/\($t)-impl.md (Status COMPLETED or PARTIAL)" end),
         "append the implement event to briefs/\($t)-state.json",
         "clear briefs/ACTIVE_TASK on COMPLETED" ] | join(", then ")) as $close
      | (if $impl then " briefs/\($t)-impl.md exists but no implement event was appended: the phase is half-closed." else "" end) as $half
      | if $age != null and $age >= $hours then
          "roster STALE (>= \($hours)h): the implement phase of task \($t) has been open since \($sincetxt) (\($agetxt)); the ledger still ends at \($ev).\($half) Close it now: \($close); record implement/PARTIAL with a reason if work remains. Append a friction entry (skills-meta/friction.jsonl) for the corrections made so far. Do not start any review before implement is closed; review goes through /roster-review."
        else
          "roster: implement phase of task \($t) is open since \($sincetxt) (\($agetxt); ledger ends at \($ev)).\($half) Closing requires: \($close). Review only via /roster-review, after closing."
        end
    end
' "$LEDGER" 2>/dev/null) || exit 0
[ -n "$MSG" ] || exit 0
jq -n --arg ctx "$MSG" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
exit 0
```

## Installed As

Generated from the `## Command` block above by `sync-harness.sh` (`build_hooks_json` →
`extract_command_block`) into `.claude/settings.local.json` under `hooks.UserPromptSubmit`
(no matcher — `UserPromptSubmit` has none).
