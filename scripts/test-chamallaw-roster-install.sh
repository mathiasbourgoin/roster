#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$(mktemp -d)"
trap 'rm -rf "$TARGET"' EXIT

cp -R "$ROOT/.harness" "$TARGET/.harness"

bash "$ROOT/scripts/install-chamallaw-roster.sh" \
  --target "$TARGET" --contract-id 12

test -f "$TARGET/.harness/skills/chamallaw-shadow.md"
test -f "$TARGET/.harness/skills/chamallaw-feedback.md"
test -f "$TARGET/.harness/hooks/skills/roster-intake/post.md"
test -f "$TARGET/.harness/hooks/skills/roster-ship/post.md"
test "$(jq -r '.default_contract_id' "$TARGET/.harness/chamallaw-shadow.json")" = "12"
jq -e '
  [.layers.skills[] | select(.name == "chamallaw-shadow" or .name == "chamallaw-feedback")] | length == 2
' "$TARGET/.harness/harness.json" >/dev/null
test -f "$TARGET/.agents/skills/chamallaw-shadow/SKILL.md"
test -f "$TARGET/.agents/skills/chamallaw-feedback/SKILL.md"
test -f "$TARGET/.harness/bin/run-hook.js"
(cd "$TARGET" && node "$ROOT/dist/scripts/check-hook-structure.js" .harness/hooks/skills >/dev/null)

# Reinstallation with the same declared mapping must be idempotent.
bash "$ROOT/scripts/install-chamallaw-roster.sh" \
  --target "$TARGET" --contract-id 12 >/dev/null

# A dry run must not replace the owner-selected mapping.
bash "$ROOT/scripts/install-chamallaw-roster.sh" \
  --target "$TARGET" --contract-id 12 --dry-run >/dev/null
test "$(jq -r '.default_contract_id' "$TARGET/.harness/chamallaw-shadow.json")" = "12"

echo "✓ chamallaw Roster installer smoke test passed"
