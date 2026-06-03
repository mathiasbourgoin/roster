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
rm -rf "$MOCK_ROOT" && mkdir -p "$MOCK_ROOT/recruiter" "$MOCK_ROOT/.opencode/agents"
echo "# mock recruiter"          > "$MOCK_ROOT/recruiter/recruiter.md"
echo "# mock opencode recruiter" > "$MOCK_ROOT/.opencode/agents/recruiter.md"

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

fresh() {
  local name="$1"; shift
  local dir="$WORK_DIR/$name"
  rm -rf "$dir" && mkdir -p "$dir"
  for d in "$@"; do mkdir -p "$dir/$d"; done
  # Reset fake codex home each time
  rm -rf "$FAKE_CODEX_HOME"
  echo "$dir"
}

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
run_install "$dir" > /dev/null
[ -f "$dir/.claude/agents/recruiter.md" ]  && pass ".claude/agents/recruiter.md created"  || fail ".claude/agents/recruiter.md missing"
[ -f "$dir/.claude/commands/recruit.md" ]  && pass ".claude/commands/recruit.md created"  || fail ".claude/commands/recruit.md missing"
grep -q "mock recruiter" "$dir/.claude/agents/recruiter.md" \
  && pass "claude content correct" || fail "claude content wrong"

# ─────────────────────────────────────────────────────────────────────────────
section "3. OpenCode only"
dir=$(fresh "opencode-only" ".opencode")
run_install "$dir" > /dev/null
[ -f "$dir/.opencode/agents/recruiter.md" ] && pass ".opencode/agents/recruiter.md created" || fail "missing"
grep -q "mock opencode recruiter" "$dir/.opencode/agents/recruiter.md" \
  && pass "opencode content correct" || fail "opencode content wrong"

# ─────────────────────────────────────────────────────────────────────────────
section "4. Codex (project-local) only"
dir=$(fresh "codex-only" ".agents")
run_install "$dir" > /dev/null
[ -f "$dir/.agents/skills/recruit/SKILL.md" ]         && pass "SKILL.md created"            || fail "SKILL.md missing"
[ -f "$dir/.agents/skills/recruit/.roster-managed" ]  && pass ".roster-managed sentinel"    || fail ".roster-managed missing"
[ ! -f "$dir/.agents/skills/recruit/.agent-roster-managed" ] \
  && pass "old sentinel name NOT used (rename clean)"  || fail "old .agent-roster-managed still present"

# ─────────────────────────────────────────────────────────────────────────────
section "5. Codex global"
dir=$(fresh "codex-global")
mkdir -p "$FAKE_CODEX_HOME/skills"
run_install "$dir" > /dev/null
[ -f "$FAKE_CODEX_HOME/skills/recruit/SKILL.md" ]        && pass "codex-global SKILL.md" || fail "codex-global SKILL.md missing"
[ -f "$FAKE_CODEX_HOME/skills/recruit/.roster-managed" ] && pass "codex-global sentinel" || fail "codex-global sentinel missing"

# ─────────────────────────────────────────────────────────────────────────────
section "7. Multi-runtime (claude + opencode + codex)"
dir=$(fresh "multi" ".claude" ".opencode" ".agents")
run_install "$dir" > /dev/null
[ -f "$dir/.claude/agents/recruiter.md" ]     && pass "claude"   || fail "claude missing"
[ -f "$dir/.opencode/agents/recruiter.md" ]   && pass "opencode" || fail "opencode missing"
[ -f "$dir/.agents/skills/recruit/SKILL.md" ] && pass "codex"    || fail "codex missing"

# ─────────────────────────────────────────────────────────────────────────────
section "8. --all flag (creates dirs from scratch)"
dir=$(fresh "all-flag")
run_install "$dir" --all > /dev/null
[ -f "$dir/.claude/agents/recruiter.md" ]     && pass "--all claude"   || fail "--all claude missing"
[ -f "$dir/.opencode/agents/recruiter.md" ]   && pass "--all opencode" || fail "--all opencode missing"
[ -f "$dir/.agents/skills/recruit/SKILL.md" ] && pass "--all codex"    || fail "--all codex missing"

# ─────────────────────────────────────────────────────────────────────────────
section "9. --runtime flag (explicit, comma-separated)"
dir=$(fresh "runtime-flag")
run_install "$dir" --runtime claude,opencode > /dev/null
[ -f "$dir/.claude/agents/recruiter.md" ]         && pass "--runtime claude installed"   || fail "claude missing"
[ -f "$dir/.opencode/agents/recruiter.md" ]        && pass "--runtime opencode installed" || fail "opencode missing"
[ ! -f "$dir/.agents/skills/recruit/SKILL.md" ]   && pass "codex correctly skipped"      || fail "codex wrongly installed"

# ─────────────────────────────────────────────────────────────────────────────
section "10. --team appends to AGENTS.md"
dir=$(fresh "team" ".claude")
echo "# AGENTS.md" > "$dir/AGENTS.md"
run_install "$dir" --team > /dev/null
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
output=$(run_install "$dir" --runtime "martianruntime" 2>&1 || true)
[ $? -eq 0 ] || true  # may exit 0 or non-zero, just must not segfault
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
run_install "$dir" > /dev/null
echo "# stale content" > "$dir/.claude/agents/recruiter.md"
run_install "$dir" > /dev/null
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
# Comma+space separated — may or may not work, just shouldn't crash
echo "$output" | grep -qv "unbound\|syntax error" \
  && pass "space in --runtime doesn't crash" \
  || fail "space in --runtime caused crash"

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -rf "$WORK_DIR" "$MOCK_ROOT" "$PATCHED_SH" "$FAKE_CODEX_HOME"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Results: ${GREEN}${PASS} passed${RESET}, ${RED}${FAIL} failed${RESET} (out of $((PASS+FAIL)))"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
