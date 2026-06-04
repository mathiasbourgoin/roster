#!/usr/bin/env bash
# Comprehensive QA for scripts/install.sh

set -euo pipefail

INSTALL_SH="$(cd "$(dirname "$0")" && pwd)/install.sh"
MOCK_ROOT="/tmp/roster-mock-raw"
WORK_DIR="/tmp/roster-install-qa"
FAKE_CODEX_HOME="/tmp/roster-fake-codex-home"
PASS=0
FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
pass() { echo -e "${GREEN}  PASS${RESET} $*"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  FAIL${RESET} $*"; FAIL=$((FAIL+1)); }
section() { echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Mock RAW server (file://) ──────────────────────────────────────────────────
# Mirror exactly the paths install.sh fetches from ${RAW}: the Claude agent + command, and the
# single rendered SKILL.md that OpenCode, Codex, and Codex-global all install. A stale mock that
# omits a fetched path makes the patched install fail (curl -f) — keep this in sync with install.sh.
rm -rf "$MOCK_ROOT"
mkdir -p "$MOCK_ROOT/recruiter" "$MOCK_ROOT/.claude/commands" "$MOCK_ROOT/.agents/skills/recruit"
echo "# mock recruiter"       > "$MOCK_ROOT/recruiter/recruiter.md"          # → .claude/agents/recruiter.md
echo "# mock recruit command" > "$MOCK_ROOT/.claude/commands/recruit.md"     # → .claude/commands/recruit.md
echo "# mock recruit skill"   > "$MOCK_ROOT/.agents/skills/recruit/SKILL.md" # → opencode/codex SKILL.md
# VERSION served at the mock RAW root. The patched install lives in /tmp with no adjacent VERSION,
# so it exercises the curl|bash path: resolve_version() must FETCH this and stamp it (not fall back).
MOCK_VERSION="9.9.9-mock"
echo "$MOCK_VERSION" > "$MOCK_ROOT/VERSION"                                   # → ${RAW}/VERSION

# Patched install.sh: override RAW + always use fake CODEX_HOME
PATCHED_SH="/tmp/install-patched.sh"
sed \
  -e "s|RAW=\"https://raw.githubusercontent.com/\${REPO}/\${BRANCH}\"|RAW=\"file://${MOCK_ROOT}\"|g" \
  -e "s|\${CODEX_HOME:-\$HOME/.codex}|${FAKE_CODEX_HOME}|g" \
  "$INSTALL_SH" > "$PATCHED_SH"
chmod +x "$PATCHED_SH"

# Run install with isolated CODEX_HOME
run_install() {
  local dir="$1"; shift
  (cd "$dir" && CODEX_HOME="$FAKE_CODEX_HOME" bash "$PATCHED_SH" "$@" 2>&1)
}

# Run an install that is expected to SUCCEED, and assert the installer's EXIT CODE is 0 — not just
# that files landed. The silent-exit bug this suite guards (install.sh dying under set -e before
# printing) is precisely a non-zero exit; file-existence checks alone would miss an installer that
# writes files and *then* errors. Since the test body runs under `set +e`, we capture status here.
# Usage: expect_install_ok "<label>" "<dir>" [install flags...]
expect_install_ok() {
  local label="$1"; shift
  local output status
  output=$(run_install "$@" 2>&1); status=$?
  [ "$status" -eq 0 ] && pass "$label: install exited 0" \
    || fail "$label: install exited $status (expected 0)\n    output: $output"
}

fresh() {
  local name="$1"; shift
  local dir="$WORK_DIR/$name"
  rm -rf "$dir" && mkdir -p "$dir"
  for d in "$@"; do mkdir -p "$dir/$d"; done
  # Reset fake codex home each time
  rm -rf "$FAKE_CODEX_HOME"
  echo "$dir"
}

# Setup is done. A QA harness must run EVERY check and tally pass/fail — not abort on the first
# failing assertion (that was the original "aborts early" behavior). Drop -e for the test body;
# keep -u and pipefail. Each check reports via pass/fail and the suite always reaches the summary.
set +e

# ─────────────────────────────────────────────────────────────────────────────
section "1. No runtimes detected"
dir=$(fresh "no-runtime")
output=$(run_install "$dir" 2>&1 || true)
echo "$output" | grep -q "No runtimes detected" \
  && pass "warns when no runtimes found" \
  || fail "expected 'No runtimes detected'\n    got: $output"

# ─────────────────────────────────────────────────────────────────────────────
section "2. Claude Code only"
dir=$(fresh "claude-only" ".claude")
expect_install_ok "claude-only" "$dir"
[ -f "$dir/.claude/agents/recruiter.md" ]  && pass ".claude/agents/recruiter.md created"  || fail ".claude/agents/recruiter.md missing"
[ -f "$dir/.claude/commands/recruit.md" ]  && pass ".claude/commands/recruit.md created"  || fail ".claude/commands/recruit.md missing"
grep -q "mock recruiter" "$dir/.claude/agents/recruiter.md" \
  && pass "claude content correct" || fail "claude content wrong"

# ─────────────────────────────────────────────────────────────────────────────
section "3. OpenCode only"
# OpenCode installs the rendered SKILL.md via native skill discovery (.opencode/skills/recruit/),
# NOT a Claude-style agent file — see install_opencode() in install.sh.
dir=$(fresh "opencode-only" ".opencode")
expect_install_ok "opencode-only" "$dir"
[ -f "$dir/.opencode/skills/recruit/SKILL.md" ]        && pass ".opencode/skills/recruit/SKILL.md created" || fail "missing"
[ -f "$dir/.opencode/skills/recruit/.roster-managed" ] && pass ".roster-managed sentinel"                  || fail ".roster-managed missing"
grep -q "mock recruit skill" "$dir/.opencode/skills/recruit/SKILL.md" \
  && pass "opencode content correct" || fail "opencode content wrong"

# ─────────────────────────────────────────────────────────────────────────────
section "4. Codex (project-local) only"
dir=$(fresh "codex-only" ".agents")
expect_install_ok "codex-only" "$dir"
[ -f "$dir/.agents/skills/recruit/SKILL.md" ]         && pass "SKILL.md created"            || fail "SKILL.md missing"
[ -f "$dir/.agents/skills/recruit/.roster-managed" ]  && pass ".roster-managed sentinel"    || fail ".roster-managed missing"
[ ! -f "$dir/.agents/skills/recruit/.agent-roster-managed" ] \
  && pass "old sentinel name NOT used (rename clean)"  || fail "old .agent-roster-managed still present"

# ─────────────────────────────────────────────────────────────────────────────
section "5. Codex global"
dir=$(fresh "codex-global")
mkdir -p "$FAKE_CODEX_HOME/skills"
expect_install_ok "codex-global" "$dir"
[ -f "$FAKE_CODEX_HOME/skills/recruit/SKILL.md" ]        && pass "codex-global SKILL.md" || fail "codex-global SKILL.md missing"
[ -f "$FAKE_CODEX_HOME/skills/recruit/.roster-managed" ] && pass "codex-global sentinel" || fail "codex-global sentinel missing"

# ─────────────────────────────────────────────────────────────────────────────
section "6. VERSION resolution via \${RAW}/VERSION (curl|bash path)"
# The patched installer has no adjacent VERSION (it lives in /tmp), so resolve_version() must fetch
# ${RAW}/VERSION from the mock and stamp THAT — proving the stamped version tracks the install ref
# instead of silently using the hardcoded fallback.
dir=$(fresh "version-fetch" ".claude")
expect_install_ok "version-fetch" "$dir"
stamped="$(tr -d '[:space:]' < "$dir/.claude/.roster-version" 2>/dev/null || true)"
[ "$stamped" = "$MOCK_VERSION" ] \
  && pass ".roster-version fetched from \${RAW}/VERSION ($stamped)" \
  || fail ".roster-version is '$stamped', expected '$MOCK_VERSION' (fell back instead of fetching?)"

# ─────────────────────────────────────────────────────────────────────────────
section "7. Multi-runtime (claude + opencode + codex)"
dir=$(fresh "multi" ".claude" ".opencode" ".agents")
expect_install_ok "multi" "$dir"
[ -f "$dir/.claude/agents/recruiter.md" ]       && pass "claude"   || fail "claude missing"
[ -f "$dir/.opencode/skills/recruit/SKILL.md" ] && pass "opencode" || fail "opencode missing"
[ -f "$dir/.agents/skills/recruit/SKILL.md" ]   && pass "codex"    || fail "codex missing"

# ─────────────────────────────────────────────────────────────────────────────
section "8. --all flag (creates dirs from scratch)"
dir=$(fresh "all-flag")
expect_install_ok "--all" "$dir" --all
[ -f "$dir/.claude/agents/recruiter.md" ]       && pass "--all claude"   || fail "--all claude missing"
[ -f "$dir/.opencode/skills/recruit/SKILL.md" ] && pass "--all opencode" || fail "--all opencode missing"
[ -f "$dir/.agents/skills/recruit/SKILL.md" ]   && pass "--all codex"    || fail "--all codex missing"

# ─────────────────────────────────────────────────────────────────────────────
section "9. --runtime flag (explicit, comma-separated)"
dir=$(fresh "runtime-flag")
expect_install_ok "--runtime" "$dir" --runtime claude,opencode
[ -f "$dir/.claude/agents/recruiter.md" ]         && pass "--runtime claude installed"   || fail "claude missing"
[ -f "$dir/.opencode/skills/recruit/SKILL.md" ]   && pass "--runtime opencode installed" || fail "opencode missing"
[ ! -f "$dir/.agents/skills/recruit/SKILL.md" ]   && pass "codex correctly skipped"      || fail "codex wrongly installed"

# ─────────────────────────────────────────────────────────────────────────────
section "10. --team appends to AGENTS.md"
dir=$(fresh "team" ".claude")
echo "# AGENTS.md" > "$dir/AGENTS.md"
expect_install_ok "--team" "$dir" --team
grep -q "roster"       "$dir/AGENTS.md" && pass "roster section added"        || fail "roster section missing"
grep -q "install.sh"   "$dir/AGENTS.md" && pass "install one-liner present"   || fail "one-liner missing"
grep -q "/recruit"     "$dir/AGENTS.md" && pass "/recruit instruction present" || fail "/recruit missing"

# ─────────────────────────────────────────────────────────────────────────────
section "11. --team without AGENTS.md"
dir=$(fresh "team-no-md" ".claude")
output=$(run_install "$dir" --team 2>&1)
echo "$output" | grep -qi "not found\|skip" \
  && pass "warns gracefully without AGENTS.md" \
  || fail "no warning\n    got: $output"
[ ! -f "$dir/AGENTS.md" ] && pass "AGENTS.md not created" || fail "AGENTS.md created unexpectedly"

# ─────────────────────────────────────────────────────────────────────────────
section "12. Unknown runtime warns, doesn't crash"
dir=$(fresh "unknown")
output=$(run_install "$dir" --runtime "martianruntime" 2>&1); status=$?
# An unknown runtime must warn-and-continue, exiting 0 — not abort. (The old `[ $? -eq 0 ] || true`
# here was dead: it ran after a `|| true` assignment, so it always observed 0.)
[ "$status" -eq 0 ] && pass "unknown runtime exits 0 (no crash)" \
  || fail "unknown runtime exited $status (expected 0)\n    got: $output"
echo "$output" | grep -qi "unknown\|skipping" \
  && pass "unknown runtime warned" \
  || fail "unknown runtime not handled\n    got: $output"

# ─────────────────────────────────────────────────────────────────────────────
section "13. Copilot warns about manual setup"
dir=$(fresh "copilot")
output=$(run_install "$dir" --runtime copilot 2>&1 || true)
echo "$output" | grep -qi "copilot\|manual" \
  && pass "copilot manual setup warned" \
  || fail "copilot not handled\n    got: $output"

# ─────────────────────────────────────────────────────────────────────────────
section "14. Idempotency (reinstall over existing files)"
dir=$(fresh "idempotent" ".claude")
expect_install_ok "idempotent first install" "$dir"
echo "# stale content" > "$dir/.claude/agents/recruiter.md"
expect_install_ok "idempotent reinstall" "$dir"
grep -q "mock recruiter" "$dir/.claude/agents/recruiter.md" \
  && pass "file correctly overwritten on reinstall" \
  || fail "file not updated on reinstall"

# ─────────────────────────────────────────────────────────────────────────────
section "15. Output format"
dir=$(fresh "output" ".claude")
output=$(run_install "$dir" 2>&1)
echo "$output" | grep -q "roster"   && pass "output contains 'roster'"    || fail "output missing 'roster'"
echo "$output" | grep -q "/recruit\|\$recruit" && pass "output mentions /recruit" || fail "output missing /recruit"
echo "$output" | grep -q "✓"        && pass "output has checkmarks"        || fail "output missing checkmarks"

# ─────────────────────────────────────────────────────────────────────────────
section "16. Script is executable"
[ -x "$INSTALL_SH" ] && pass "install.sh is executable" || fail "not executable"

# ─────────────────────────────────────────────────────────────────────────────
section "17. shellcheck"
if command -v shellcheck &>/dev/null; then
  shellcheck -S warning "$INSTALL_SH" \
    && pass "shellcheck clean" \
    || fail "shellcheck issues found"
else
  echo "  (shellcheck not installed — skipping)"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "18. --runtime with spaces (robustness)"
dir=$(fresh "runtime-spaces")
output=$(run_install "$dir" --runtime "claude, opencode" 2>&1 || true)
# Comma+space separated — may or may not install anything, but must not shell-crash. Assert the
# ABSENCE of crash markers in the whole output. (The old `grep -qv` was a false-pass: it succeeds
# whenever ANY single line lacks the pattern — the banner alone satisfied it even on a real crash.)
if echo "$output" | grep -qi "unbound\|syntax error"; then
  fail "space in --runtime caused crash\n    got: $output"
else
  pass "space in --runtime doesn't crash"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -rf "$WORK_DIR" "$MOCK_ROOT" "$PATCHED_SH" "$FAKE_CODEX_HOME"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Results: ${GREEN}${PASS} passed${RESET}, ${RED}${FAIL} failed${RESET} (out of $((PASS+FAIL)))"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
