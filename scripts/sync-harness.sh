#!/usr/bin/env bash
# Sync canonical shared harness files from .harness/ into runtime-compatible files.
# Usage: ./scripts/sync-harness.sh [project-root]

set -euo pipefail

PROJECT_ROOT="${1:-$PWD}"
HARNESS_DIR="$PROJECT_ROOT/.harness"
CLAUDE_DIR="$PROJECT_ROOT/.claude"
CODEX_DIR="$PROJECT_ROOT/.agents"
CODEX_SKILLS_DIR="$CODEX_DIR/skills"
OPENCODE_DIR="$PROJECT_ROOT/.opencode"
OPENCODE_AGENTS_DIR="$OPENCODE_DIR/agents"
OPENCODE_RULES_DIR="$OPENCODE_DIR/rules"
OPENCODE_CONFIG="$PROJECT_ROOT/opencode.json"
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

agent_compatible_with_runtime() {
    local file="$1"
    local runtime_name="$2"

    awk -v runtime="$runtime_name" '
        /^---$/ {
            markers++
            if (markers == 2) {
                exit found ? 0 : 1
            }
            next
        }
        markers == 1 {
            if ($0 ~ /^compatible_with:/) {
                in_field = 1
                if ($0 ~ runtime) {
                    found = 1
                }
                next
            }
            if (in_field && $0 ~ /^[[:space:]]*-/) {
                if ($0 ~ runtime) {
                    found = 1
                }
                next
            }
            if (in_field && $0 ~ /^[A-Za-z_][A-Za-z0-9_-]*:/) {
                in_field = 0
            }
        }
        END {
            exit found ? 0 : 1
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

strip_frontmatter() {
    local file="$1"
    awk '
        BEGIN {seen=0}
        /^---$/ {seen++; next}
        seen >= 2 {print}
    ' "$file"
}

opencode_model() {
    case "$1" in
        opus) echo "github-copilot/claude-opus-4.5" ;;
        sonnet) echo "github-copilot/claude-sonnet-4.5" ;;
        haiku) echo "github-copilot/claude-haiku-4.5" ;;
        *) echo "github-copilot/claude-sonnet-4.5" ;;
    esac
}

opencode_temperature() {
    case "$1" in
        opus) echo "0.3" ;;
        sonnet) echo "0.2" ;;
        haiku) echo "0.1" ;;
        *) echo "0.2" ;;
    esac
}

opencode_permission_json() {
    local name="$1"
    local permission

    permission="$(jq -c --arg name "$name" '
      first(.layers.agents[]? | select(.name == $name) | .tunables.opencode_permission) // empty
    ' "$MANIFEST")"

    if [ -n "$permission" ]; then
        printf '%s\n' "$permission"
    else
        jq -nc '{edit: "deny", bash: "deny", webfetch: "deny"}'
    fi
}

write_yaml_permission() {
    jq -r '
      def yaml_value:
        if type == "object" then
          to_entries
          | map("    \"" + .key + "\": " + (.value | @json))
          | join("\n")
        else
          tostring
        end;
      to_entries[]
      | if (.value | type) == "object" then
          "  \(.key):\n" + (.value | yaml_value)
        else
          "  \(.key): \(.value | tostring)"
        end
    '
}

sync_opencode_agents() {
    local src="$1"
    local agents_json='{}'

    mkdir -p "$OPENCODE_AGENTS_DIR"
    find "$OPENCODE_AGENTS_DIR" -maxdepth 1 -type f -name '*.md' -delete

    if [ ! -d "$src" ]; then
        return
    fi

    while IFS= read -r -d '' agent_file; do
        local name description source_model model mode temperature permission target
        name="$(extract_frontmatter_field "$agent_file" "name")"
        [ -n "$name" ] || name="$(basename "$agent_file" .md)"
        if ! agent_compatible_with_runtime "$agent_file" "opencode"; then
            continue
        fi
        description="$(extract_frontmatter_field "$agent_file" "description")"
        source_model="$(extract_frontmatter_field "$agent_file" "model")"
        mode="subagent"
        [ "$name" = "tech-lead" ] && mode="primary"
        temperature="$(opencode_temperature "$source_model")"
        model="$(opencode_model "$source_model")"
        permission="$(opencode_permission_json "$name")"
        target="$OPENCODE_AGENTS_DIR/$name.md"

        {
            printf '%s\n' '---'
            printf 'description: %s\n' "${description:-Installed from shared harness}"
            printf 'mode: %s\n' "$mode"
            printf 'model: %s\n' "$model"
            printf 'temperature: %s\n' "$temperature"
            printf '%s\n' 'permission:'
            write_yaml_permission <<<"$permission"
            printf '%s\n\n' '---'
            strip_frontmatter "$agent_file"
        } > "$target"

        agents_json="$(jq -c \
            --arg name "$name" \
            --arg description "${description:-Installed from shared harness}" \
            --arg mode "$mode" \
            --arg model "$model" \
            --argjson temperature "$temperature" \
            --argjson permission "$permission" '
            .[$name] = {
              description: $description,
              mode: $mode,
              model: $model,
              temperature: $temperature,
              permission: $permission
            }
        ' <<<"$agents_json")"
    done < <(find "$src" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

    jq -n --argjson agents "$agents_json" '{
      "$schema": "https://opencode.ai/config.json",
      agent: $agents
    }' > "$OPENCODE_CONFIG"
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
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        cp "$HARNESS_DIR/agents/recruiter.md" "$CODEX_SKILLS_DIR/recruit.md"
    else
        rm -f "$CODEX_SKILLS_DIR/recruit.md"
    fi
fi

if runtime_enabled "opencode"; then
    sync_opencode_agents "$HARNESS_DIR/agents"
    sync_markdown_dir "$HARNESS_DIR/rules" "$OPENCODE_RULES_DIR"
fi

printf 'Synced shared harness from %s\n' "$HARNESS_DIR"
