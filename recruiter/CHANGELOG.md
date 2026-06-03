# Recruiter Changelog

All notable changes to the roster recruiter skill are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.6.0] — 2026-06-03

### Added

- **First-run pipeline-skill installation.** On team assembly (Mode 1), the recruiter now offers
  to install the full roster-* pipeline skill set (intake → spec → plan → implement → review →
  qa → ship, plus the meta skills), so `/roster-run` and the rest of the pipeline exist
  immediately instead of leaving a recruiter-only, half-installed setup.

---

## [2.5.2] — 2026-05-27

### Added

- **Automatic update checking** (Step 0): On every `/recruit` invocation, the recruiter
  silently checks GitHub for a newer version. If one is available, you are offered three
  options: update now, snooze for 24h, or disable checks permanently.
- **Auto-upgrade mode**: Set `auto_upgrade=true` in `~/.roster/config` to apply updates
  silently without prompting. Every auto-upgrade is logged to `~/.roster/upgrade-log.jsonl`.
- **Multi-runtime sentinel files**: `install.sh` now writes a `.roster-version` file for
  each detected runtime, enabling version tracking across Claude Code, OpenCode, Codex,
  Codex global, and Pi.
- **Changelog display after upgrade**: After a successful upgrade, the recruiter shows the
  "What's new" section from this changelog.
- **Post-upgrade reload**: After upgrading, the recruiter re-reads its own installed file
  and continues from Step 1 using the new version — no need to re-invoke `/recruit`.

---

## [2.5.1] — 2026-05-01

### Added

- Initial recruiter release tracking.
