# Spec — roster-auto-update

**Date:** 2026-05-27
**Status:** LIVE
**Intake brief:** briefs/roster-auto-update-intake.md

---

## Clarifications

| # | Question | Resolution |
|---|---|---|
| Q-1 | Which version number does the update track? | Recruiter version from `recruiter.md` frontmatter (`version: 2.7.0`), NOT `package.json`. VERSION file at repo root mirrors the recruiter frontmatter version. |
| Q-2 | Is `raw.githubusercontent.com` rate-limited? | No — raw content requests are not subject to the 60 req/hr API rate limit. |
| Q-3 | How does update avoid blocking? | `curl --max-time 3 --connect-timeout 2 --silent --fail` — fails in under 3 s; failure = silent skip. |
| Q-4 | Where does the AI enforce Step 0 execution? | Moved from detached preamble to explicit `## Step 0: Version Check` in the recruiter's main flow, with "MANDATORY — run before any other step" instruction. |
| Q-5 | What happens if no sentinel exists? | Skip check silently — sentinel absence = fresh install without tracking. No error, no warning. |
| Q-6 | What CHANGELOG format? | Keep a Changelog (`## [x.y.z] - date`). Extract text between first `## [` line and next `## [` line. Fallback to generic message on parse failure. |
| Q-7 | Auto-upgrade audit trail? | On every auto-upgrade: append `{"ts":"<ISO>","from":"<v>","to":"<v>","runtime":"<name>"}` to `~/.roster/upgrade-log.jsonl`. |

---

## User Stories

### US-1: Version check on invocation (Priority: P0)

As a developer using any roster-supported runtime, I want the recruiter to check for
a newer version at the start of each session, so I am notified when an update is
available without having to remember to run `/recruit update` manually.

**Why this priority**: Core value proposition — silent staleness is the problem being solved.

**Scope**: This story does NOT cover the upgrade action itself (US-2) or changelog display (US-5).
The check only reads and compares — it does not write or fetch the new skill.

**Independent Test**: Invoke recruiter with a sentinel file containing an old version — verify
the recruiter outputs the upgrade notification message before doing anything else.

**Acceptance Scenarios**:

1. **Given** `.claude/.roster-version` contains `2.6.0` and GitHub `VERSION` returns `2.7.0`,
   **When** the user runs `/recruit`,
   **Then** the recruiter's first visible output is a notification: "roster v2.7.0 available (you have v2.6.0). Update? [Update now / Snooze 24h / Disable checks]"

2. **Given** `.claude/.roster-version` contains `2.7.0` and GitHub `VERSION` returns `2.7.0`,
   **When** the user runs `/recruit`,
   **Then** no update notification appears — the recruiter proceeds normally.

3. **Given** the GitHub raw URL is unreachable (network error / timeout after 3 s),
   **When** the user runs `/recruit`,
   **Then** no update notification appears and no error is shown — the recruiter proceeds normally.

4. **Given** `~/.roster/update-snoozed` contains a future epoch timestamp,
   **When** the user runs `/recruit`,
   **Then** no update notification appears (snooze is active).

5. **Given** `~/.roster/config` contains `update_check=false`,
   **When** the user runs `/recruit`,
   **Then** no update notification appears — check is permanently disabled.

6. **Given** no sentinel file exists for the detected runtime,
   **When** the user runs `/recruit`,
   **Then** no update notification appears — check is silently skipped.

---

### US-2: User-controlled update response (Priority: P0)

As a developer notified of an available update, I want to choose between updating now,
snoozing for 24 hours, or disabling checks permanently, so the workflow fits my preferences
without forcing an immediate update or repeated nagging.

**Why this priority**: Without response control, any notification becomes noise. Users who
ignore it on a deadline will switch off entirely if there's no snooze.

**Scope**: This story does NOT cover auto-upgrade (US-3). The user is always asked.

**Independent Test**: Trigger an update notification. Choose "Snooze 24h". Re-invoke
within 24 h — verify no notification appears. Re-invoke after 24 h — verify notification
reappears.

**Acceptance Scenarios**:

1. **Given** an update is available and user selects "Update now",
   **When** the recruiter executes the update,
   **Then** it runs `curl -fsSL .../install.sh | bash`, then displays the changelog entry for the new version, then the recruiter restarts (or instructs the user to re-invoke) — the update does NOT continue the current invocation.

2. **Given** an update is available and user selects "Snooze 24h",
   **When** the recruiter handles the choice,
   **Then** it writes `epoch_now + 86400` to `~/.roster/update-snoozed` and proceeds with the current invocation normally.

3. **Given** an update is available and user selects "Disable checks",
   **When** the recruiter handles the choice,
   **Then** it writes `update_check=false` to `~/.roster/config` (creating the file if absent) and proceeds normally. Future invocations skip the check entirely.

4. **Given** an update is available and the install.sh update command fails (non-zero exit),
   **When** the recruiter handles the failure,
   **Then** it displays: "Update failed. Try manually: `curl -fsSL https://raw.githubusercontent.com/mathiasbourgoin/roster/main/scripts/install.sh | bash`" and proceeds with the current invocation.

---

### US-3: Auto-upgrade mode (Priority: P1)

As a developer who trusts roster releases and wants zero interruption, I want to enable
an auto-upgrade flag so updates are applied silently on the first invocation where a new
version is detected.

**Why this priority**: Power-user feature. Default-off. Enabling it is the explicit human
approval for autonomous upgrades, so no escalation rule is violated.

**Scope**: Does NOT apply unless `auto_upgrade=true` is explicitly set in `~/.roster/config`.
Does NOT bypass the audit log.

**Independent Test**: Set `auto_upgrade=true`. Invoke recruiter with old sentinel — verify
upgrade runs without prompting, audit log is written, and recruiter announces upgrade.

**Acceptance Scenarios**:

1. **Given** `~/.roster/config` contains `auto_upgrade=true` and an update is available,
   **When** the user runs `/recruit`,
   **Then** the recruiter runs the update silently, writes to `~/.roster/upgrade-log.jsonl`,
   displays "Auto-upgraded roster to v{new}. {changelog snippet}." and continues.

2. **Given** `~/.roster/config` contains `auto_upgrade=true` and the update fails,
   **When** the recruiter handles the failure,
   **Then** it does NOT silently swallow the failure — it displays the error and the manual command, then continues with the old version.

3. **Given** `auto_upgrade=true` and the upgrade succeeds,
   **When** inspecting `~/.roster/upgrade-log.jsonl`,
   **Then** a new line exists: `{"ts":"<ISO-8601>","from":"2.6.0","to":"2.7.0","runtime":"claude"}`.

---

### US-4: Multi-runtime sentinel installation (Priority: P0)

As a developer using roster across multiple AI runtimes, I want the version sentinel to
be written for every runtime I have installed, so the update check works regardless of
which runtime I use.

**Why this priority**: Without this, only Claude Code users get update checks.

**Scope**: Sentinels are written at install time only — the recruiter reads them at runtime.
This story covers the install.sh changes, not the recruiter logic.

**Independent Test**: Run install.sh with a project that has both `.claude/` and `.opencode/`
present. Verify both `.claude/.roster-version` and `.opencode/.roster-version` contain the
correct version string.

**Acceptance Scenarios**:

1. **Given** a project with `.claude/` present, **When** `install.sh` runs,
   **Then** `.claude/.roster-version` is created containing exactly the recruiter version string (e.g., `2.7.0`), no trailing whitespace or extra lines.

2. **Given** a project with `.opencode/` present, **When** `install.sh` runs,
   **Then** `.opencode/.roster-version` is created with the same version string.

3. **Given** a project with `.agents/skills/recruit/` present (Codex), **When** `install.sh` runs,
   **Then** `.agents/skills/recruit/.roster-version` is created.

4. **Given** a project with `.pi/skills/recruit/` present, **When** `install.sh` runs,
   **Then** `.pi/skills/recruit/.roster-version` is created.

5. **Given** a Codex global install (`~/.codex/skills/recruit/`), **When** `install.sh` runs,
   **Then** `~/.codex/skills/recruit/.roster-version` is created.

6. **Given** a runtime directory does not exist at install time (e.g., no `.opencode/`),
   **When** `install.sh` runs,
   **Then** no sentinel is created for that runtime, and no error is produced.

---

### US-5: Changelog display after upgrade (Priority: P1)

As a developer who just upgraded, I want to see a brief "What's new" summary from the
changelog, so I can quickly understand what changed without reading GitHub.

**Why this priority**: Enhances upgrade UX. Avoids the "what did that update do?" question.

**Scope**: Does NOT parse arbitrary changelog formats — Keep a Changelog format only.
Fallback message is acceptable for any parse failure.

**Independent Test**: Trigger an upgrade. Verify the changelog section for the new version
appears in the recruiter's response.

**Acceptance Scenarios**:

1. **Given** CHANGELOG.md on GitHub main has a `## [2.7.0] - 2026-05-27` section,
   **When** an upgrade to v2.7.0 completes,
   **Then** the recruiter displays the content of that section (stripped of markdown headers)
   under a "What's new in v2.7.0:" label.

2. **Given** CHANGELOG.md is absent or unreachable,
   **When** an upgrade completes,
   **Then** the recruiter displays "Upgraded roster to v2.7.0." with no changelog content.
   No error is shown.

3. **Given** CHANGELOG.md exists but has no entry for the new version,
   **When** an upgrade completes,
   **Then** fallback: "Upgraded roster to v2.7.0." No error shown.

---

## Challenges

| # | Story | Severity | Challenge | Resolution |
|---|---|---|---|---|
| C-1 | US-1 | RESOLVED | Network calls in preamble may be unavailable | curl --max-time 3 --silent --fail; failure = skip. gstack precedent. |
| C-2 | US-1 | RESOLVED | GitHub rate limits | raw.githubusercontent.com is not rate-limited |
| C-3 | US-1 | RESOLVED | Slow network blocks skill | --max-time 3 --connect-timeout 2; skip on timeout |
| C-4 | US-1 | RESOLVED | No VERSION file baseline | Create VERSION at repo root with `2.7.0` |
| C-5 | US-1 | RESOLVED | Which GitHub endpoint | Plain VERSION file at raw GitHub URL |
| C-6 | US-2 | RESOLVED | Persistent state across sessions | ~/.roster/ directory (cross-runtime, same machine) |
| C-7 | US-2 | RESOLVED | install.sh not local post-install | Fetch install.sh fresh via curl, not from local path |
| C-8 | US-2 | RESOLVED | Overwriting currently-executing file | File already loaded in AI context; replacement takes effect next invocation |
| C-9 | US-2 | RESOLVED | Disable config persists across updates | ~/.roster/config is not installed by install.sh; never overwritten |
| C-10 | US-3 | RESOLVED | Auto-upgrade without human approval | Defaults false; enabling = explicit human opt-in = approval |
| C-11 | US-3 | RESOLVED | No audit trail on silent upgrade | ~/.roster/upgrade-log.jsonl written on every auto-upgrade |
| C-12 | US-3 | RESOLVED | Flag location unspecified | ~/.roster/config (key=value, shell-parseable) |
| C-13 | US-4 | RESOLVED | Pi runtime sentinel path | .pi/skills/recruit/.roster-version |
| C-14 | US-4 | RESOLVED | Sentinel format unspecified | Plain semver string, no trailing whitespace |
| C-15 | US-4 | RESOLVED | Runtime dir absent at install | Skip silently; no sentinel written; check skips on absent sentinel |
| C-16 | US-5 | RESOLVED | CHANGELOG.md format | Keep a Changelog format; fallback to generic message |
| C-17 | US-5 | RESOLVED | Changelog display in AI output | Displayed as text in recruiter response; no special contract needed |
| C-18 | US-1,2,3 | RESOLVED | AI may not execute preamble bash blocks | Moved to explicit `## Step 0: Version Check` with MANDATORY label in recruiter flow |

---

## Edge Cases

| # | Story | Edge case |
|---|---|---|
| EC-1 | US-1 | `~/.roster/` dir does not exist → create it on first write |
| EC-2 | US-1 | GitHub returns a version string with trailing newline → trim before compare |
| EC-3 | US-1 | GitHub returns a non-semver string → treat as unknown → skip check |
| EC-4 | US-2 | User selects update but no internet → install.sh curl fails → display manual command |
| EC-5 | US-2 | `~/.roster/config` already exists with other keys → append/update `update_check=false`, preserve other keys |
| EC-6 | US-3 | Both `update_check=false` and `auto_upgrade=true` → update_check=false wins (check disabled) |
| EC-7 | US-4 | Codex global dir at `$CODEX_HOME` env var → install to `$CODEX_HOME/skills/recruit/.roster-version` |
| EC-8 | US-5 | CHANGELOG has the new version but entry is empty (no bullets) → display "No details available" |

---

## Design Confidence

**Score:** 8/10
**Evidence:** 18 challenges resolved, 8 edge cases covered, 5 user stories with concrete GWT scenarios.
Minor confidence reduction: AI interpretation of Step 0 cannot be formally enforced (C-18 mitigation is best-effort); changelog parsing brittleness if format diverges from Keep a Changelog.
