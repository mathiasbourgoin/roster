---
name: rtk-compat
description: Known rtk (Rust Token Killer) command-rewrite breakages and their standardized alternatives — defensive command choices for an environment where the rtk PreToolUse hook may be active.
scope: global
category: common
version: 1.0.0
---

# rtk Compatibility

rtk is an optional, user-environment `PreToolUse` hook that transparently rewrites shell commands
(e.g. `git status` → `rtk git status`) to cut token usage. The roster does not install, configure,
or depend on rtk — this rule exists only to document defensive command choices for an environment
where the hook **may** already be active, so agents don't lose time re-discovering the same
breakages every session.

**This rule never instructs installing, configuring, or enabling rtk.** It documents workarounds
for a hook that is outside the roster's control.

## Known breakages and their standardized alternatives

| Breakage | Alternative |
|---|---|
| `rtk ls -1` returns empty / prints literal `(empty)` (upstream #803, #1418) | Use `find`, `git ls-files`, or a `[ -f <path> ]` existence check instead of `ls` for anything scripted or parsed. |
| Hook emits non-JSON or 0-byte output on some commands (#1773) | Don't parse hook output directly; re-run the underlying command via `rtk proxy <cmd>` when raw output is required, or fall back to the file-capture idiom below. |
| `cat`/`sed`/`grep` output gets mangled on macOS through the rewrite path (#2360) | Capture to a file then read the file, rather than piping mangled stdout — see `scripts/xruntime-exec.sh:16-17` for the file-capture-then-echo idiom. Or bypass the rewrite entirely with `rtk proxy <cmd>`. |
| `git diff` output is mangled such that `git apply` cannot consume it | Do a whole-file checkout/rewrite instead of patch-applying a diff produced through the rewrite path. |
| Multi-file `grep` is intercepted and rewritten to `rg`, which rejects some patterns the caller intended for `grep` | Use `grep -F` (literal match), or restructure the search as an `awk`/`for` loop, or run it via `rtk proxy grep …`. |
| `[hooks] exclude_commands` config is broken in some rtk versions (#1335) and cannot be relied on to suppress rewriting for a given command | Do not treat `exclude_commands` as the primary mitigation. Prefer the prose command substitutions in this table (or `rtk proxy <cmd>` for a one-off bypass) — they work regardless of `exclude_commands` version bugs. |

**The one to remember above all:** never rely on parsed/scripted `ls` output under the rtk hook —
use `find`, `git ls-files`, or `[ -f ]` instead.

## Verification-only meta commands (not rewritten, safe to run directly)

`rtk --version`, `rtk gain`, `rtk gain --history`, `rtk discover`, and `rtk proxy <cmd>` are rtk's
own CLI surface, not commands the hook rewrites — they are always safe to call directly when
checking whether rtk is present or bypassing the rewrite for a single command.
