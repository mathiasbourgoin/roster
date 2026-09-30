---
name: block-adhoc-review
description: Deny spawning a review-like subagent while a Full-mode task's implement phase is still open — review goes through /roster-review after implement is closed. Heuristic, fail-open, explicit override.
event: PreToolUse
matcher: Agent|Task
version: 1.0.0
timeout: 5000
requires: ["jq"]
---

# Block Ad-hoc Review (Implement Still Open)

`/roster-review` is the only review path that produces `briefs/<task>-review.json`, runs the
scope gate (`scripts/check-scope-diff.sh`) and enforces the ratchet. A reviewer subagent spawned
directly by the implementing session skips all three, and — because implement was never closed —
the ledger records no review either. This hook denies such a spawn while a Full-mode task's
implement phase is open, and tells the model how to close the phase instead.

**Deny mechanism:** exit 0 with JSON `hookSpecificOutput.permissionDecision: "deny"` on stdout —
Claude Code's documented contract (https://code.claude.com/docs/en/hooks.md). Allow = exit 0 with
no output. Matches the subagent tool under both names (`Agent`, formerly `Task`).

## Behavior

| State | Result |
|---|---|
| `jq` not on `PATH` | allow (fail-open) |
| `ROSTER_ALLOW_ADHOC_REVIEW=1` in the environment | allow (session-wide human override) |
| `briefs/ACTIVE_TASK` absent or empty | allow — no implement phase open |
| `briefs/<task>-state.json` missing, invalid JSON, no events, or `mode` ≠ `full` | allow (fail-open) |
| Last ledger event is `implement`/`COMPLETED`, or any `review`/`qa`/`ship` event | allow — implement closed (a NO-GO loop-back is past review, see gaps) |
| Last event is `question`…`plan`, or `implement`/`PARTIAL` (implement open) … | |
| … and the spawn is not review-like | allow |
| … and the prompt or description carries `[outside-roster-review: <reason>]` | allow (per-spawn override) |
| … and the spawn is review-like | **deny** with close-then-`/roster-review` instructions and both overrides |

Project root is resolved as in `phase-checkpoint-reminder`: the first of `$CLAUDE_PROJECT_DIR`,
the git toplevel of the input `cwd`, or `cwd` that contains `briefs/ACTIVE_TASK`.

### "Review-like" heuristic (checked in this order, all case-insensitive)

1. **`subagent_type`** contains `review` or `auditor`, or is exactly `architect` — e.g.
   `reviewer`, `pr-review-toolkit:code-reviewer`, `red-team-auditor`, `architect`.
2. **`description`** (the 3-5 word label) contains the standalone word `review`/`reviews`/
   `reviewed`/`reviewing`/`reviewer(s)`, `audit`/`audits`/`audited`/`auditing`/`auditor(s)`,
   `red team`/`red-team`, or French `revue`/`relecture`. "Standalone" means not glued to a path
   or identifier: `roster-review`, `/review`, `review.json`, `pre-review` do not match.
3. **`prompt`** contains one of a few strong phrases only (prompts are long and routinely mention
   "the review" in passing, so single words are not used here):
   - `adversarial review|audit|reviewer|auditor` (optionally `adversarial code/security review`);
   - `you are a/an/the … reviewer|auditor` (up to three words between);
   - `review|audit the|this|these|my|our|all … diff|branch|change(s)|PR|pull request|implementation|commit(s)|patch`
     (up to two words between; `implementation plan`/`implementation brief` excluded);
   - French `revue adversariale|de code|critique`.

### Overrides

- **Per spawn:** put `[outside-roster-review: <non-empty reason>]` in the prompt or description.
  Use it for a false positive, or for an ad-hoc review the human explicitly approved. The marker
  stays in the transcript as the audit trail. The model can write it — this guard stops
  *accidental* bypass, not a determined one.
- **Per session:** launch Claude Code with `ROSTER_ALLOW_ADHOC_REVIEW=1`. Only the human can set
  it (hooks inherit the launching environment; the model cannot change it mid-session).

## Known gaps — best-effort, NOT a security boundary

Same trust model as `block-dangerous-commands` and `enforce-file-manifest`: the pipeline skill
text and the human gate are the real controls; this catches the common slip.

- **Paraphrase evades it.** "Look over", "critique", "find bugs in", "second opinion", most
  non-English wording beyond `revue`/`relecture`, and a generic `general-purpose` subagent with
  neutral wording are all allowed.
- **False positives** remain possible: an implementation task *about* review or audit tooling
  ("Fix audit logger") matches the description rule. The deny message names the rule that fired
  and the per-spawn override.
- **Loop-back rounds are not covered.** After a review NO-GO, implement is re-opened but the last
  ledger event is `review`, which the hook treats as "past implement". Only the first implement
  round is guarded.
- **Other review channels** are invisible: Bash (`codex exec`, `scripts/xruntime-review.js`),
  MCP tools, the Skill tool, and reviews the main session performs itself without spawning.
- **Express/Fast** tasks are not guarded (no `briefs/ACTIVE_TASK` slot; `mode` ≠ `full`).
- **Git worktrees** — the control files are gitignored and absent in worktree checkouts; a
  session rooted in a worktree without `CLAUDE_PROJECT_DIR` fail-opens.

## Command

```command
#!/bin/bash
command -v jq >/dev/null 2>&1 || exit 0
[ "${ROSTER_ALLOW_ADHOC_REVIEW:-}" = "1" ] && exit 0
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

# "open" only for a Full-mode ledger whose last event is before implement or implement/PARTIAL
LAST=$(jq -r '
  select(type == "object" and .mode == "full" and (.events | type) == "array" and (.events | length) > 0)
  | .events[-1]
  | select(type == "object")
  | select((.phase | IN("question","research","intake","spec","plan"))
           or (.phase == "implement" and .outcome != "COMPLETED"))
  | "\(.phase)/\(.outcome)"
' "$LEDGER" 2>/dev/null)
[ -n "$LAST" ] || exit 0

WHY=$(printf '%s' "$INPUT" | jq -r '
  (.tool_input // {}) as $in
  | ($in.subagent_type // "" | tostring) as $type
  | ($in.description // "" | tostring) as $desc
  | ($in.prompt // "" | tostring) as $prompt
  | if (($desc + "\n" + $prompt) | test("\\[outside-roster-review:\\s*[^\\]\\s][^\\]]*\\]"; "i")) then empty
    elif ($type | test("review|auditor|^architect$"; "i")) then "subagent_type \"\($type)\""
    elif ($desc | test("(^|[^\\w/.-])(review(s|ed|ing|ers?)?|audit(s|ed|ing|ors?)?|red[ -]team(ing)?|revue|relecture)(?![\\w/-]|\\.\\w)"; "i"))
      then "description \"\($desc)\""
    elif ($prompt | test("adversarial(ly)?[ -]+((code|security)[ -]+)?(review|audit|reviewer|auditor)|\\byou are (an? |the )?([\\w-]+ ){0,3}(reviewer|auditor)\\b|\\b(review|audit) (the|this|these|my|our|all) ([\\w-]+ ){0,2}(diff|branch|changes?|pr|pull request|implementation(?! (plan|brief))|commits?|patch)\\b|\\brevue (adversariale|de code|critique)"; "i"))
      then "prompt wording"
    else empty end
' 2>/dev/null)
[ -n "$WHY" ] || exit 0

REASON="BLOCKED: review-like subagent ($WHY) while the implement phase of Full-mode task $SLUG is still open (ledger ends at $LAST). An ad-hoc reviewer bypasses /roster-review's gates (briefs/$SLUG-review.json, scope gate scripts/check-scope-diff.sh, ratchet) and leaves no review on record. Close implement first: write briefs/$SLUG-impl.md, append the implement event to briefs/$SLUG-state.json, clear briefs/ACTIVE_TASK on COMPLETED (Bash), then run /roster-review. Not a review, or the human explicitly approved this ad-hoc review? Add [outside-roster-review: <reason>] to the prompt and retry, or have the human relaunch with ROSTER_ALLOW_ADHOC_REVIEW=1."
jq -n --arg reason "$REASON" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
exit 0
```

## Installed As

Generated from the `## Command` block above by `sync-harness.sh` (`build_hooks_json` →
`extract_command_block`) into `.claude/settings.local.json` under `hooks.PreToolUse` with
`matcher: "Agent|Task"`.
