#!/usr/bin/env bash
# Sync canonical shared harness files from .harness/ into runtime-compatible files.
# Usage: ./scripts/sync-harness.sh [project-root]

set -euo pipefail

PROJECT_ROOT="${1:-$PWD}"
HARNESS_DIR="$PROJECT_ROOT/.harness"
CLAUDE_DIR="$PROJECT_ROOT/.claude"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_GLOBAL_SKILLS_DIR="$CODEX_HOME_DIR/skills"
ROSTER_SKILLS_DIR="$PROJECT_ROOT/skills"
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

runtime_entrypoint() {
    local runtime_name="$1"
    local fallback="$2"
    local value
    value="$(jq -r --arg name "$runtime_name" --arg fallback "$fallback" '
      first(.runtimes[]? | select(.name == $name) | .entrypoint) // $fallback
    ' "$MANIFEST")"
    printf '%s\n' "$value"
}

resolve_entrypoint() {
    local entrypoint="$1"
    case "$entrypoint" in
        "~/.codex") printf '%s\n' "$CODEX_HOME_DIR" ;;
        "~/.codex/"*) printf '%s/%s\n' "$CODEX_HOME_DIR" "${entrypoint#\~/.codex/}" ;;
        "~/"*) printf '%s/%s\n' "$HOME" "${entrypoint#~/}" ;;
        /*) printf '%s\n' "$entrypoint" ;;
        *) printf '%s/%s\n' "$PROJECT_ROOT" "$entrypoint" ;;
    esac
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

has_frontmatter_name() {
    local file="$1"
    awk '
        BEGIN {in_fm=0; found=0}
        /^---$/ {
            if (in_fm) {
                exit found ? 0 : 1
            }
            in_fm=1
            next
        }
        in_fm && /^name:/ {found=1}
        END {exit found ? 0 : 1}
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

render_skill_source() {
    local src="$1"
    local name="$2"
    local dest="$3"
    local preamble="${4:-}"
    local adjusted
    adjusted="$(mktemp)"

    if [ "$(head -n 1 "$src")" = "---" ]; then
        if has_frontmatter_name "$src"; then
            awk -v name="$name" '
                BEGIN {in_fm=0; replaced=0}
                /^---$/ {
                    print
                    if (!in_fm) {
                        in_fm=1
                    } else {
                        in_fm=0
                    }
                    next
                }
                in_fm && /^name:/ {
                    print "name: " name
                    replaced=1
                    next
                }
                {print}
            ' "$src" > "$adjusted"
        else
            awk -v name="$name" '
                NR == 1 && $0 == "---" {
                    print
                    print "name: " name
                    next
                }
                {print}
            ' "$src" > "$adjusted"
        fi
    else
        {
            printf '%s\n' '---'
            printf 'name: %s\n' "$name"
            printf 'description: Installed roster skill %s.\n' "$name"
            printf '%s\n\n' '---'
            cat "$src"
        } > "$adjusted"
    fi

    mkdir -p "$(dirname "$dest")"

    if grep -q '^preamble: true' "$adjusted" && [ -n "$preamble" ] && [ -f "$preamble" ]; then
        awk '
            {print}
            /^---$/ {
                seen++
                if (seen == 2) exit
            }
        ' "$adjusted" > "$dest"
        printf '\n' >> "$dest"
        cat "$preamble" >> "$dest"
        printf '\n' >> "$dest"
        awk '
            /^---$/ {
                seen++
                next
            }
            seen >= 2 {print}
        ' "$adjusted" >> "$dest"
    else
        cp "$adjusted" "$dest"
    fi

    rm -f "$adjusted"
}

render_recruit_skill() {
    local src="$1"
    local dest="$2"
    mkdir -p "$(dirname "$dest")"
    {
        printf '%s\n' '---'
        printf '%s\n' 'name: recruit'
        printf '%s\n' 'description: Use when the user invokes /recruit, $recruit, recruit update, or asks to assemble, audit, update, or govern an agent team using mathiasbourgoin/roster.'
        printf '%s\n\n' '---'
        strip_frontmatter "$src"
    } > "$dest"
}

sync_skill_sources_to_claude() {
    local out_dir="$1"
    local preamble="$2"
    shift 2
    local src

    for src in "$@"; do
        [ -f "$src" ] || continue
        local name
        name="$(extract_frontmatter_field "$src" "name")"
        [ -n "$name" ] || name="$(basename "$src" .md)"
        case "$name" in
            preamble|roster-preamble) continue ;;
        esac
        render_skill_source "$src" "$name" "$out_dir/$name.md" "$preamble"
    done
}

sync_skill_sources_to_codex_dir() {
    local out_dir="$1"
    local preamble="$2"
    shift 2
    local src

    mkdir -p "$out_dir"
    find "$out_dir" -maxdepth 1 -type f -name '*.md' -delete
    find "$out_dir" -mindepth 2 -maxdepth 2 -type f -name '.roster-managed' -print0 |
        while IFS= read -r -d '' marker; do
            rm -rf "$(dirname "$marker")"
        done

    for src in "$@"; do
        [ -f "$src" ] || continue
        local name
        name="$(extract_frontmatter_field "$src" "name")"
        [ -n "$name" ] || name="$(basename "$src" .md)"
        case "$name" in
            preamble|roster-preamble) continue ;;
        esac
        render_skill_source "$src" "$name" "$out_dir/$name/SKILL.md" "$preamble"
        touch "$out_dir/$name/.roster-managed"
    done
}

sync_skill_sources_to_codex_global() {
    local preamble="$1"
    shift
    sync_skill_sources_to_codex_dir "$CODEX_GLOBAL_SKILLS_DIR" "$preamble" "$@"
}

collect_skill_sources() {
    local files=()

    if [ -d "$HARNESS_DIR/skills" ]; then
        while IFS= read -r -d '' file; do
            files+=("$file")
        done < <(find "$HARNESS_DIR/skills" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)
    fi

    if [ -d "$ROSTER_SKILLS_DIR" ]; then
        while IFS= read -r -d '' file; do
            files+=("$file")
        done < <(find "$ROSTER_SKILLS_DIR" -mindepth 2 -maxdepth 2 -type f -name '*.md' -print0 | sort -z)
    fi

    printf '%s\0' "${files[@]}"
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

sync_skill_hooks() {
    local hooks_skills_dir="$HARNESS_DIR/hooks/skills"

    # Exit silently if no hooks/skills directory exists or it is empty
    if [ ! -d "$hooks_skills_dir" ]; then
        return 0
    fi

    # Build-time include inlining: process shared fragments into hooks
    # Finds all hook .md files under hooks/skills/, inlines any
    # "include: shared/<name>.md" references within the steps YAML block,
    # and writes the result as <hook>.inlined.md alongside the original.
    # roster-run reads .inlined.md if present, falling back to the original.
    find "$hooks_skills_dir" -name '*.md' ! -name '*.inlined.md' -print0 | \
    while IFS= read -r -d '' hook_file; do
        local inlined_file="${hook_file%.md}.inlined.md"
        local shared_dir="$HARNESS_DIR/hooks/shared"
        local has_include=0
        if grep -q 'include: shared/' "$hook_file" 2>/dev/null; then
            has_include=1
        fi

        if [ "$has_include" -eq 0 ]; then
            # No includes — remove stale inlined file if present
            rm -f "$inlined_file"
            continue
        fi

        # Inline include: references
        local content
        content="$(cat "$hook_file")"
        local result="$content"
        # Process each "  - include: shared/<name>.md" line in the steps block
        while IFS= read -r line; do
            if echo "$line" | grep -qE '^\s*-\s+include:\s+shared/'; then
                local fragment_name
                fragment_name="$(echo "$line" | sed -E 's/.*include:\s+shared\///' | sed 's/[[:space:]]*$//')"
                local fragment_path="$shared_dir/$fragment_name"
                if [ -f "$fragment_path" ]; then
                    local fragment_content
                    fragment_content="$(cat "$fragment_path")"
                    # Replace the include line with the fragment content
                    result="$(echo "$result" | awk -v line="$line" -v frag="$fragment_content" '
                        $0 == line { print frag; next }
                        { print }
                    ')"
                else
                    echo "sync_skill_hooks: include fragment not found: $fragment_path (in $hook_file)" >&2
                fi
            fi
        done < "$hook_file"

        printf '%s\n' "$result" > "$inlined_file"
    done
}

# Inline shared skill-hook fragments before any runtime projection
sync_skill_hooks

if runtime_enabled "claude-code"; then
    mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/rules"
    sync_markdown_dir "$HARNESS_DIR/agents" "$CLAUDE_DIR/agents"
    find "$CLAUDE_DIR/commands" -maxdepth 1 -type f -name '*.md' -delete
    mapfile -d '' SKILL_SOURCES < <(collect_skill_sources)
    sync_skill_sources_to_claude "$CLAUDE_DIR/commands" "$ROSTER_SKILLS_DIR/shared/preamble.md" "${SKILL_SOURCES[@]}"

    sync_markdown_dir "$HARNESS_DIR/rules" "$CLAUDE_DIR/rules"
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        render_recruit_skill "$HARNESS_DIR/agents/recruiter.md" "$CLAUDE_DIR/commands/recruit.md"
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
    CODEX_SKILLS_DIR="$(resolve_entrypoint "$(runtime_entrypoint "codex" ".agents/skills/")")"
    mkdir -p "$CODEX_SKILLS_DIR"
    mapfile -d '' SKILL_SOURCES < <(collect_skill_sources)
    sync_skill_sources_to_codex_dir "$CODEX_SKILLS_DIR" "$ROSTER_SKILLS_DIR/shared/preamble.md" "${SKILL_SOURCES[@]}"
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        render_recruit_skill "$HARNESS_DIR/agents/recruiter.md" "$CODEX_SKILLS_DIR/recruit/SKILL.md"
        touch "$CODEX_SKILLS_DIR/recruit/.roster-managed"
    else
        rm -rf "$CODEX_SKILLS_DIR/recruit"
    fi
fi

if runtime_enabled "codex-global"; then
    CODEX_GLOBAL_SKILLS_DIR="$(resolve_entrypoint "$(runtime_entrypoint "codex-global" "$CODEX_GLOBAL_SKILLS_DIR")")"
    mkdir -p "$CODEX_GLOBAL_SKILLS_DIR"
    mapfile -d '' SKILL_SOURCES < <(collect_skill_sources)
    sync_skill_sources_to_codex_global "$ROSTER_SKILLS_DIR/shared/preamble.md" "${SKILL_SOURCES[@]}"
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        render_recruit_skill "$HARNESS_DIR/agents/recruiter.md" "$CODEX_GLOBAL_SKILLS_DIR/recruit/SKILL.md"
        touch "$CODEX_GLOBAL_SKILLS_DIR/recruit/.roster-managed"
    fi
fi

# --- OpenCode ---
# Agents → .opencode/agents/<name>.md (flat, mode: subagent frontmatter)
# Skills → .opencode/commands/<name>.md (flat, same as Claude commands)
sync_agents_to_opencode() {
    local out_dir="$1"
    local src_dir="$2"
    mkdir -p "$out_dir"
    find "$out_dir" -maxdepth 1 -type f -name '*.md' -delete
    [ -d "$src_dir" ] || return 0
    find "$src_dir" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
        local name desc
        name="$(basename "$file" .md)"
        desc="$(extract_frontmatter_field "$file" "description")"
        {
            printf '%s\n' '---'
            printf 'description: %s\n' "${desc:-Roster agent $name}"
            printf 'mode: subagent\n'
            printf '%s\n\n' '---'
            strip_frontmatter "$file"
        } > "$out_dir/$name.md"
    done
}

sync_skill_sources_to_opencode_commands() {
    local out_dir="$1"
    local preamble="$2"
    shift 2
    mkdir -p "$out_dir"
    find "$out_dir" -maxdepth 1 -type f -name '*.md' -delete
    local src name
    for src in "$@"; do
        [ -f "$src" ] || continue
        name="$(extract_frontmatter_field "$src" "name")"
        [ -n "$name" ] || name="$(basename "$src" .md)"
        case "$name" in
            preamble|roster-preamble) continue ;;
        esac
        render_skill_source "$src" "$name" "$out_dir/$name.md" "$preamble"
    done
}

if runtime_enabled "opencode"; then
    OPENCODE_DIR="$(resolve_entrypoint "$(runtime_entrypoint "opencode" ".opencode")")"
    mapfile -d '' SKILL_SOURCES < <(collect_skill_sources)
    sync_agents_to_opencode "$OPENCODE_DIR/agents" "$HARNESS_DIR/agents"
    sync_skill_sources_to_opencode_commands "$OPENCODE_DIR/commands" "$ROSTER_SKILLS_DIR/shared/preamble.md" "${SKILL_SOURCES[@]}"
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        render_recruit_skill "$HARNESS_DIR/agents/recruiter.md" "$OPENCODE_DIR/commands/recruit.md"
        # Also install recruiter as an agent for @recruiter invocation
        local_desc="$(extract_frontmatter_field "$HARNESS_DIR/agents/recruiter.md" "description")"
        {
            printf '%s\n' '---'
            printf 'description: %s\n' "${local_desc:-Agent Recruiter}"
            printf 'mode: subagent\n'
            printf '%s\n\n' '---'
            strip_frontmatter "$HARNESS_DIR/agents/recruiter.md"
        } > "$OPENCODE_DIR/agents/recruiter.md"
    fi
fi

# --- Pi (pi.dev) ---
# Same SKILL.md directory structure as Codex — reuse sync_skill_sources_to_codex_dir
if runtime_enabled "pi"; then
    PI_SKILLS_DIR="$(resolve_entrypoint "$(runtime_entrypoint "pi" ".pi/skills")")"
    mapfile -d '' SKILL_SOURCES < <(collect_skill_sources)
    sync_skill_sources_to_codex_dir "$PI_SKILLS_DIR" "$ROSTER_SKILLS_DIR/shared/preamble.md" "${SKILL_SOURCES[@]}"
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        render_recruit_skill "$HARNESS_DIR/agents/recruiter.md" "$PI_SKILLS_DIR/recruit/SKILL.md"
        touch "$PI_SKILLS_DIR/recruit/.roster-managed"
    fi
fi

# --- GitHub Copilot ---
# Copilot has no skill loader — project via:
#   .github/copilot-instructions.md  (always injected into all Copilot requests)
#   .github/instructions/<name>.instructions.md  (per-skill, always-on with applyTo: "**)
generate_copilot_instructions() {
    local github_dir="$1"
    mkdir -p "$github_dir" "$github_dir/instructions"

    # Global instructions: recruiter description + harness overview
    {
        printf '# Copilot Instructions\n\n'
        printf 'This project uses the [roster](https://github.com/mathiasbourgoin/roster) harness.\n'
        printf 'See `AGENTS.md` for the installed team roster and execution model.\n\n'
        if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
            local desc
            desc="$(extract_frontmatter_field "$HARNESS_DIR/agents/recruiter.md" "description")"
            printf '## Recruiter\n\n%s\n\n' "${desc:-Assemble and update the agent team with /recruit.}"
            printf 'Run `/recruit` to assemble or update the agent team.\n'
            printf 'Run `/recruit update` to self-update the recruiter and installed agents.\n'
        fi
    } > "$github_dir/copilot-instructions.md"

    # Per-agent instructions (path-scoped: always-on)
    find "$github_dir/instructions" -maxdepth 1 -name '*.instructions.md' -delete
    if [ -d "$HARNESS_DIR/agents" ]; then
        find "$HARNESS_DIR/agents" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
            local name
            name="$(basename "$file" .md)"
            {
                printf '%s\n' '---'
                printf 'applyTo: "**"\n'
                printf '%s\n\n' '---'
                strip_frontmatter "$file"
            } > "$github_dir/instructions/$name.instructions.md"
        done
    fi
}

if runtime_enabled "copilot"; then
    COPILOT_GITHUB_DIR="$(resolve_entrypoint "$(runtime_entrypoint "copilot" ".github")")"
    generate_copilot_instructions "$COPILOT_GITHUB_DIR"
fi

printf 'Synced shared harness from %s\n' "$HARNESS_DIR"
