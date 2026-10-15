#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$(mktemp -d)"
trap 'rm -rf "$TARGET"' EXIT

bash "$ROOT/scripts/init-harness.sh" "$TARGET" developer >/dev/null

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
node - "$ROOT" "$TARGET" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const [root, target] = process.argv.slice(2);
const fragment = fs.readFileSync(path.join(root, "skills/shared/preamble-friction.md"), "utf8")
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
for (const relative of [".agents/skills/chamallaw-shadow/SKILL.md", ".claude/commands/chamallaw-shadow.md", ".opencode/skills/chamallaw-shadow/SKILL.md"]) {
  const skill = fs.readFileSync(path.join(target, relative), "utf8");
  assert.ok(skill.includes(fragment), `${relative}: complete canonical friction template and closed vocabulary must be injected`);
  assert.match(skill, /# Roster Preamble/);
  assert.doesNotMatch(skill, /## Pipeline State/);
}
assert.doesNotMatch(fs.readFileSync(path.join(target, ".agents/skills/chamallaw-feedback/SKILL.md"), "utf8"), /### Friction Log/);
NODE
(cd "$TARGET" && node "$ROOT/dist/scripts/check-hook-structure.js" .harness/hooks/skills >/dev/null)

# Reinstallation with the same declared mapping must be idempotent.
cp "$TARGET/.agents/skills/chamallaw-shadow/SKILL.md" "$TARGET/shadow-before.md"
bash "$ROOT/scripts/install-chamallaw-roster.sh" \
  --target "$TARGET" --contract-id 12 >/dev/null
cmp "$TARGET/shadow-before.md" "$TARGET/.agents/skills/chamallaw-shadow/SKILL.md"

# A consumer core preamble takes precedence; missing local friction uses the
# canonical source fragment without creating a required source-tree resource.
mkdir -p "$TARGET/skills/shared"
printf '# Consumer core preamble\n' > "$TARGET/skills/shared/preamble.md"
bash "$ROOT/scripts/install-chamallaw-roster.sh" \
  --target "$TARGET" --contract-id 12 >/dev/null
node - "$TARGET" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const target = process.argv[2];
const skill = fs.readFileSync(path.join(target, ".agents/skills/chamallaw-shadow/SKILL.md"), "utf8");
assert.match(skill, /# Consumer core preamble/);
assert.doesNotMatch(skill, /# Roster Preamble|## Pipeline State/);
assert.match(skill, /"suggestion_type": null/);
assert.match(skill, /Friction classes — closed vocabulary/);
assert.equal(fs.readFileSync(path.join(target, "skills/shared/preamble.md"), "utf8"), "# Consumer core preamble\n");
assert.equal(fs.existsSync(path.join(target, "skills/shared/preamble-friction.md")), false);
NODE

# A dry run must not replace the owner-selected mapping.
bash "$ROOT/scripts/install-chamallaw-roster.sh" \
  --target "$TARGET" --contract-id 12 --dry-run >/dev/null
test "$(jq -r '.default_contract_id' "$TARGET/.harness/chamallaw-shadow.json")" = "12"

# Local hooks require intentional replacement; dry-run remains read-only even
# with force, and a real forced reinstall restores the declared hook.
HOOK="$TARGET/.harness/hooks/skills/roster-intake/post.md"
printf '\nConsumer hook override\n' >> "$HOOK"
cp "$HOOK" "$TARGET/hook-before.md"
if bash "$ROOT/scripts/install-chamallaw-roster.sh" --target "$TARGET" --contract-id 12 >/dev/null 2>&1; then
  echo "expected local hook collision refusal" >&2
  exit 1
fi
cmp "$HOOK" "$TARGET/hook-before.md"
bash "$ROOT/scripts/install-chamallaw-roster.sh" --target "$TARGET" --contract-id 12 --force --dry-run >/dev/null
cmp "$HOOK" "$TARGET/hook-before.md"
bash "$ROOT/scripts/install-chamallaw-roster.sh" --target "$TARGET" --contract-id 12 --force >/dev/null
cmp "$HOOK" "$ROOT/templates/chamallaw-roster/roster-intake-post.md"

echo "✓ chamallaw Roster installer smoke test passed"
