#!/usr/bin/env bash
# Roster version check — run at the start of every /recruit invocation.
# Outputs nothing (exit 0) if up to date or tracking is inactive.
# Outputs "ROSTER_UPGRADE_AVAILABLE <local> <remote> <auto> <runtime>" if an upgrade
# is available. See update-mechanism.md#step-0-response for the response protocol.

_ROSTER_DIR=~/.roster

# Detect runtime and sentinel path
_SENTINEL=""
_RUNTIME=""
if [ -d ".claude" ]; then
  _RUNTIME="claude"; _SENTINEL=".claude/.roster-version"
elif [ -d ".opencode" ]; then
  _RUNTIME="opencode"; _SENTINEL=".opencode/.roster-version"
elif [ -d ".agents/skills/recruit" ]; then
  _RUNTIME="codex"; _SENTINEL=".agents/skills/recruit/.roster-version"
fi

# No sentinel = no tracking = skip silently
[ -z "$_SENTINEL" ] && exit 0
[ ! -f "$_SENTINEL" ] && exit 0

_LOCAL=$(cat "$_SENTINEL" 2>/dev/null | tr -d '[:space:]')
[ -z "$_LOCAL" ] && exit 0

# Tracking is active — now safe to create the state dir
mkdir -p "$_ROSTER_DIR"

# Read config
_CFG="$_ROSTER_DIR/config"
_UPDATE_CHECK="false"
_AUTO_UPGRADE="false"
if [ -f "$_CFG" ]; then
  _v=$(grep '^update_check=' "$_CFG" | cut -d= -f2 | tail -1)
  [ -n "$_v" ] && _UPDATE_CHECK="$_v"
  _v=$(grep '^auto_upgrade=' "$_CFG" | cut -d= -f2 | tail -1)
  [ -n "$_v" ] && _AUTO_UPGRADE="$_v"
fi
[ "$_UPDATE_CHECK" = "false" ] && exit 0

# Check snooze
_SNOOZE_FILE="$_ROSTER_DIR/update-snoozed"
if [ -f "$_SNOOZE_FILE" ]; then
  _UNTIL=$(cat "$_SNOOZE_FILE" 2>/dev/null | tr -d '[:space:]')
  case "$_UNTIL" in ''|*[!0-9]*) _UNTIL=0 ;; esac
  _NOW=$(date +%s 2>/dev/null || echo 0)
  [ "$_UNTIL" -gt "$_NOW" ] && exit 0
fi

# Rate-limit: skip if checked within 24h
_LAST_FILE="$_ROSTER_DIR/last-update-check"
if [ -f "$_LAST_FILE" ]; then
  _LAST_TS=$(cat "$_LAST_FILE" 2>/dev/null | tr -d '[:space:]')
  case "$_LAST_TS" in ''|*[!0-9]*) _LAST_TS=0 ;; esac
  _NOW=$(date +%s 2>/dev/null || echo 0)
  _AGE=$(( _NOW - _LAST_TS ))
  [ "$_AGE" -lt 86400 ] && exit 0
fi

# Fetch remote VERSION (silent — fail = skip)
_REMOTE=$(curl -fsSL --max-time 3 --connect-timeout 2 --silent \
  "https://raw.githubusercontent.com/mathiasbourgoin/roster/main/VERSION" \
  2>/dev/null | tr -d '[:space:]')

# Write timestamp regardless of fetch result
date +%s > "$_LAST_FILE" 2>/dev/null || true

# Validate and compare
[ -z "$_REMOTE" ] && exit 0
echo "$_REMOTE" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || exit 0
[ "$_REMOTE" = "$_LOCAL" ] && exit 0

echo "ROSTER_UPGRADE_AVAILABLE $_LOCAL $_REMOTE $_AUTO_UPGRADE $_RUNTIME"
