#!/usr/bin/env bash
# install.sh — roster multi-runtime installer
# Detects all agentic runtimes present in the current project and installs
# the roster recruiter for each one. After install, run /recruit (or $recruit
# for Codex) to assemble your team.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/mathiasbourgoin/roster/main/scripts/install.sh | bash
#   bash scripts/install.sh [--all] [--runtime claude,opencode,codex] [--team]
#
# Flags:
#   --all                Install for all supported runtimes (creates dirs)
#   --runtime <list>     Comma-separated runtimes: claude,opencode,codex,codex-global,pi
#   --team               Append the install one-liner to AGENTS.md for teammates

set -euo pipefail

REPO="mathiasbourgoin/roster"
BRANCH="main"
RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { printf "${GREEN}  ✓${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}  ⚠${RESET} %s\n" "$*"; }
info() { printf "  %s\n" "$*"; }
bold() { printf "${BOLD}%s${RESET}\n" "$*"; }
err()  { printf "${RED}  ✗${RESET} %s\n" "$*" >&2; }

# ── Argument parsing ──────────────────────────────────────────────────────────

OPT_ALL=false
OPT_TEAM=false
OPT_RUNTIMES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)           OPT_ALL=true ;;
    --team)          OPT_TEAM=true ;;
    --runtime)
      [[ $# -gt 1 ]] || { warn "--runtime requires a value (e.g. --runtime claude,opencode)"; exit 1; }
      OPT_RUNTIMES="$2"; shift ;;
    --runtime=*)     OPT_RUNTIMES="${1#--runtime=}" ;;
    -h|--help)
      cat <<'USAGE'
roster installer — install agents and recruiter skill into your AI runtime(s)

Usage: bash scripts/install.sh [--all] [--runtime <list>] [--team] [-h]

  --all                Install into all detected runtimes
  --runtime <list>     Comma-separated runtimes: claude,opencode,codex,codex-global
  --team               Append the install one-liner to AGENTS.md for teammates
  -h, --help           Show this help

Auto-detected runtimes: Claude Code (.claude/), OpenCode (.opencode/),
  Codex project (.agents/), Codex global (~/.codex/skills), Pi (.pi/).

Run with no flags to install into auto-detected runtimes interactively.
USAGE
      exit 0 ;;
    *) warn "Unknown flag: $1" ;;
  esac
  shift
done

# ── Runtime detection ─────────────────────────────────────────────────────────

detect_runtimes() {
  local found=()
  [ -d ".claude" ]   && found+=("claude")
  [ -d ".opencode" ] && found+=("opencode")
  [ -d ".agents" ]   && found+=("codex")
  [ -d "${CODEX_HOME:-$HOME/.codex}/skills" ] && found+=("codex-global")
  [ -d ".pi" ]       && found+=("pi")
  printf '%s\n' "${found[@]:-}"
}

ALL_RUNTIMES="claude opencode codex codex-global pi"

if [ -n "$OPT_RUNTIMES" ]; then
  RUNTIMES_TO_INSTALL="${OPT_RUNTIMES//,/ }"
elif $OPT_ALL; then
  RUNTIMES_TO_INSTALL="$ALL_RUNTIMES"
else
  mapfile -t detected < <(detect_runtimes)
  RUNTIMES_TO_INSTALL="${detected[*]:-}"
fi

# ── Install functions ─────────────────────────────────────────────────────────

fetch() {
  local url="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget &>/dev/null; then
    wget -qO "$dest" "$url"
  else
    err "Neither curl nor wget found — cannot download files."
    exit 1
  fi
}

install_claude() {
  mkdir -p .claude/agents .claude/commands
  fetch "${RAW}/recruiter/recruiter.md" ".claude/agents/recruiter.md"
  fetch "${RAW}/recruiter/recruiter.md" ".claude/commands/recruit.md"
  ok "Claude Code  →  .claude/agents/recruiter.md + .claude/commands/recruit.md"
}

install_opencode() {
  mkdir -p .opencode/agents
  fetch "${RAW}/.opencode/agents/recruiter.md" ".opencode/agents/recruiter.md"
  ok "OpenCode     →  .opencode/agents/recruiter.md"
}

install_codex() {
  mkdir -p .agents/skills/recruit
  fetch "${RAW}/recruiter/recruiter.md" ".agents/skills/recruit/SKILL.md"
  touch ".agents/skills/recruit/.roster-managed"
  ok "Codex        →  .agents/skills/recruit/SKILL.md"
}

install_codex_global() {
  local dir="${CODEX_HOME:-$HOME/.codex}/skills/recruit"
  mkdir -p "$dir"
  fetch "${RAW}/recruiter/recruiter.md" "$dir/SKILL.md"
  touch "$dir/.roster-managed"
  ok "Codex global →  $dir/SKILL.md"
}

install_pi() {
  mkdir -p .pi/skills/recruit
  fetch "${RAW}/recruiter/recruiter.md" ".pi/skills/recruit/SKILL.md"
  touch ".pi/skills/recruit/.roster-managed"
  ok "Pi           →  .pi/skills/recruit/SKILL.md"
}

# ── Main ──────────────────────────────────────────────────────────────────────

echo ""
bold "roster — multi-runtime installer"
echo ""

if [ -z "${RUNTIMES_TO_INSTALL:-}" ]; then
  warn "No runtimes detected. Use --all to install for all, or --runtime <list>."
  info "Supported: claude, opencode, codex, codex-global, pi"
  echo ""
  info "Example: bash scripts/install.sh --runtime claude,opencode"
  exit 0
fi

info "Installing recruiter for: ${RUNTIMES_TO_INSTALL}"
echo ""

for runtime in $RUNTIMES_TO_INSTALL; do
  case "$runtime" in
    claude)        install_claude ;;
    opencode)      install_opencode ;;
    codex)         install_codex ;;
    codex-global)  install_codex_global ;;
    pi)            install_pi ;;
    copilot)       warn "GitHub Copilot runtime requires manual setup — see README." ;;
    *)             warn "Unknown runtime: $runtime (skipping)" ;;
  esac
done

# ── Team mode ─────────────────────────────────────────────────────────────────

if $OPT_TEAM; then
  echo ""
  ONELINER="curl -fsSL https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/install.sh | bash"
  if [ -f "AGENTS.md" ]; then
    if grep -q "## Roster" AGENTS.md; then
      warn "Roster section already in AGENTS.md — skipping (already installed)."
    else
      printf '\n## Roster\n\nThis project uses roster for AI-assisted development.\n\nTeam install: `%s`\n\nThen run `/recruit` to assemble your agent team.\n' "$ONELINER" >> AGENTS.md
      ok "Team mode    →  appended install instructions to AGENTS.md"
    fi
  else
    warn "AGENTS.md not found — skipping team mode."
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
bold "Done."
echo ""
info "Next: run /recruit (Claude / OpenCode) or \$recruit (Codex) to assemble your team."
echo ""
