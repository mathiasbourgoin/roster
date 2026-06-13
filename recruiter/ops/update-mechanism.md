# Recruiter — Update Mechanism

Reference for Step 0 upgrade response handling and the full `/recruit update` flow.

---

## Step 0 Response

Called when `version-check.sh` outputs `ROSTER_UPGRADE_AVAILABLE <local> <remote> <auto> <runtime>`.
Capture the four values, then follow the appropriate sub-step.

### Step 0a — Auto-upgrade (when `<auto>` is `true`)

> Note: `auto_upgrade=true` makes the recruiter run the remote install script unattended
> (`curl … | bash`) — i.e. unattended remote code execution. It is off by default and requires
> both `update_check=true` and `auto_upgrade=true` in `~/.roster/config`.

Run:
```bash
curl -fsSL https://raw.githubusercontent.com/mathiasbourgoin/roster/main/scripts/install.sh | bash
```

**If successful:**
1. Write audit entry — append this line to `~/.roster/upgrade-log.jsonl` (create if absent):
   `{"ts":"<date -u +%Y-%m-%dT%H:%M:%SZ>","from":"<local>","to":"<remote>","runtime":"<runtime>"}`
2. Display changelog (Step 0c)
3. Announce: "roster auto-upgraded from v`<local>` to v`<remote>`. Reloading updated instructions..."
4. Use the Read tool to re-read the installed recruiter.md from the runtime path:
   - claude → `.claude/agents/recruiter.md`
   - opencode → `.opencode/skills/recruit/SKILL.md`
   - codex → `.agents/skills/recruit/SKILL.md`
5. Continue from **Mode Detection** in the newly loaded instructions. Do NOT re-run Step 0.

**If the command fails:**
- Display: "Auto-upgrade failed. Try manually: `curl -fsSL https://raw.githubusercontent.com/mathiasbourgoin/roster/main/scripts/install.sh | bash`"
- Continue to Mode Detection with the current version.

### Step 0b — Manual update prompt (when `<auto>` is not `true`)

Present this choice to the user:

> roster v`<remote>` is available (you have v`<local>`). What would you like to do?
> 1. Update now
> 2. Snooze 24h
> 3. Disable update checks

Use AskUserQuestion if available; otherwise present as numbered options and wait.

**If "Update now":** execute Step 0a upgrade flow above.

**If "Snooze 24h":**
- Compute `$(date +%s) + 86400` and write the result to `~/.roster/update-snoozed`
- Continue to Mode Detection normally.

**If "Disable checks":**
- Read `~/.roster/config` if it exists
- Write or replace the `update_check=false` line (preserve all other keys)
- Continue to Mode Detection normally.

### Step 0c — Changelog display (after successful upgrade)

```bash
curl -fsSL --max-time 3 --connect-timeout 2 --silent \
  "https://raw.githubusercontent.com/mathiasbourgoin/roster/main/recruiter/CHANGELOG.md" \
  2>/dev/null
```

From the output, extract lines between `## [<remote>]` and the next `## [` line. Display them
under `**What's new in v<remote>:**`. If the fetch fails or the version section is absent,
display `"Upgraded roster to v<remote>."` with no further detail.

---

## Self-Update (`/recruit update`)

When invoked with "update" (e.g., `/recruit update` or "update yourself"):

0. Resolve the update source deterministically:
   - If the `roster_local_clone` tunable path exists and contains `recruiter/recruiter.md`, use that local clone first.
   - Report: source path, current branch, `git rev-parse --short HEAD`, and whether `git status --short` is clean or dirty.
   - If the local clone is absent, fetch from the configured remote roster repo.

1. Fetch or read the latest version from the roster repo:
   ```
   https://raw.githubusercontent.com/<roster_repo>/main/recruiter/recruiter.md
   ```

2. Compare the `version` field in the fetched file vs the local installed copy.

3. If the remote version is newer:
   - Show a diff summary of what changed.
   - If the fetched file contains an `Update Notes` section, present it as a short changelog before applying the update.
   - On approval, **merge** into each local copy — do not overwrite wholesale:
     1. Extract the `tunables:` block from the current local file.
     2. Apply the remote version's body (instructions, rules, workflow).
     3. Re-inject the local `tunables:` block over the remote defaults.
     4. Remove the `Update Notes` section from the installed local copy after applying it.
     5. Write the merged result.
   - Files to update:
     - `.harness/agents/recruiter.md` (if it exists)
     - `.claude/agents/recruiter.md` (if it exists)
     - `.claude/commands/recruit.md` (if it exists)
     - `~/.claude/commands/recruit.md` (if it exists — global skill)
     - Any Codex-facing recruiter skill derived in `.agents/skills/`
   - Report what was updated and confirm local tunables were preserved.

4. If already up to date, say so.

This also updates all locally installed agents from the roster:
- For each agent in `.harness/agents/` when available, otherwise `.claude/agents/`, check if a newer version exists.
- Update canonical shared files first, then re-render runtime entrypoints.
- For Claude compatibility, run `./scripts/sync-harness.sh <project-root>` after updating canonical files.
- Preserve any local tuning (tunables overrides stay, core instructions update).

### Self-Update Report Contract

Every `/recruit update` response must end with this deterministic report. Do not omit sections
because "nothing changed"; print `none`.

```
## Recruit Update Report

Source:
  roster: <local path or remote URL>
  branch: <branch or n/a>
  commit: <short sha or n/a>
  dirty: <clean|dirty|n/a>

Recruiter:
  installed: <old version/path>
  source: <new version/path>
  action: <updated|already-current|blocked>

Agents:
  added: <list or none>
  modified: <list or none>
  removed: <list or none>

Skills:
  added: <list or none>
  modified: <list or none>
  removed: <list or none>
  expected-but-missing: <list or none>

Runtime projections:
  claude-code: <enabled/disabled> <paths written or none>
  codex: <enabled/disabled> <paths written or none>
  codex-global: <enabled/disabled> <paths written or none>
  opencode: <enabled/disabled> <paths written or none>
  copilot: <enabled/disabled> <paths written or none>

Codex visibility:
  project-local skill dir: .agents/skills
  expected format: .agents/skills/<skill-name>/SKILL.md
  present skills: <count and names>
  stale flat .md files: <list or none>
  missing expected skills: <list or none>
  restart needed: <yes/no + reason>
```

For the Codex visibility check:
- Treat `.agents/skills/<skill-name>/SKILL.md` as the project-local format.
- Treat `.agents/skills/<skill-name>.md` as stale unless the active harness explicitly documents that flat format.
- Include `recruit` in expected Codex skills when the recruiter agent is installed.
- Include any newly discovered roster skills (for example `skillq`) in `expected-but-missing` until installed or intentionally skipped.
- Say explicitly when the current Codex session may not see new skills until restart/reload, even if files were written correctly.

For runtime projections, see `runtime-paths.md` for the canonical path table.

### New Agent Discovery

After completing the self-update, compare the roster index against locally installed agents. For any roster agent not installed locally:

```
Updated recruiter to v<new>.

New in roster since your last update:
  - <agent-name> (v<version>) — <description>
  - ...

Run `/recruit` to add them, or `/harness build` for full harness setup.
```

This preserves the "no auto-install" philosophy while making new agents discoverable. The user always chooses.

### New Skill Discovery

Also check roster skills (`component_type: "skill"`, `source: "local"`) against locally installed skills in `.harness/skills/` and the runtime projections listed in the Self-Update Report Contract. For any roster skill not installed locally, surface it alongside the agent discovery report:

```
New skills available in roster:
  - roster-run (v1.0.0) — Entry point du pipeline roster
  - roster-init (v1.0.0) — Bootstrap greenfield or onboard existing project
  - roster-intake, roster-plan, roster-implement, roster-review, roster-qa, roster-ship — Full pipeline
  - roster-investigate, roster-audit — Operational skills
  - roster-skill-health, roster-skill-evolve — Skill metabolism (self-improvement)

Install the pipeline skills? They add intake→plan→implement→review→qa→ship as slash commands,
plus `/roster-init` for project bootstrapping and `/roster-skill-health` for self-improvement.
[Y/n]
```

On approval, install using the following concrete procedure:

**Step 1 — Create target directories:**
```bash
mkdir -p .harness/skills .claude/commands .agents/skills
```

**Step 2 — Fetch the shared preamble:**
```bash
ROSTER_RAW="https://raw.githubusercontent.com/<roster_repo>/main"
PREAMBLE=$(curl -sL "$ROSTER_RAW/skills/shared/preamble.md")
```

**Step 3 — Install each skill:**

Skills to install:
- `skills/pipeline/roster-run.md`
- `skills/pipeline/roster-init.md`
- `skills/pipeline/roster-question.md`
- `skills/pipeline/roster-research.md`
- `skills/pipeline/roster-intake.md`
- `skills/pipeline/roster-spec.md`
- `skills/pipeline/roster-plan.md`
- `skills/pipeline/roster-implement.md`
- `skills/pipeline/roster-review.md`
- `skills/pipeline/roster-qa.md`
- `skills/pipeline/roster-ship.md`
- `skills/pipeline/roster-investigate.md`
- `skills/pipeline/roster-audit.md`
- `skills/pipeline/roster-doctor.md`
- `skills/pipeline/roster-triage-critical.md`
- `skills/pipeline/roster-spec-formal.md`
- `skills/pipeline/roster-formal-verify.md`
- `skills/meta/roster-skill-health.md`
- `skills/meta/roster-skill-evolve.md`
- `skills/meta/roster-upgrade.md`
- `skills/kb/ambiguity-auditor.md`
- `skills/kb/code-quality-auditor.md`
- `skills/kb/harness-validator.md`
- `skills/kb/kb-migrate.md`
- `skills/kb/kb-reindex.md`
- `skills/kb/kb-search.md`
- `skills/kb/kb-update.md`
- `skills/kb/roster-spec-infer.md`
- `skills/kb/spec-compliance-auditor.md`
- `skills/workflow/git-conventions.md`
- `skills/workflow/improvement-loop.md`
- `skills/workflow/improvement-loop-planner.md`
- `skills/workflow/roster-config.md`
- `skills/workflow/team.md`
- `skills/testing/tdd-workflow.md`
- `skills/media/image-generation.md`

For each skill at path `<skill-path>` with filename `<name>.md`:
```bash
SKILL_CONTENT=$(curl -sL "$ROSTER_RAW/<skill-path>")

# Check if preamble: true in frontmatter
if echo "$SKILL_CONTENT" | grep -q "^preamble: true"; then
  PROJECTED="${PREAMBLE}

---

${SKILL_CONTENT}"
else
  PROJECTED="$SKILL_CONTENT"
fi

# Write canonical copy
echo "$SKILL_CONTENT" > .harness/skills/<name>.md

# Write projected copies (with preamble injected)
echo "$PROJECTED" > .claude/commands/<name>.md
mkdir -p .agents/skills/<name>
echo "$PROJECTED" > .agents/skills/<name>/SKILL.md

# Optional only when codex-global is explicitly enabled:
# mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/<name>"
# echo "$PROJECTED" > "${CODEX_HOME:-$HOME/.codex}/skills/<name>/SKILL.md"
```

**Step 4 — Verify:**
```bash
find .agents/skills -maxdepth 2 -name SKILL.md
```

If `.harness/` or `.claude/` do not exist (e.g., Codex-only environment), write only to the
configured Codex runtime entrypoint and skip the other targets — do not fail.

**Note on preamble injection:** The preamble (`skills/shared/preamble.md`) encodes the project's
shared ethos (anti-sycophancy, completeness, user sovereignty, friction log instructions). It must
be injected after frontmatter for all skills where `preamble: true` appears in the frontmatter YAML
block. Skills without this field or with `preamble: false` are written as-is.

**Runtime note:** OpenCode and Copilot each have a dedicated renderer in `sync-harness.sh`. Enable
them in `.harness/harness.json` (`"enabled": true`) and re-run `sync-harness.sh`. OpenCode uses
flat `.md` files; Copilot uses `.github/copilot-instructions.md` + per-agent `.github/instructions/`
files.

---

## Team Re-Adaptation (major version updates)

When updating across a major version boundary (e.g., 1.x → 2.x), run a team re-adaptation audit
after the recruiter itself is updated.

**Trigger condition:** installed version < 2.0.0 and new version ≥ 2.0.0.

**Audit checklist:**

1. **Human-validation rule** — Is `human-validation.md` present in `.harness/rules/` and `.claude/rules/`? If not: propose installing it. This is load-bearing — without it, no agent knows the quiz protocol.
2. **Planner agent** — Is `planner.md` installed? If not: propose installing it.
3. **Tech-lead version** — Is the installed tech-lead ≥ 1.6.0? If not: propose updating it.
4. **Pipeline role fields** — For each installed agent, is `pipeline_role` frontmatter present? List missing ones.
5. **Spawn request awareness** — Do tech-lead and planner include the `SPAWN REQUEST` block format?
6. **Execution model explanation** — Does AGENTS.md explain Mode A/B execution?

**Present findings as a table:**

```
## Team Re-Adaptation Required

| Check | Status | Proposed Action |
|-------|--------|-----------------|
| human-validation rule | MISSING | Install from roster |
| planner agent | MISSING | Install from roster (developer profile) |
| tech-lead version | v1.5.0 (outdated) | Update to v1.6.0 |
| implementer pipeline_role | MISSING | Layer 2 patch — ask for pipeline position |
| qa pipeline_role | MISSING | Layer 2 patch — ask for pipeline position |
| spawn request format | MISSING in tech-lead | Covered by tech-lead update |
| execution model in AGENTS.md | MISSING | Propose adding Mode A/B summary |

Accept all? Accept selectively? Skip?
```

Run the human validation quiz on the proposed re-adaptation before applying any changes. The trap
should target the most dangerous assumption: e.g., "I'm planning to keep the existing team as-is
and just install the new rule — does that cover the new process?" (No — old agents without pipeline
patches won't produce spawn requests in the correct format.)
