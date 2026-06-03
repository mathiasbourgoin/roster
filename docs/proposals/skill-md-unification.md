# Proposal: unify pipeline skills onto one `SKILL.md` set

**Status:** **RE-SCOPED after a Full-pipeline run (2026-06-03, `next`).** The grand "one output path
discovered by every runtime" goal was found to rest on a **false premise** and was rejected; a
smaller safe win shipped instead. See *Outcome* below before reading the original proposal.
**Branch:** `next`.

## Outcome (Full-pipeline run, externally reviewed)

Research (`briefs/skill-unification-research.md`) + an adversarial spec review
(opencode/gpt-5.5, GO) established:

- **The source is already unified** — all skills flow through one transform (`render_skill_source`
  in `sync-harness.sh`). The multiplicity is only at the *output shape*, which the runtimes require.
- **Claude Code and Codex do NOT cross-read skill dirs** — Claude scans `.claude/skills/` (+ legacy
  `.claude/commands/`), Codex scans `.agents/skills/`. Neither reads the other's default path
  (Claude `--add-dir` only adds another `.claude/` root). So "one shared output path for every
  runtime" is **unsupported by defaults** — achievable only via committed symlinks, which are **not
  robust enough for roster's `curl|bash` / npx / Windows install matrix**. The parallel projections
  are therefore *required*, not redundant. **The original "discovered by every runtime" claim below
  is wrong** and is kept only for the record.
- **What actually shipped this run:** only this grounded write-up (FR-003). The grand collapse is
  rejected; the two adjacent code wins were attempted and one was bounced — see below.
- **FR-001 (bidirectional `--check` orphan detection) — ATTEMPTED, then BOUNCED by adversarial
  review.** It was implemented (drop the `grep -v "Only in real"`, add `-x` excludes) and passed a
  Claude review, but a second external review (opencode/gpt-5.5) returned NO-GO with a
  **reproducible false positive**: `install.sh` writes `.opencode/skills/recruit/SKILL.md` while
  `sync-harness` emits `.opencode/commands/recruit.md` — so enabling OpenCode + the installer
  bootstrap makes the new bidirectional check fail with `Only in .opencode: skills`. Reviewers also
  flagged that `diff -x 'patterns'`/`'.claude-plugin'` are *basename* matches (a real orphan named
  `patterns` is silently missed) and that the disabled-runtime dir is skipped entirely (so the
  change does NOT catch the very `.opencode` stale case partly motivating it). Net: the orphan check
  is more entangled than its value justifies — it exposes a pre-existing **install-vs-sync
  `.opencode` path disagreement** that must be reconciled first. Reverted. Re-attempt needs:
  path-anchored excludes (not basename), a rule for installer-bootstrap artifacts, and the
  install/sync OpenCode recruit path reconciled.
- **FR-002 (clean stale committed `.opencode/` projections) — DEFERRED, escalated.** Deleting
  committed runtime artifacts interacts with how the maintainer uses OpenCode; needs a human
  decision (delete vs regenerate by enabling the runtime). Note: a plain `sync` does **not** clean a
  *disabled* runtime's projections (its generate+cleanup block is skipped) — they must be removed
  manually or by re-enabling → sync → disabling.
- **Still genuinely open (future opt-in):** emitting `.claude/skills/<name>/SKILL.md` so Claude
  *also* discovers non-pipeline skills by description — additive (more files), and must exclude the
  explicit pipeline phases to avoid out-of-sequence model auto-loading. Not pursued here.

---

## Original proposal (superseded — retained for the record)

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
