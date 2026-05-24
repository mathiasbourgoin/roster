#!/usr/bin/env bash
# Sync canonical shared harness files from .harness/ into runtime-compatible files.
# Usage: ./scripts/sync-harness.sh [project-root]

set -euo pipefail

PROJECT_ROOT="${1:-$PWD}"
HARNESS_DIR="$PROJECT_ROOT/.harness"
CLAUDE_DIR="$PROJECT_ROOT/.claude"
CODEX_DIR="$PROJECT_ROOT/.agents"
CODEX_SKILLS_DIR="$CODEX_DIR/skills"
MANIFEST="$HARNESS_DIR/harness.json"

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

need_cmd jq

if [ ! -f "$MANIFEST" ]; then
    echo "Shared harness manifest not found at $MANIFEST" >&2
    exit 1
fi

runtime_enabled() {
    local runtime_name="$1"
    jq -e --arg name "$runtime_name" '.runtimes // [] | any(.name == $name and (.enabled == true))' "$MANIFEST" >/dev/null
}

sync_markdown_dir() {
    local src="$1"
    local dst="$2"

    mkdir -p "$dst"
    find "$dst" -maxdepth 1 -type f -name '*.md' -delete

    if [ -d "$src" ]; then
        find "$src" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
            cp "$file" "$dst/$(basename "$file")"
        done
    fi
}

extract_frontmatter_field() {
    local file="$1"
    local field="$2"
    awk -v f="$field" '
        /^---$/ {n++; next}
        n == 1 && $0 ~ "^" f ":" {
            sub("^" f ": *", "")
            print
            exit
        }
    ' "$file"
}

extract_command_block() {
    local file="$1"
    awk '
        /^```command$/ {in_block=1; next}
        /^```$/ && in_block {exit}
        in_block {print}
    ' "$file"
}

build_hooks_json() {
    local hooks_dir="$1"
    local hooks_json='{"hooks":{}}'

    if [ ! -d "$hooks_dir" ]; then
        printf '%s\n' "$hooks_json"
        return
    fi

    while IFS= read -r -d '' hook_file; do
        local event matcher command
        event="$(extract_frontmatter_field "$hook_file" "event")"
        matcher="$(extract_frontmatter_field "$hook_file" "matcher")"
        command="$(extract_command_block "$hook_file")"

        if [ -z "$event" ] || [ -z "$command" ]; then
            echo "Skipping hook without event or command block: $hook_file" >&2
            continue
        fi

        hooks_json="$(jq -c \
            --arg event "$event" \
            --arg matcher "$matcher" \
            --arg command "$command" '
            .hooks[$event] = (
              (.hooks[$event] // []) + [
                if $matcher == "" then
                  {hooks: [{type: "command", command: $command}]}
                else
                  {matcher: $matcher, hooks: [{type: "command", command: $command}]}
                end
              ]
            )
        ' <<<"$hooks_json")"
    done < <(find "$hooks_dir" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

    printf '%s\n' "$hooks_json"
}

if runtime_enabled "claude-code"; then
    mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/rules"
    sync_markdown_dir "$HARNESS_DIR/agents" "$CLAUDE_DIR/agents"
    sync_markdown_dir "$HARNESS_DIR/skills" "$CLAUDE_DIR/commands"

    # Also sync roster skills from skills/ subdirectories (pipeline, meta, operational)
    ROSTER_SKILLS_DIR="$PROJECT_ROOT/skills"
    if [ -d "$ROSTER_SKILLS_DIR" ]; then
        for domain_dir in "$ROSTER_SKILLS_DIR"/*/; do
            domain="$(basename "$domain_dir")"
            # Skip shared (preamble is not a slash command)
            [ "$domain" = "shared" ] && continue
            find "$domain_dir" -maxdepth 1 -type f -name 'roster-*.md' | while read -r skill_file; do
                cp "$skill_file" "$CLAUDE_DIR/commands/$(basename "$skill_file")"
            done
        done
    fi

    sync_markdown_dir "$HARNESS_DIR/rules" "$CLAUDE_DIR/rules"
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        cp "$HARNESS_DIR/agents/recruiter.md" "$CLAUDE_DIR/commands/recruit.md"
    else
        rm -f "$CLAUDE_DIR/commands/recruit.md"
    fi
    cp "$MANIFEST" "$CLAUDE_DIR/harness.json"

    HOOKS_JSON="$(build_hooks_json "$HARNESS_DIR/hooks")"
    SETTINGS_LOCAL="$CLAUDE_DIR/settings.local.json"
    TMP_SETTINGS="$(mktemp)"

    if [ -s "$SETTINGS_LOCAL" ]; then
        jq --argjson hooks "$HOOKS_JSON" '.hooks = $hooks.hooks' "$SETTINGS_LOCAL" > "$TMP_SETTINGS"
    else
        jq -n --argjson hooks "$HOOKS_JSON" '$hooks' > "$TMP_SETTINGS"
    fi

    mv "$TMP_SETTINGS" "$SETTINGS_LOCAL"
fi

if runtime_enabled "codex"; then
    mkdir -p "$CODEX_SKILLS_DIR"
    sync_markdown_dir "$HARNESS_DIR/skills" "$CODEX_SKILLS_DIR"
    # Also sync roster skills
    if [ -d "$ROSTER_SKILLS_DIR" ]; then
        for domain_dir in "$ROSTER_SKILLS_DIR"/*/; do
            domain="$(basename "$domain_dir")"
            [ "$domain" = "shared" ] && continue
            find "$domain_dir" -maxdepth 1 -type f -name 'roster-*.md' | while read -r skill_file; do
                cp "$skill_file" "$CODEX_SKILLS_DIR/$(basename "$skill_file")"
            done
        done
    fi
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        cp "$HARNESS_DIR/agents/recruiter.md" "$CODEX_SKILLS_DIR/recruit.md"
    else
        rm -f "$CODEX_SKILLS_DIR/recruit.md"
    fi
fi

printf 'Synced shared harness from %s\n' "$HARNESS_DIR"
