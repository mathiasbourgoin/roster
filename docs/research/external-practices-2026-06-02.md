# Brief — External Claude Code practices worth lifting into roster

- **Date:** 2026-06-02 (rewritten 2026-06-03 after the original was removed from the working tree — likely a `git clean`/checkout by the agent concurrently working on roster; the file was untracked)
- **Status:** Analysis only — NOT YET IMPLEMENTED. Another agent is currently working on roster; apply later.
- **Origin:** Triggered by a colleague's claim that `multica-ai/andrej-karpathy-skills` reduces token consumption.
- **Method:** 4 parallel sub-agents mined `shanraisshan/claude-code-best-practice` (a curated index) and its linked methodology repos; each practice was cross-checked against roster's existing capabilities. Sub-agent intermediate context was discarded (context-budget discipline); only conclusions are recorded here.

> ⚠️ This file is untracked. To avoid losing it again to a concurrent `git clean`, consider `git add briefs/external-practices-2026-06-02.md` (or stash) until it's reviewed.

## Sources reviewed

- `multica-ai/andrej-karpathy-skills` — a single behavioral `CLAUDE.md` (4 principles). No benchmarks; never claims token savings.
- `shanraisshan/claude-code-best-practice` — curated index (README + settings/hooks/permissions reference). Mostly links out.
- Linked methodologies: `github/spec-kit`, `Fission-AI/OpenSpec`, `bmad-code-org/BMAD-METHOD`, `buildermethods/agent-os`, `obra/superpowers`, `mattpocock/skills`, `EveryInc/compound-engineering-plugin`, `shanraisshan/ralph-wiggum-self-evolving-loop` + `ghuntley/how-to-ralph-wiggum`, `humanlayer/humanlayer`.

## Top-line verdict

Roster is already more mature than ~80% of these projects. Its phased pipeline (intake → blind research → adversarial spec GWT/FR-NNN → dual-voice plan → TDD → review GO/NO-GO → QA → ship), KB auditors, skill-health→skill-evolve loop, and especially the human-validation protocol (quiz + consistency-check trap) exceed what these repos offer. Most content is redundant.

The originating "reduces tokens" claim is **unmeasured everywhere** — no repo benchmarks its assertions (118-line PR median, <40% context, "build 20-30 versions"). The only practice with a direct token↔mechanism link is mattpocock's CONTEXT.md / caveman mode, and even that is unmeasured.

## Worth lifting (ranked)

### 1. Diff-scope discipline — resolves an existing contradiction (effort: ~5 lines)
- **From:** Karpathy `CLAUDE.md` #3 "Surgical Changes" — *"Every changed line should trace directly to the user's request"*; *"If you notice unrelated dead code, mention it — don't delete it."*
- **Gap:** `rules/code-quality.md` says *"No dead code. If code is commented out, delete it."* → pushes the agent to delete **pre-existing** dead code out of scope, in tension with `rules/escalation.md` ("overwriting files outside the current task scope" requires confirmation).
- **Fix:** add a diff-scope clause distinguishing *your* orphans (clean up) from *pre-existing* dead code (flag, don't touch). Put it in `code-quality.md` or `escalation.md`.

### 2. CONTEXT.md — domain-language glossary (effort: medium)
- **From:** `mattpocock/skills` (CONTEXT.md = ubiquitous language doc; claims big verbosity reduction).
- **Gap:** roster KB has spec/properties/architecture but **no glossary**. A term defined once avoids re-explaining it every phase — the most token-relevant item, tying back to the original question.
- **Caveat / dedup check:** cross-reference `ambiguity-auditor` (already detects undefined terms) before adding — decide whether this is a new KB artifact (`kb/glossary.md`) or an extension of an existing auditor's output. Do not duplicate.

### 3. Async approval + audit trail (effort: medium)
- **From:** `humanlayer/humanlayer` (omnichannel approval routing — Slack/email — and recorded decisions).
- **Gap:** roster's human-validation is *richer* (quiz) but **chat-only and leaves no audit trail**. Slack MCP is already available in this environment.
- **Note:** keep roster's quiz/trap as the decision mechanism; only add (a) optional async routing and (b) a recorded decision log. Do NOT replace the quiz with humanlayer's binary approve/reject — that is a downgrade.

### 4. Vertical-slice / tracer-bullet delivery (effort: low)
- **From:** `shanraisshan/claude-code-best-practice` + `gsd-build/get-shit-done`.
- **Gap:** roster optimizes the *diff* within a task but says nothing about the *shape* of work decomposition. Vertical slice = one end-to-end feature (DB→API→UI) per deliverable, not layer-by-layer. (This is what was misremembered as "small PRs" — it's about PR shape, not size.)
- **Place:** `git-conventions` skill or the plan-decomposition phase.

### 5. Operational hardening (effort: low)
- **From:** `shanraisshan/claude-code-best-practice` settings/hooks/permissions reference.
- **Items:** `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` (strip creds from subprocess env), `CLAUDE_CODE_SCRIPT_CAPS` (per-script run limits), deny-rules as primary safety layer (highest precedence), `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (matches roster's documented 40% threshold).
- **Gap:** `rules/context-budget.md` *describes* the 40% threshold but doesn't *configure* autocompact; `rules/escalation.md` is declarative, not enforced by deny-rules. These would make existing rules actually enforced.

## Explicitly do NOT adopt

- **Fluid / cherry-pickable gates** (OpenSpec, agent-os) — directly contradict roster's load-bearing human-validation and GO/NO-GO gates. Relaxing them trades the core guarantee for "flexibility".
- **Ralph Wiggum "until-done" autonomous loop** — roster's `improvement-loop` is bounded + verification-first by design (safer). Only the negative lesson is worth keeping: **never use LLM consensus as a completion signal** (N copies of the same model validating each other = circular). Record as a guardrail in `improvement-loop-planner`.
- **Personas/icons (BMAD), web-to-IDE parity** — cosmetic or high-maintenance, no structural gain.
- **"Build 20-30 versions instead of specs"** — opposite of roster's adversarial spec phase.

## Lower-priority / niche (note, don't act yet)

- **Spec-kit Constitution layer** — largely covered by roster's `rules/`. Skip unless a formal pre-spec governance artifact is wanted.
- **OpenSpec delta-specs (ADDED/MODIFIED/REMOVED) + change folders** — elegant for brownfield, but collides with roster's per-task spec model. Revisit only if brownfield-heavy work dominates.
- **BMAD two-spine UX model (DESIGN tokens + EXPERIENCE flow)** — only relevant if roster takes on UI-design work.
- **Compound engineering "compounding learnings" phase + pulse-reports** — roster's `learn` + skill-health partially cover this; the explicit pattern-capture phase and time-windowed user-outcome snapshots are the only net-new bits. Low priority.

## Suggested first cut (when picked up)

Items **1, 2, 5** are the lowest-risk, highest-leverage. Implement behind roster's human-validation protocol. Items 3 and 4 are larger and can follow.
