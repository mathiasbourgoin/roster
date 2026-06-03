# Integration Verification

Several roster flows are **LLM-executed prose** (a runtime agent interprets the skill), so they
can't be fully unit-tested. This page separates what is **automated** from what needs a
**manual live-runtime** check.

## Automated (run by `npm test`)

- **`scripts/check-pipeline-install.js`** — guards the install-path references the prose flows
  depend on:
  - the recruiter's "Skills to install" list is in exact sync with `skills/pipeline` +
    `skills/meta` on disk (no skill silently skipped on first run; no listed path missing →
    no install-time fetch failure);
  - every roster-managed `.codex/agents/*.toml` carries `name`/`description`/`developer_instructions`.
- **`scripts/check-recruiter-sync.js`** — recruiter source ↔ projections, incl. the version marker.
- **`bash scripts/sync-harness.sh --check`** — all runtime projections match `.harness/` source.
- **`scripts/check-hook-structure.js` / `check-skill-structure.js`** — hook + skill structure,
  `on_error` values, frontmatter YAML validity.

## Manual (needs a live runtime — verify before a release)

These cannot run offline/deterministically; check them on a real runtime when changing the
install path, Codex projection, preflight, or cross-runtime review:

1. **Fresh install installs the pipeline (the #2 happy-path fix).**
   In a throwaway project: `curl -fsSL …/install.sh | bash`, then run `/recruit` (Claude) — accept the
   first-run "install the roster pipeline skills?" prompt — and confirm `/roster-run`,
   `/roster-spec`, etc. now exist (`.claude/commands/roster-*.md` present).
2. **Codex loads the agent team.**
   In a Codex project with the harness synced, confirm Codex discovers `.codex/agents/*.toml`
   as spawnable subagents and `.agents/skills/<agent>/SKILL.md` as `$name`-invocable skills.
3. **`roster-run` Step 1.5 preflight halts a broken env.**
   In a project whose test/lint tool is missing, start `/roster-run <impl task>` and confirm
   `/roster-doctor preflight` returns `NOT-READY` and the pipeline stops before implementation.
4. **Cross-runtime review augments, never rewrites.**
   With a second runtime CLI on `PATH` (`codex` or `opencode`), run `/roster-review` and
   confirm it shells out and appends a `cross_runtime_findings` array to `review.json` without
   editing the primary `findings`.
5. **Plugin marketplace install.** In Claude Code: `/plugin marketplace add mathiasbourgoin/roster`
   then `/plugin install roster@roster`; confirm `/roster:recruit` (and the `/roster:roster-*`
   commands) appear. The plugin sources from `./.claude`; `.claude-plugin/marketplace.json` +
   `.claude/.claude-plugin/plugin.json` are JSON-validated in CI but the live load is not.
6. **npx-from-git install.** `npx github:mathiasbourgoin/roster --runtime claude` in a throwaway
   project installs the recruiter (the `bin` runs `scripts/install.sh`). Needs the branch pushed.

> When any manual item is verified for a release, note the runtime + version here.
