# Proposal: unify pipeline skills onto one `SKILL.md` set

**Status:** proposal / direction-of-travel — needs a dedicated Full-pipeline run (question → research
→ intake → spec → plan) before any implementation. Do **not** bundle into a feature PR.
**Branch:** captured on `next`. **Date:** 2026-06-03.

## Why

Roster maintains parallel projections of the same skills:

- `.claude/commands/<name>.md` (Claude slash commands)
- `.agents/skills/<name>/SKILL.md` (Codex)
- `.opencode/...` (OpenCode)

`sync-harness.sh` regenerates all of them from source. That projection layer is the bulk of the
repo's churn (≈90 of 147 files in the v2.6.0 batch) and the reason a small source change ripples
into dozens of generated files.

The ecosystem has since converged on one open standard. Verified (2026-06):

- **`SKILL.md` is identical across Claude Code, Codex, OpenCode, Copilot, Gemini, Cursor** — a
  skill written once runs on all without modification (agentskills.io, originally Anthropic).
- Discovery paths overlap: OpenCode reads `.opencode/skills/`, **`.claude/skills/`**, and
  **`.agents/skills/`**; Codex reads `.agents/skills/`; Claude reads `.claude/skills/`.
- In Claude Code, a `.claude/skills/<name>/SKILL.md` **also** exposes `/<name>` — so a single
  skill gives both model-discovery *and* an explicit slash command.

So most of the parallel projection layer is now redundant: one `SKILL.md` per skill, placed in a
commonly-scanned path, is discovered by every runtime.

## Sketch (to be validated by the pipeline, not committed as-is)

- Author each pipeline skill once as a `SKILL.md` (it largely already is, under `skills/`).
- Project (or symlink) into the shared discovery paths instead of bespoke per-runtime command files.
- Collapse `sync-harness.sh`'s per-runtime command/skill renderers toward one skill emitter.

## What does NOT collapse (the load-bearing caveats)

1. **Sub-agents are a different mechanism.** The specialist *agents* (architect, implementer,
   reviewer, …) are invoked via Claude's Task tool and Codex's `.codex/agents/*.toml` — subagent
   delegation, **not** the `SKILL.md` standard. That layer stays runtime-specific.
2. **Explicit, gated invocation is load-bearing.** Roster's pipeline depends on phases being
   triggered deliberately (`/roster-run` routes phase by phase). Skills are *model-discovered*
   (Claude may auto-load by description). Claude skills still expose `/<name>`, so this is
   achievable, but descriptions must be written so phases are not auto-loaded out of sequence.
   This is the highest-risk part and the reason it needs a spec, not a quick refactor.
3. **The skill-hook DSL** (`hooks/skills/<name>/pre|post.md`) is roster machinery, orthogonal to
   `SKILL.md`; it must keep working across the change.

## Success criteria for a future run

- One canonical `SKILL.md` per pipeline skill, discovered by Claude + Codex + OpenCode in a live check.
- `/roster-*` still explicitly invocable and still gated (no out-of-sequence auto-loading).
- `sync-harness.sh --check` and all CI guards still green; projection file count materially reduced.
- Agents + hooks unaffected.

## Recommendation

Run `/roster-run --full "unify pipeline skills onto one SKILL.md set, keep agents + roster-run
routing + skill-hooks intact"` so the adversarial spec phase can stress the invocation-determinism
risk before any code moves.
