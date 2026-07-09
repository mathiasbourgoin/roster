#!/usr/bin/env bash
# Sync canonical shared harness files from .harness/ into runtime-compatible files.
# Usage: ./scripts/sync-harness.sh [project-root] [--check]
#   --check : do not write. Regenerate projections into a sandbox and diff against the
#             committed ones; exit nonzero on drift (stale or hand-edited projections).

set -euo pipefail

CHECK=0
PROJECT_ROOT=""
for _arg in "$@"; do
    case "$_arg" in
        --check) CHECK=1 ;;
        *) [ -z "$PROJECT_ROOT" ] && PROJECT_ROOT="$_arg" ;;
    esac
done
PROJECT_ROOT="${PROJECT_ROOT:-$PWD}"
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

# Fail loudly on a corrupt manifest. Otherwise runtime_enabled() swallows the jq
# parse error inside its `if`, every runtime reads as disabled, and a sync (or a
# --check regen) silently produces empty projections and "passes".
if ! jq empty "$MANIFEST" 2>/dev/null; then
    echo "Shared harness manifest is not valid JSON: $MANIFEST" >&2
    exit 1
fi

# --check: regenerate into a sandbox and diff against the committed projections.
# Single source of rendering truth = this same script (re-invoked in normal mode on a
# copy). HOME/CODEX_HOME are redirected into the sandbox so absolute (~) entrypoints
# never touch the real tree. Drift = a projection that is stale or was hand-edited.
#
# Limitation: detection is one-directional (generated→real), so a file that exists
# only in the real tree is ignored (it may be legitimately unmanaged, e.g.
# .claude/patterns). This catches stale, hand-edited, and missing projections, but NOT
# files that should have been REMOVED — a deleted source's lingering projection, or a
# runtime turned off while its projections stay committed. A normal `sync` cleans those for the
# MARKER-PRUNED dirs (Codex `.agents/skills`, `.codex/agents`) — but NOT for the overwrite-only
# dirs (`.claude/agents`, `.claude/rules`, `.opencode/agents`), which preserve user files and so
# leave a removed source's projection behind until it is deleted by hand.
if [ "$CHECK" -eq 1 ]; then
    need_cmd diff
    _CK_TMP="$(mktemp -d)"
    trap 'rm -rf "$_CK_TMP"' EXIT

    cp -R "$HARNESS_DIR" "$_CK_TMP/.harness"
    [ -d "$ROSTER_SKILLS_DIR" ] && cp -R "$ROSTER_SKILLS_DIR" "$_CK_TMP/skills"
    [ -d "$PROJECT_ROOT/recruiter" ] && cp -R "$PROJECT_ROOT/recruiter" "$_CK_TMP/recruiter"

    if ! HOME="$_CK_TMP" CODEX_HOME="$_CK_TMP/.codex" bash "$0" "$_CK_TMP" >"$_CK_TMP/.synclog" 2>&1; then
        echo "✗ harness-sync: sandbox regeneration failed:" >&2
        sed 's/^/    /' "$_CK_TMP/.synclog" >&2
        exit 1
    fi

    _drift=0
    # Compare each runtime entrypoint dir. Direction is gen→real: a file the sandbox
    # produced that is missing or differs in the tree is drift; files that exist only
    # in the real tree (non-managed, e.g. .github/workflows) are ignored.
    # Exception: settings.local.json is excluded from drift detection by design — it is
    # gitignored and user-local, never managed by sync-harness.
    for _rel in .claude .agents .codex .opencode .github; do
        _gen="$_CK_TMP/$_rel"
        _real="$PROJECT_ROOT/$_rel"
        [ -d "$_gen" ] || continue
        if [ ! -d "$_real" ]; then
            echo "✗ harness-sync: $_rel was generated but is absent from the tree (unprojected)." >&2
            _drift=1
            continue
        fi
        _all_diff="$( { LC_ALL=C diff -rq -x 'settings.local.json' -x '.roster-version' -x '.git' "$_gen" "$_real" 2>&1 || true; } )"
        _out=""
        _stale=""
        if [ -n "$_all_diff" ]; then
            _out="$(printf '%s\n' "$_all_diff" | { grep -v -- "Only in $_real" || true; })"
            # Stale projection detection: files that exist in the real tree but NOT in the generated
            # tree are lingering projections from deleted or renamed sources. Report them with a
            # cleanup command so they can be removed deliberately.
            _stale="$(printf '%s\n' "$_all_diff" \
                | { grep -- "Only in $_real" || true; } \
                | sed "s|Only in ${_real}/\(.*\): \(.*\)|\1/\2|" \
                | { grep '\.md$' || true; })"
        fi
        if [ -n "$_out" ]; then
            echo "✗ harness-sync: $_rel drifts from .harness source:" >&2
            printf '%s\n' "$_out" | sed 's|'"$_CK_TMP"'|<regenerated>|g; s|^|    |' >&2
            _drift=1
        fi
        if [ -n "$_stale" ]; then
            echo "✗ harness-sync: stale projection(s) in $_rel (source deleted, projection still present):" >&2
            printf '%s\n' "$_stale" | sed "s|^|    ${_rel}/|" >&2
            echo "  To clean up: $(printf '%s\n' "$_stale" | sed "s|^|${_real}/|" | tr '\n' ' ' | xargs echo rm -f)" >&2
            _drift=1
        fi
    done

    if [ "$_drift" -eq 1 ]; then
        echo "" >&2
        echo "Projections are out of sync with .harness/. Edit the source under .harness/" >&2
        echo "(never hand-edit a projected file), then run ./scripts/sync-harness.sh and commit." >&2
        exit 1
    fi

    # Validate harness.json layers.skills: every entry must point to an existing skill source file.
    _skills_invalid=0
    if [ -f "$MANIFEST" ] && command -v jq >/dev/null 2>&1; then
        while IFS= read -r _entry; do
            _sname=$(echo "$_entry" | jq -r '.name')
            _sdomain=$(echo "$_entry" | jq -r '.domain // empty')
            _sfile=$(echo "$_entry" | jq -r '.file // .name')
            if [ -z "$_sdomain" ]; then
                echo "✗ harness-sync: layers.skills entry '${_sname}' is missing the 'domain' field." >&2
                _skills_invalid=1
                continue
            fi
            _src="${HARNESS_DIR%/.harness}/skills/${_sdomain}/${_sfile}.md"
            if [ ! -f "$_src" ]; then
                echo "✗ harness-sync: layers.skills entry '${_sname}' (domain: ${_sdomain}) has no source file at skills/${_sdomain}/${_sname}.md" >&2
                _skills_invalid=1
            fi
        done < <(jq -c '.layers.skills // [] | .[]' "$MANIFEST" 2>/dev/null)
    fi
    if [ "$_skills_invalid" -eq 1 ]; then
        echo "harness.json layers.skills validation failed — remove stale entries or add the missing skill files." >&2
        exit 1
    fi

    echo "✓ harness-sync: all runtime projections match the .harness source."
    exit 0
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
    # Overwrite roster's projected files in place; do NOT blanket-delete *.md here — this dir
    # (.claude/agents, .claude/rules, .opencode/agents) may also hold the USER's own files, and a
    # blanket delete would wipe them. A roster file removed from source lingers here and stays
    # loadable (e.g. a stale agent the runtime still dispatches) until deleted by hand — not inert,
    # but far preferable to wiping user data. (Codex's projection prunes safely via markers; these
    # overwrite-only dirs do not yet — see the --check limitation note above.)
    if [ -d "$src" ]; then
        find "$src" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
            local base; base="$(basename "$file")"
            # Full-basename passthrough copy (agent/rule .md): block traversal tokens but allow any
            # legitimate filename — kebab validation would wrongly reject a consumer's odd filename.
            reject_traversal "$base"
            cp "$file" "$dst/$base"
        done
    fi
}

has_frontmatter_name() {
    local file="$1"
    awk '
        BEGIN {in_fm=0; found=0}
        /^---\r?$/ {
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
    # Consume ONLY the two frontmatter delimiters (the first two `---` lines). Body markdown
    # horizontal rules (`---` after the closing delimiter) must survive into projections.
    # If the file has NO frontmatter (line 1 is not `---`), emit it verbatim — never swallow
    # a frontmatter-less file by waiting for a closing delimiter that never comes.
    awk '
        BEGIN {seen=0; nofm=0}
        NR==1 && $0 !~ /^---\r?$/ {nofm=1}
        nofm {print; next}
        seen < 2 && /^---\r?$/ {seen++; next}
        seen >= 2 {print}
    ' "$file"
}

# A skill/agent name becomes a path component (.../<name>/SKILL.md, .../<name>.md). Reject anything
# that isn't a strict lowercase slug BEFORE it is used in a path, so a crafted/malformed `name:`
# frontmatter can't traverse out of the projection dir. Sources are roster-controlled, so this is
# defense-in-depth — it fails closed rather than trusting the input.
require_safe_name() {
    case "$1" in
        ""|-*|*[!a-z0-9-]*)
            echo "sync-harness: refusing unsafe name as a path component (must match ^[a-z0-9][a-z0-9-]*\$): '$1'" >&2
            exit 1 ;;
    esac
}

# For copies that preserve a file's FULL basename (resources, raw .md passthroughs) the name is
# arbitrary (any extension/case) so kebab validation would wrongly reject legitimate files. A real
# file's basename can never be '.'/'..'/contain '/', so this only needs to block the traversal
# tokens — defense-in-depth that never false-positives on a normal filename.
reject_traversal() {
    case "$1" in
        ""|.|..|*/*)
            echo "sync-harness: refusing path-unsafe filename as a path component: '$1'" >&2
            exit 1 ;;
    esac
}

render_skill_source() {
    local src="$1"
    local name="$2"
    local dest="$3"
    local preamble="${4:-}"
    local adjusted
    adjusted="$(mktemp)"

    if [ "$(head -n 1 "$src" | tr -d '\r')" = "---" ]; then
        if has_frontmatter_name "$src"; then
            awk -v name="$name" '
                BEGIN {in_fm=0; replaced=0}
                /^---\r?$/ {
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
                NR == 1 && $0 ~ /^---\r?$/ {
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
        # Emit the frontmatter (through the closing delimiter), then the preamble, then the
        # body. Both halves consume ONLY the two frontmatter delimiters so body markdown
        # horizontal rules (`---`) survive — the body half reuses strip_frontmatter (single
        # source of truth) rather than a parallel "strip every ---" awk.
        awk '
            {print}
            /^---\r?$/ {
                seen++
                if (seen == 2) exit
            }
        ' "$adjusted" > "$dest"
        printf '\n' >> "$dest"
        strip_frontmatter "$preamble" >> "$dest"
        printf '\n' >> "$dest"
        # Frontmatter-gated preamble fragments: Pipeline State only for staged phases
        # (phase: non-null), Friction Log only for friction_log: true. Gates read the
        # parsed frontmatter (extract_frontmatter_field) normalized against trailing
        # YAML comments, quotes, and CR — never the body. Fragments are injected
        # body-only (strip_frontmatter), same as the core preamble.
        local frag_dir phase_val friction_val
        frag_dir="$(dirname "$preamble")"
        phase_val="$(extract_frontmatter_field "$adjusted" "phase" | sed 's/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"']$//; s/\r$//; s/[[:space:]]*$//')"
        friction_val="$(extract_frontmatter_field "$adjusted" "friction_log" | sed 's/[[:space:]]*#.*$//; s/^["'"'"']//; s/["'"'"']$//; s/\r$//; s/[[:space:]]*$//')"
        if [ -n "$phase_val" ] && [ "$phase_val" != "null" ] && [ -f "$frag_dir/preamble-pipeline.md" ]; then
            strip_frontmatter "$frag_dir/preamble-pipeline.md" >> "$dest"
            printf '\n' >> "$dest"
        fi
        if [ "$friction_val" = "true" ] && [ -f "$frag_dir/preamble-friction.md" ]; then
            strip_frontmatter "$frag_dir/preamble-friction.md" >> "$dest"
            printf '\n' >> "$dest"
        fi
        strip_frontmatter "$adjusted" >> "$dest"
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

# Copy a skill's bundled reference resources (generic docs that ship WITH the
# skill, loaded on demand) next to its projected form. Source resources live in
# "<src-without-.md>.resources/". For dir-based runtimes (Codex/OpenCode: <name>/SKILL.md)
# they go inside "<out_dir>/<name>/"; for the flat Claude command form (<name>.md) they go
# in a sibling "<out_dir>/<name>.resources/". No-op if absent.
copy_skill_resources() {
    local src="$1" name="$2" out_dir="$3" kind="$4"
    # Resources bundle ONLY for dir-based runtimes (Codex/OpenCode: <name>/SKILL.md),
    # where a sibling .md is a passive resource. The flat Claude command form
    # scans subdirs and would register each resource as an invocable command, so
    # we deliberately skip resources there.
    [ "$kind" = "dir" ] || return 0
    local res_dir="${src%.md}.resources"
    [ -d "$res_dir" ] || return 0
    local target="$out_dir/$name"
    mkdir -p "$target"
    find "$res_dir" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' f; do
        local rbase; rbase="$(basename "$f")"
        reject_traversal "$rbase"
        cp "$f" "$target/$rbase"
    done
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
            preamble*|roster-preamble*) continue ;;  # reserved prefix: preamble fragments, never standalone skills
        esac
        require_safe_name "$name"
        render_skill_source "$src" "$name" "$out_dir/$name.md" "$preamble"
        copy_skill_resources "$src" "$name" "$out_dir" "flat"
    done
}

sync_skill_sources_to_skill_dir() {
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
            preamble*|roster-preamble*) continue ;;  # reserved prefix: preamble fragments, never standalone skills
        esac
        require_safe_name "$name"
        local extension_owned=0
        if [ -f "$out_dir/$name/.roster-extension" ]; then
            extension_owned=1
        elif [ -f "$HARNESS_DIR/extensions.json" ]; then
            # Fail closed (audit M4/R6): ownership is only determinable from a
            # registry whose full shape is valid — a JSON object whose
            # .extensions is an array. Anything else refuses the sync (a
            # malformed object must not read as "unowned").
            if ! jq -e 'type == "object" and (.extensions | type == "array")' \
                "$HARNESS_DIR/extensions.json" >/dev/null 2>&1; then
                echo "Refusing to sync: $HARNESS_DIR/extensions.json is unreadable or malformed (expected an object with an extensions array)." >&2
                echo "Fix or remove the extension registry, then retry sync." >&2
                exit 1
            fi
            local candidate="$out_dir/$name/SKILL.md"
            case "$candidate" in
                "$PROJECT_ROOT"/*)
                    local candidate_rel="${candidate#"$PROJECT_ROOT"/}"
                    local owned_probe
                    owned_probe="$(jq --arg target "$candidate_rel" \
                        'any(.extensions[]?.installed_files[]?; .target == $target)' \
                        "$HARNESS_DIR/extensions.json" 2>/dev/null)" || {
                        echo "Refusing to sync: ownership probe failed against $HARNESS_DIR/extensions.json." >&2
                        exit 1
                    }
                    [ "$owned_probe" = "true" ] && extension_owned=1
                    ;;
            esac
        fi
        if [ "$extension_owned" -eq 1 ]; then
            echo "Refusing to overwrite extension-owned skill '$name' at $out_dir/$name" >&2
            echo "Remove the extension first with roster-extension remove, then retry sync." >&2
            exit 1
        fi
        render_skill_source "$src" "$name" "$out_dir/$name/SKILL.md" "$preamble"
        touch "$out_dir/$name/.roster-managed"
        copy_skill_resources "$src" "$name" "$out_dir" "dir"
    done
}

sync_skill_sources_to_codex_global() {
    local preamble="$1"
    shift
    sync_skill_sources_to_skill_dir "$CODEX_GLOBAL_SKILLS_DIR" "$preamble" "$@"
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

# --- Codex agent projection ---
# Codex exposes the agent team through TWO primitives (see
# https://developers.openai.com/codex/subagents and /codex/skills):
#   1. First-class custom agents — TOML at .codex/agents/<name>.toml (spawnable subagents,
#      required fields name/description/developer_instructions). This is the analog of
#      Claude's .claude/agents/ and OpenCode's mode:subagent.
#   2. Invocable skills — .agents/skills/<name>/SKILL.md so the user can $name them and
#      Codex can implicitly select them by description.
# The recruiter is excluded from the agent-skill projection — it is already projected as
# the dedicated `recruit` skill. `model:` is intentionally NOT emitted: roster's model
# slugs (opus/sonnet/haiku) are Claude-specific; omitting it lets the Codex agent inherit
# the session model.

# Escape a value for use inside a TOML basic (double-quoted) string.
toml_escape_basic() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Agents → .codex/agents/<name>.toml (Codex first-class custom-agent primitive).
# Marker written as the first line of every roster-generated Codex agent TOML. Cleanup only
# removes files carrying it, so user-authored agents in .codex/agents/ are never destroyed.
CODEX_TOML_MARKER="# roster-managed — generated by sync-harness.sh; edits are overwritten"

sync_agents_to_codex_toml() {
    local out_dir="$1"
    local src_dir="$2"
    mkdir -p "$out_dir"
    # Remove only roster-managed TOMLs (those carrying our marker). .codex/agents/ is the
    # user's project-scoped custom-agent dir — never blanket-delete *.toml there.
    find "$out_dir" -maxdepth 1 -type f -name '*.toml' -print0 | while IFS= read -r -d '' existing; do
        IFS= read -r _first < "$existing" || true
        if [ "$_first" = "$CODEX_TOML_MARKER" ]; then rm -f "$existing"; fi
    done
    [ -d "$src_dir" ] || return 0
    find "$src_dir" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
        local name desc body esc_body
        name="$(basename "$file" .md)"
        require_safe_name "$name"   # basename can yield '.'/'..' (e.g. a file named '...md') — fail closed
        desc="$(extract_frontmatter_field "$file" "description")"
        body="$(strip_frontmatter "$file")"
        # Encode the body as a TOML BASIC multiline string ("""), escaping backslash then
        # double-quote. Every " becomes \" so no """ delimiter can form inside the value —
        # ANY markdown body is representable, so an agent is never silently dropped.
        esc_body="$(printf '%s' "$body" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
        {
            printf '%s\n' "$CODEX_TOML_MARKER"
            printf 'name = "%s"\n' "$(toml_escape_basic "$name")"
            printf 'description = "%s"\n' "$(toml_escape_basic "${desc:-Roster agent $name}")"
            printf 'developer_instructions = """\n'
            printf '%s\n' "$esc_body"
            printf '"""\n'
        } > "$out_dir/$name.toml"
    done
}

# Agents → .agents/skills/<name>/SKILL.md (also $name-invocable on Codex). Skips recruiter.
sync_agents_to_codex_skills() {
    local skills_dir="$1"
    local src_dir="$2"
    [ -d "$src_dir" ] || return 0
    find "$src_dir" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
        local name desc
        name="$(basename "$file" .md)"
        require_safe_name "$name"   # basename can yield '.'/'..' (e.g. a file named '...md') — fail closed
        [ "$name" = "recruiter" ] && continue
        desc="$(extract_frontmatter_field "$file" "description")"
        mkdir -p "$skills_dir/$name"
        {
            printf '%s\n' '---'
            printf 'name: %s\n' "$name"
            printf 'description: %s\n' "${desc:-Roster agent $name}"
            printf '%s\n\n' '---'
            strip_frontmatter "$file"
        } > "$skills_dir/$name/SKILL.md"
        touch "$skills_dir/$name/.roster-managed"
    done
}

if runtime_enabled "codex"; then
    CODEX_SKILLS_DIR="$(resolve_entrypoint "$(runtime_entrypoint "codex" ".agents/skills/")")"
    CODEX_AGENTS_DIR="$PROJECT_ROOT/.codex/agents"
    mkdir -p "$CODEX_SKILLS_DIR"
    mapfile -d '' SKILL_SOURCES < <(collect_skill_sources)
    sync_skill_sources_to_skill_dir "$CODEX_SKILLS_DIR" "$ROSTER_SKILLS_DIR/shared/preamble.md" "${SKILL_SOURCES[@]}"
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        render_recruit_skill "$HARNESS_DIR/agents/recruiter.md" "$CODEX_SKILLS_DIR/recruit/SKILL.md"
        touch "$CODEX_SKILLS_DIR/recruit/.roster-managed"
    else
        rm -rf "$CODEX_SKILLS_DIR/recruit"
    fi
    # Project the agent team: spawnable TOML subagents + invocable skills.
    sync_agents_to_codex_toml "$CODEX_AGENTS_DIR" "$HARNESS_DIR/agents"
    sync_agents_to_codex_skills "$CODEX_SKILLS_DIR" "$HARNESS_DIR/agents"
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
# Skills → .opencode/skills/<name>/SKILL.md (dir form, same as Codex — OpenCode native discovery)
sync_agents_to_opencode() {
    local out_dir="$1"
    local src_dir="$2"
    mkdir -p "$out_dir"
    # Overwrite in place; do NOT blanket-delete *.md — .opencode/agents may hold the user's own
    # agents and a blanket delete would wipe them (the Codex projection is already marker-safe).
    # A roster agent removed from source lingers and stays loadable until deleted by hand — not
    # inert, but preferable to wiping a user's own agents. (Converge on marker-based prune later.)
    [ -d "$src_dir" ] || return 0
    find "$src_dir" -maxdepth 1 -type f -name '*.md' -print0 | while IFS= read -r -d '' file; do
        local name desc
        name="$(basename "$file" .md)"
        require_safe_name "$name"   # basename can yield '.'/'..' (e.g. a file named '...md') — fail closed
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

if runtime_enabled "opencode"; then
    OPENCODE_DIR="$(resolve_entrypoint "$(runtime_entrypoint "opencode" ".opencode")")"
    mapfile -d '' SKILL_SOURCES < <(collect_skill_sources)
    sync_agents_to_opencode "$OPENCODE_DIR/agents" "$HARNESS_DIR/agents"
    # OpenCode natively discovers Agent Skills at .opencode/skills/<name>/SKILL.md (verified) —
    # the SAME shape Codex uses and that install.sh writes. Emit skills there, NOT to
    # .opencode/commands/ (OpenCode does not read that path as skills).
    sync_skill_sources_to_skill_dir "$OPENCODE_DIR/skills" "$ROSTER_SKILLS_DIR/shared/preamble.md" "${SKILL_SOURCES[@]}"
    # Migrate away from the obsolete .opencode/commands/ projection a PRIOR roster sync may have
    # written. Remove ONLY the command files roster itself generated (one per CURRENT skill name,
    # plus recruit) — never `rm -rf` the dir, which could hold the user's own files or, with a
    # custom absolute entrypoint, point outside the project. Drop the dir only if it ends up empty.
    # Known limitation: a command file for a skill that was later REMOVED/RENAMED is not matched
    # here and lingers — that is inert (OpenCode reads skills/, not commands/) and deleting
    # unmatched files would risk the user's own; remove them by hand if desired.
    if [ -d "$OPENCODE_DIR/commands" ]; then
        for _src in "${SKILL_SOURCES[@]}"; do
            [ -f "$_src" ] || continue
            _nm="$(extract_frontmatter_field "$_src" "name")"; [ -n "$_nm" ] || _nm="$(basename "$_src" .md)"
            require_safe_name "$_nm"
            rm -f "$OPENCODE_DIR/commands/$_nm.md"
        done
        rm -f "$OPENCODE_DIR/commands/recruit.md"
        rmdir "$OPENCODE_DIR/commands" 2>/dev/null || true
    fi
    if [ -f "$HARNESS_DIR/agents/recruiter.md" ]; then
        render_recruit_skill "$HARNESS_DIR/agents/recruiter.md" "$OPENCODE_DIR/skills/recruit/SKILL.md"
        touch "$OPENCODE_DIR/skills/recruit/.roster-managed"
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
            require_safe_name "$name"   # basename can yield '.'/'..' (e.g. a file named '...md') — fail closed
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

# Regenerate AGENTS.md skill-catalog rows from frontmatter (writer counterpart of
# check-catalog-sync, which stays the verifier). Best-effort: dev-checkout only.
if command -v node >/dev/null 2>&1 && [ -f "$PROJECT_ROOT/scripts/populate-catalog-rows.js" ]; then
    node "$PROJECT_ROOT/scripts/populate-catalog-rows.js" || echo "⚠ catalog-rows regeneration failed — run node scripts/populate-catalog-rows.js manually" >&2
fi

printf 'Synced shared harness from %s\n' "$HARNESS_DIR"
