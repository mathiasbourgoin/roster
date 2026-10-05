#!/usr/bin/env bash
# Install the observation and feedback surfaces for a Chamallaw-enabled Roster
# project. This script never configures an MCP transport, creates a decision
# contract, or grants mutation authority: those remain owner-controlled.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-chamallaw-roster.sh --target DIR --contract-id ID [--force] [--dry-run]

Installs chamallaw-shadow and chamallaw-feedback into DIR/.harness, installs
post-roster-intake and post-roster-ship skill hooks, and writes the default
contract mapping in .harness/chamallaw-shadow.json. The MCP named
chamallaw-decision must be configured separately by the project owner.
EOF
}

TARGET=""
CONTRACT_ID=""
FORCE=0
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || { echo "--target requires a value" >&2; exit 2; }
      TARGET="$2"; shift 2 ;;
    --contract-id)
      [ "$#" -ge 2 ] || { echo "--contract-id requires a value" >&2; exit 2; }
      CONTRACT_ID="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$CONTRACT_ID" in ''|*[!0-9]*) echo "--contract-id must be a positive integer" >&2; exit 2 ;; esac
[ "$CONTRACT_ID" -gt 0 ] || { echo "--contract-id must be a positive integer" >&2; exit 2; }
[ -n "$TARGET" ] || { usage >&2; exit 2; }

for command in jq cmp cp mkdir mktemp; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing required command: $command" >&2; exit 1; }
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$(cd "$TARGET" && pwd)"
HARNESS="$TARGET/.harness"
MANIFEST="$HARNESS/harness.json"
[ -f "$MANIFEST" ] || { echo "missing Roster harness manifest: $MANIFEST" >&2; exit 1; }
jq empty "$MANIFEST" >/dev/null || { echo "invalid harness manifest: $MANIFEST" >&2; exit 1; }

write_file() {
  local source="$1" target="$2"
  if [ -f "$target" ] && ! cmp -s "$source" "$target" && [ "$FORCE" -ne 1 ]; then
    echo "refusing to overwrite local file: $target (pass --force after review)" >&2
    exit 1
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "would install $target"
  else
    mkdir -p "$(dirname "$target")"
    cp "$source" "$target"
    echo "installed $target"
  fi
}

write_file "$REPO_ROOT/skills/workflow/chamallaw-shadow.md" "$HARNESS/skills/chamallaw-shadow.md"
write_file "$REPO_ROOT/skills/workflow/chamallaw-feedback.md" "$HARNESS/skills/chamallaw-feedback.md"
write_file "$REPO_ROOT/templates/chamallaw-roster/roster-intake-post.md" "$HARNESS/hooks/skills/roster-intake/post.md"
write_file "$REPO_ROOT/templates/chamallaw-roster/roster-ship-post.md" "$HARNESS/hooks/skills/roster-ship/post.md"

CONFIG="$HARNESS/chamallaw-shadow.json"
CONFIG_JSON="$(jq -n --argjson id "$CONTRACT_ID" '{schema_version: 1, mcp_server: "chamallaw-decision", default_contract_id: $id}')"
if [ -f "$CONFIG" ] && [ "$FORCE" -ne 1 ] && ! jq -e --argjson expected "$CONFIG_JSON" '. == $expected' "$CONFIG" >/dev/null; then
  echo "refusing to overwrite local config: $CONFIG (pass --force after review)" >&2
  exit 1
fi
if [ "$DRY_RUN" -eq 1 ]; then
  echo "would write $CONFIG"
else
  printf '%s\n' "$CONFIG_JSON" > "$CONFIG"
  echo "wrote $CONFIG"
fi

if [ "$DRY_RUN" -eq 0 ]; then
  TMP="$(mktemp)"
  jq --arg shadow_version "1.3.0" --arg feedback_version "1.0.0" '
    .layers.skills = ((.layers.skills // []) | map(select(.name != "chamallaw-shadow" and .name != "chamallaw-feedback"))) + [
      {name: "chamallaw-shadow", source: "chamallaw", version: $shadow_version, domain: "workflow", file: "chamallaw-shadow"},
      {name: "chamallaw-feedback", source: "chamallaw", version: $feedback_version, domain: "workflow", file: "chamallaw-feedback"}
    ]
  ' "$MANIFEST" > "$TMP"
  mv "$TMP" "$MANIFEST"
  bash "$REPO_ROOT/scripts/sync-harness.sh" "$TARGET"
fi

cat <<'EOF'
Next steps:
  1. Configure a local MCP named chamallaw-decision with a fixed scope.
  2. Create and activate the configured contract through a trusted Chamallaw host.
  3. Keep outcome submission disabled until a separate evidence validator exists.
  4. Commit the generated .harness, runtime projections, and configuration.
EOF
