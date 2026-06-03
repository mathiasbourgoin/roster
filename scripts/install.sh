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
#   --runtime <list>     Comma-separated runtimes: claude,opencode,codex,codex-global
#   --channel <c>        Release channel: stable (default → main) | next (edge branch)
#   --branch <ref>       Install from an arbitrary git ref (overrides --channel)
#   --team               Append the install one-liner to AGENTS.md for teammates

set -euo pipefail

REPO="mathiasbourgoin/roster"
# Release channel → git ref. `stable` (default) tracks main; `next` tracks the edge branch.
# --branch <ref> is the low-level escape hatch and overrides the channel's ref. RAW is resolved
# AFTER argument parsing (see "Resolve channel → ref" below) so flags can change it.
CHANNEL="stable"
BRANCH="main"
BRANCH_OVERRIDE=""
RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

# Recruiter version written to sentinel files. Read from local VERSION file when available
# (dev installs); hardcoded fallback used when running via curl|bash from GitHub, where there is
# no checkout ($0 is "bash", so "$(dirname "$0")/../VERSION" does not resolve to a real file).
# The `|| true` is load-bearing: without it, a missing VERSION makes the cat|tr pipeline fail
# under `set -euo pipefail` and the whole installer dies silently before printing anything.
ROSTER_VERSION="$(cat "$(dirname "$0")/../VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
ROSTER_VERSION="${ROSTER_VERSION:-2.6.2}"

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

# ── Prerequisites ───────────────────────────────────────────────────────────
# This installer needs bash >= 4 (uses `mapfile`) and curl or wget. jq + git are
# NOT used here but ARE required by /recruit (which runs sync-harness.sh) — warn
# rather than fail so a missing jq doesn't surface only after a "successful" install.

require_bash4() {
  if [ -z "${BASH_VERSINFO:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    err "roster's installer requires bash 4 or newer (found ${BASH_VERSION:-unknown})."
    err "macOS ships bash 3.2 by default — install a newer bash (e.g. 'brew install bash')"
    err "and re-run, or invoke it explicitly: /opt/homebrew/bin/bash scripts/install.sh"
    exit 1
  fi
}

require_fetcher() {
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    err "Neither curl nor wget found — cannot download roster files. Install one and re-run."
    exit 1
  fi
}

warn_recruit_deps() {
  local missing=()
  command -v jq  >/dev/null 2>&1 || missing+=("jq")
  command -v git >/dev/null 2>&1 || missing+=("git")
  if [ "${#missing[@]}" -gt 0 ]; then
    warn "Missing tools required by /recruit (not by this installer): ${missing[*]}"
    warn "Install them before running /recruit — it calls sync-harness.sh, which needs jq + git."
  fi
}

require_bash4
require_fetcher

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
    --channel)
      [[ $# -gt 1 ]] || { err "--channel requires a value (stable|next)"; exit 1; }
      CHANNEL="$2"; shift ;;
    --channel=*)     CHANNEL="${1#--channel=}" ;;
    --branch)
      [[ $# -gt 1 ]] || { err "--branch requires a value (a git ref)"; exit 1; }
      BRANCH_OVERRIDE="$2"; shift ;;
    --branch=*)      BRANCH_OVERRIDE="${1#--branch=}" ;;
    -h|--help)
      cat <<'USAGE'
roster installer — install agents and recruiter skill into your AI runtime(s)

Usage: bash scripts/install.sh [--all] [--runtime <list>] [--channel <c>] [--team] [-h]

  --all                Install into all detected runtimes
  --runtime <list>     Comma-separated runtimes: claude,opencode,codex,codex-global
  --channel <c>        Release channel: stable (default, tracks main) | next (edge branch)
  --branch <ref>       Install from an arbitrary git ref (overrides --channel)
  --team               Append the install one-liner to AGENTS.md for teammates
  -h, --help           Show this help

Auto-detected runtimes: Claude Code (.claude/), OpenCode (.opencode/),
  Codex project (.agents/), Codex global (~/.codex/skills).

Run with no flags to install into auto-detected runtimes interactively.
USAGE
      exit 0 ;;
    *) warn "Unknown flag: $1" ;;
  esac
  shift
done

# ── Resolve channel → ref ─────────────────────────────────────────────────────
case "$CHANNEL" in
  stable) BRANCH="main" ;;
  next)   BRANCH="next" ;;
  *) err "Unknown channel: '$CHANNEL' (expected: stable | next). Use --branch <ref> for an arbitrary ref."; exit 1 ;;
esac
# --branch is the explicit escape hatch; it overrides the channel's ref but the channel label
# (stable/next) is still what gets recorded, unless an override is given — then we record the ref.
if [ -n "$BRANCH_OVERRIDE" ]; then
  BRANCH="$BRANCH_OVERRIDE"
  CHANNEL="branch:$BRANCH_OVERRIDE"
fi
RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

# ── Runtime detection ─────────────────────────────────────────────────────────

detect_runtimes() {
  local found=()
  [ -d ".claude" ]   && found+=("claude")
  [ -d ".opencode" ] && found+=("opencode")
  [ -d ".agents" ]   && found+=("codex")
  [ -d "${CODEX_HOME:-$HOME/.codex}/skills" ] && found+=("codex-global")
  printf '%s\n' "${found[@]:-}"
}

ALL_RUNTIMES="claude opencode codex codex-global"

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

# Write the per-runtime sentinel markers: version (for /recruit update checks) + channel
# (so the project — and /roster-doctor — remembers which release channel it was installed from).
stamp_markers() {
  local dir="$1"
  echo "$ROSTER_VERSION" > "$dir/.roster-version"
  echo "$CHANNEL"        > "$dir/.roster-channel"
}

install_claude() {
  mkdir -p .claude/agents .claude/commands
  fetch "${RAW}/recruiter/recruiter.md" ".claude/agents/recruiter.md"
  # The slash-command must be the RENDERED projection (name: recruit), not the raw agent
  # (name: recruiter) — otherwise the documented /recruit trigger is wrong.
  fetch "${RAW}/.claude/commands/recruit.md" ".claude/commands/recruit.md"
  stamp_markers .claude
  ok "Claude Code  →  .claude/agents/recruiter.md + .claude/commands/recruit.md"
}

install_opencode() {
  # OpenCode natively discovers Agent Skills (SKILL.md) — incl. its own .opencode/skills/ path.
  # Install recruit as a discovered skill (name: recruit) rather than a Claude-style command,
  # which OpenCode does NOT read. The same rendered SKILL.md is the open Agent Skills standard,
  # so it is also what Codex (.agents/skills) and Copilot discover — one artifact, three runtimes.
  mkdir -p .opencode/skills/recruit
  fetch "${RAW}/.agents/skills/recruit/SKILL.md" ".opencode/skills/recruit/SKILL.md"
  touch ".opencode/skills/recruit/.roster-managed"   # match sync-harness + Codex install
  stamp_markers .opencode
  ok "OpenCode     →  .opencode/skills/recruit/SKILL.md (native skill discovery)"
}

install_codex() {
  mkdir -p .agents/skills/recruit
  # Native skill discovery (Codex/OpenCode) keys on the SKILL.md frontmatter `name:`, so this
  # must be the RENDERED projection (name: recruit), not the raw agent (name: recruiter).
  fetch "${RAW}/.agents/skills/recruit/SKILL.md" ".agents/skills/recruit/SKILL.md"
  touch ".agents/skills/recruit/.roster-managed"
  stamp_markers .agents/skills/recruit
  ok "Codex        →  .agents/skills/recruit/SKILL.md"
}

install_codex_global() {
  local dir="${CODEX_HOME:-$HOME/.codex}/skills/recruit"
  mkdir -p "$dir"
  fetch "${RAW}/.agents/skills/recruit/SKILL.md" "$dir/SKILL.md"
  touch "$dir/.roster-managed"
  stamp_markers "$dir"
  ok "Codex global →  $dir/SKILL.md"
}

# ── Main ──────────────────────────────────────────────────────────────────────

echo ""
bold "roster — multi-runtime installer"
echo ""

if [ -z "${RUNTIMES_TO_INSTALL:-}" ]; then
  warn "No runtimes detected. Use --all to install for all, or --runtime <list>."
  info "Supported: claude, opencode, codex, codex-global"
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
warn_recruit_deps
bold "Done."
echo ""
info "Next: run /recruit (Claude / OpenCode) or \$recruit (Codex) to assemble your team."
info "      It will also offer to install the roster-* pipeline skills (/roster-run, etc.)."
info "Then: /roster-run <task> to drive the pipeline."
echo ""
