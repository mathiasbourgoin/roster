# Runtime Path Reference

Canonical paths for each supported runtime. Used by the Self-Update Report Contract and
Mode 1 installation.

| Runtime | Agents | Skills / Commands | Config |
|---|---|---|---|
| Claude Code | `.claude/agents/*.md` | `.claude/commands/*.md`, `.claude/rules/*.md` | `.claude/harness.json` |
| Codex project | — | `.agents/skills/<name>/SKILL.md` | — |
| Codex global | — | `$CODEX_HOME/skills/<name>/SKILL.md` (only if `codex-global` enabled) | — |
| OpenCode | `.opencode/agents/*.md` | `.opencode/skills/<name>/SKILL.md` | `opencode.json` |
| Copilot | — | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | — |

Notes:
- Copilot has no dynamic skill loader — files must be written manually.
- Codex global install uses `$CODEX_HOME` env var (default: `~/.codex`).
- The canonical shared harness lives under `.harness/` — runtime paths are projections of it.
- `.roster-version` and `.roster-channel` sentinel files are stamped alongside the recruiter in each runtime directory.
