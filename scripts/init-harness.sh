#!/usr/bin/env bash
# Initialize a canonical .harness tree for a target project using roster defaults,
# then project it into runtime-specific files.
# Usage: ./scripts/init-harness.sh <project-root> [profile]

set -euo pipefail

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2; exit 1
    fi
}
need_cmd jq

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ROOT="${1:-}"
PROFILE="${2:-developer}"
FORCE="${3:-}"

if [ -z "$PROJECT_ROOT" ]; then
    echo "Usage: ./scripts/init-harness.sh <project-root> [profile] [--force]" >&2
    exit 1
fi

case "$PROFILE" in
    core|developer|security|full) ;;
    *)
        echo "Unsupported profile: $PROFILE" >&2
        exit 1
        ;;
esac

HARNESS_DIR="$PROJECT_ROOT/.harness"
AGENTS_DIR="$HARNESS_DIR/agents"
SKILLS_DIR="$HARNESS_DIR/skills"
RULES_DIR="$HARNESS_DIR/rules"
HOOKS_DIR="$HARNESS_DIR/hooks"
MANIFEST="$HARNESS_DIR/harness.json"

detect_project_metadata() {
    local root="$1"
    local project_name languages frameworks ci issue_tracker
    local -a langs=()
    local -a fws=()

    project_name="$(basename "$root")"
    ci="null"
    issue_tracker="null"

    if [ -f "$root/package.json" ]; then
        langs+=("javascript")
        if jq -e '.dependencies.react or .devDependencies.react' "$root/package.json" >/dev/null 2>&1; then
            fws+=("react")
        fi
        if jq -e '.dependencies.next or .devDependencies.next' "$root/package.json" >/dev/null 2>&1; then
            fws+=("nextjs")
        fi
        if jq -e '.dependencies.vue or .devDependencies.vue' "$root/package.json" >/dev/null 2>&1; then
            fws+=("vue")
        fi
        if jq -e '.dependencies.svelte or .devDependencies.svelte' "$root/package.json" >/dev/null 2>&1; then
            fws+=("svelte")
        fi
    fi

    [ -f "$root/tsconfig.json" ] && langs+=("typescript")
    [ -f "$root/pyproject.toml" ] || [ -f "$root/pytest.ini" ] || [ -f "$root/conftest.py" ] && langs+=("python")
    [ -f "$root/Cargo.toml" ] && langs+=("rust")
    [ -f "$root/go.mod" ] && langs+=("go")
    [ -f "$root/dune-project" ] && { langs+=("ocaml"); fws+=("dune"); }
    [ -f "$root/mix.exs" ] && { langs+=("elixir"); fws+=("phoenix"); }
    [ -f "$root/Gemfile" ] && langs+=("ruby")
    [ -f "$root/composer.json" ] && langs+=("php")

    [ -d "$root/.github/workflows" ] && ci='"github-actions"'
    [ -f "$root/.gitlab-ci.yml" ] && ci='"gitlab-ci"'
    [ -f "$root/Jenkinsfile" ] && ci='"jenkins"'

    if [ -d "$root/.git" ]; then
        local origin_url
        origin_url="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
        if printf '%s' "$origin_url" | grep -q 'github.com'; then
            issue_tracker='"github"'
        elif printf '%s' "$origin_url" | grep -q 'gitlab'; then
            issue_tracker='"gitlab"'
        fi
    fi

    mapfile -t langs < <(printf '%s\n' "${langs[@]}" | awk 'NF && !seen[$0]++')
    mapfile -t fws < <(printf '%s\n' "${fws[@]}" | awk 'NF && !seen[$0]++')

    languages="$(printf '%s\n' "${langs[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
    frameworks="$(printf '%s\n' "${fws[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')"

    jq -n \
      --arg project_name "$project_name" \
      --argjson languages "$languages" \
      --argjson frameworks "$frameworks" \
      --argjson ci "$ci" \
      --argjson issue_tracker "$issue_tracker" \
      '{
        name: $project_name,
        languages: $languages,
        frameworks: $frameworks,
        ci: $ci,
        issue_tracker: $issue_tracker
      }'
}

mkdir -p "$AGENTS_DIR" "$SKILLS_DIR" "$RULES_DIR" "$HOOKS_DIR"

copy_files() {
    local target_dir="$1"
    shift
    local rel
    for rel in "$@"; do
        cp "$REPO_ROOT/$rel" "$target_dir/$(basename "$rel")"
    done
}

CORE_AGENTS=(
    "recruiter/recruiter.md"
    "agents/management/tech-lead.md"
    "agents/testing/reviewer.md"
)

DEVELOPER_AGENTS=(
    "agents/backend/implementer.md"
    "agents/testing/qa.md"
    "agents/management/architect.md"
    "agents/management/kb-agent.md"
    "agents/management/planner.md"
)

SECURITY_AGENTS=(
    "agents/security/mcp-vetter.md"
)

FULL_EXTRA_AGENTS=(
    "recruiter/recruiter.md"
    "agents/management/harness-builder.md"
    "agents/management/context-manager.md"
    "agents/management/error-coordinator.md"
    "agents/management/project-auditor.md"
    "agents/management/skill-creator.md"
    "agents/devops/tool-provisioner.md"
    "agents/devops/performance-monitor.md"
    "agents/specialist/expert-debugger.md"
    "agents/specialist/config-migrator.md"
)

CORE_RULES=(
    "rules/safety/sycophancy.md"
    "rules/safety/escalation.md"
    "rules/common/code-quality.md"
    "rules/governance/human-validation.md"
)

CORE_HOOKS=(
    "hooks/safety/block-dangerous-commands.md"
)

DEVELOPER_HOOKS=(
    "hooks/quality/post-edit-lint.md"
)

DEVELOPER_SKILLS=(
    "skills/testing/tdd-workflow.md"
    "skills/kb/kb-update.md"
    "skills/workflow/git-conventions.md"
)

FULL_EXTRA_SKILLS=(
    "skills/kb/ambiguity-auditor.md"
    "skills/kb/code-quality-auditor.md"
    "skills/kb/spec-compliance-auditor.md"
    "skills/kb/harness-validator.md"
)

if [ -d "$HARNESS_DIR" ] && [ "$FORCE" != "--force" ]; then
    echo "Harness already exists at $HARNESS_DIR. Use --force to overwrite." >&2
    exit 1
fi

find "$AGENTS_DIR" -maxdepth 1 -type f -name '*.md' -delete
find "$SKILLS_DIR" -maxdepth 1 -type f -name '*.md' -delete
find "$RULES_DIR" -maxdepth 1 -type f -name '*.md' -delete
find "$HOOKS_DIR" -maxdepth 1 -type f -name '*.md' -delete

copy_files "$AGENTS_DIR" "${CORE_AGENTS[@]}"
copy_files "$RULES_DIR" "${CORE_RULES[@]}"
copy_files "$HOOKS_DIR" "${CORE_HOOKS[@]}"

if [[ "$PROFILE" == "developer" || "$PROFILE" == "security" || "$PROFILE" == "full" ]]; then
    copy_files "$AGENTS_DIR" "${DEVELOPER_AGENTS[@]}"
    copy_files "$SKILLS_DIR" "${DEVELOPER_SKILLS[@]}"
    copy_files "$HOOKS_DIR" "${DEVELOPER_HOOKS[@]}"
fi

if [[ "$PROFILE" == "security" || "$PROFILE" == "full" ]]; then
    copy_files "$AGENTS_DIR" "${SECURITY_AGENTS[@]}"
fi

if [[ "$PROFILE" == "full" ]]; then
    copy_files "$AGENTS_DIR" "${FULL_EXTRA_AGENTS[@]}"
    copy_files "$SKILLS_DIR" "${FULL_EXTRA_SKILLS[@]}"
fi

project_json="$(detect_project_metadata "$PROJECT_ROOT")"

extract_field() {
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

list_layer_json() {
    local dir="$1"
    local kind="$2"
    local file name version description scope category event matcher first

    printf '['
    first=true

    while IFS= read -r file; do
        [ -n "$file" ] || continue
        name="$(extract_field "$file" "name")"
        [ -n "$name" ] || name="$(basename "$file" .md)"

        if [ "$first" = true ]; then
            first=false
        else
            printf ','
        fi

        case "$kind" in
            agents)
                version="$(extract_field "$file" "version")"
                description="$(extract_field "$file" "description")"
                jq -nc \
                  --arg name "$name" \
                  --arg version "${version:-local}" \
                  --arg role "${description:-Installed from roster profile}" \
                  '{
                    name: $name,
                    source: "roster",
                    version: $version,
                    role: $role,
                    tunables: {}
                  }'
                ;;
            skills)
                version="$(extract_field "$file" "version")"
                jq -nc \
                  --arg name "$name" \
                  --arg version "${version:-local}" \
                  '{
                    name: $name,
                    source: "roster",
                    version: $version
                  }'
                ;;
            rules)
                scope="$(extract_field "$file" "scope")"
                category="$(extract_field "$file" "category")"
                jq -nc \
                  --arg name "$name" \
                  --arg scope "${scope:-global}" \
                  --arg category "${category:-unknown}" \
                  '{
                    name: $name,
                    source: "roster",
                    scope: $scope,
                    category: $category
                  }'
                ;;
            hooks)
                event="$(extract_field "$file" "event")"
                matcher="$(extract_field "$file" "matcher")"
                jq -nc \
                  --arg name "$name" \
                  --arg event "${event:-unknown}" \
                  --arg matcher "${matcher:-}" \
                  '{
                    name: $name,
                    event: $event,
                    matcher: (if $matcher == "" then null else $matcher end),
                    source: "roster"
                  }'
                ;;
        esac
    done < <(find "$dir" -maxdepth 1 -type f -name '*.md' | sort)

    printf ']'
}

agents_json="$(list_layer_json "$AGENTS_DIR" agents)"
skills_json="$(list_layer_json "$SKILLS_DIR" skills)"
rules_json="$(list_layer_json "$RULES_DIR" rules)"
hooks_json="$(list_layer_json "$HOOKS_DIR" hooks)"

jq -n \
  --arg profile "$PROFILE" \
  --argjson project "$project_json" \
  --argjson agents "$agents_json" \
  --argjson skills "$skills_json" \
  --argjson rules "$rules_json" \
  --argjson hooks "$hooks_json" \
  '{
    version: "1.0.0",
    profile: $profile,
    source_of_truth: ".harness",
    runtimes: [
      {name: "claude-code", enabled: true, entrypoint: ".claude/"},
      {name: "codex", enabled: true, entrypoint: ".agents/skills/"}
    ],
    project: $project,
    layers: {
      agents: $agents,
      rules: $rules,
      hooks: $hooks,
      skills: $skills,
      mcp: [],
      kb: {
        structure: (if $profile == "full" then "standard" else "minimal" end),
        bootstrapped: false,
        last_audit: null,
        auditors: []
      }
    }
  }' > "$MANIFEST"

"$REPO_ROOT/scripts/sync-harness.sh" "$PROJECT_ROOT"

validate_harness() {
    local root="$1"
    local errors=0

    printf '\nValidating harness installation...\n'

    # Check required tools
    local missing_tools=()
    command -v git >/dev/null 2>&1 || missing_tools+=("git")
    command -v jq  >/dev/null 2>&1 || missing_tools+=("jq")

    if [ ${#missing_tools[@]} -gt 0 ]; then
        printf '  [WARN] Missing recommended tools: %s\n' "${missing_tools[*]}" >&2
        errors=$((errors + 1))
    fi

    # Check optional tools and report degraded modes
    if ! command -v gh >/dev/null 2>&1; then
        printf '  [INFO] gh CLI not found — recruiter PR workflow will be unavailable\n'
    fi

    # Check harness manifest
    if [ ! -f "$root/.harness/harness.json" ]; then
        printf '  [ERROR] harness.json not found\n' >&2
        errors=$((errors + 1))
    else
        printf '  [OK] harness.json present\n'
    fi

    # Check Claude projection
    if [ ! -d "$root/.claude/agents" ]; then
        printf '  [WARN] .claude/agents not found — Claude projection may be incomplete\n' >&2
        errors=$((errors + 1))
    else
        local harness_count claude_count
        harness_count=$(find "$root/.harness/agents" -name '*.md' | wc -l)
        claude_count=$(find "$root/.claude/agents"   -name '*.md' | wc -l)
        if [ "$harness_count" -ne "$claude_count" ]; then
            printf '  [WARN] Agent count mismatch: .harness/agents=%d .claude/agents=%d\n' \
                "$harness_count" "$claude_count" >&2
            errors=$((errors + 1))
        else
            printf '  [OK] Claude projection in sync (%d agents)\n' "$claude_count"
        fi
    fi

    # Check human-validation rule is present
    if [ ! -f "$root/.harness/rules/human-validation.md" ]; then
        printf '  [WARN] human-validation rule missing from harness — governance gates will not work\n' >&2
        errors=$((errors + 1))
    else
        printf '  [OK] human-validation rule present\n'
    fi

    if [ "$errors" -gt 0 ]; then
        printf '\nHarness installed with %d warning(s). Review output above before using agents.\n' "$errors"
    else
        printf '\nHarness OK.\n'
    fi
}

validate_harness "$PROJECT_ROOT"
printf 'Initialized shared harness in %s with profile %s\n' "$PROJECT_ROOT" "$PROFILE"
