---
name: post-edit-lint
description: Auto-detect project linter and run it on edited files — informational, non-blocking.
event: PostToolUse
matcher: Edit|Write
version: 1.1.0
timeout: 15000
async: false
requires: ["jq"]
---

# Post-Edit Lint

Runs after every Edit or Write tool call. Detects the project's linter by checking for config files and runs it on the affected file. Results are informational (exit 0 always) so edits are never blocked.

## Detected Linters

| Config File | Linter | Command |
|-------------|--------|---------|
| `.eslintrc*` / `eslint.config.*` | ESLint | `npx eslint --no-warn-ignored <file>` |
| `pyproject.toml` (with `[tool.ruff]`) | Ruff | `ruff check <file>` |
| `pyproject.toml` / `setup.cfg` (with flake8) | Flake8 | `flake8 <file>` |
| `.ocamlformat` | OCaml fmt | `dune fmt 2>&1` |
| `Cargo.toml` / `rustfmt.toml` | Rust fmt (clippy runs at QA, not per-edit) | `cargo fmt -- --check` |
| `.golangci.yml` | golangci-lint | `golangci-lint run <file>` |
| `biome.json` | Biome | `npx biome check <file>` |

## Command

```command
#!/bin/bash
INPUT=$(cat -)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_result.path // empty')

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  exit 0
fi

DIR=$(dirname "$FILE")
PROJECT_ROOT="$DIR"
while [ "$PROJECT_ROOT" != "/" ]; do
  if [ -f "$PROJECT_ROOT/package.json" ] || [ -f "$PROJECT_ROOT/pyproject.toml" ] || \
     [ -f "$PROJECT_ROOT/Cargo.toml" ] || [ -f "$PROJECT_ROOT/dune-project" ] || \
     [ -f "$PROJECT_ROOT/go.mod" ] || [ -f "$PROJECT_ROOT/.git/HEAD" ]; then
    break
  fi
  PROJECT_ROOT=$(dirname "$PROJECT_ROOT")
done

cd "$PROJECT_ROOT" 2>/dev/null || cd "$DIR"

LINTER=""
LINT_CMD=""

# JavaScript / TypeScript — ESLint
if [ -z "$LINTER" ]; then
  for cfg in .eslintrc .eslintrc.js .eslintrc.json .eslintrc.yml eslint.config.js eslint.config.mjs eslint.config.ts; do
    if [ -f "$PROJECT_ROOT/$cfg" ]; then
      LINTER="eslint"
      LINT_CMD="npx eslint --no-warn-ignored \"$FILE\" 2>&1"
      break
    fi
  done
fi

# JavaScript / TypeScript — Biome
if [ -z "$LINTER" ] && [ -f "$PROJECT_ROOT/biome.json" ]; then
  LINTER="biome"
  LINT_CMD="npx biome check \"$FILE\" 2>&1"
fi

# Python — Ruff
if [ -z "$LINTER" ] && [ -f "$PROJECT_ROOT/pyproject.toml" ] && grep -q '\[tool\.ruff\]' "$PROJECT_ROOT/pyproject.toml" 2>/dev/null; then
  LINTER="ruff"
  LINT_CMD="ruff check \"$FILE\" 2>&1"
fi

# Python — Flake8
if [ -z "$LINTER" ]; then
  if ([ -f "$PROJECT_ROOT/setup.cfg" ] && grep -q '\[flake8\]' "$PROJECT_ROOT/setup.cfg" 2>/dev/null) || \
     ([ -f "$PROJECT_ROOT/.flake8" ]); then
    LINTER="flake8"
    LINT_CMD="flake8 \"$FILE\" 2>&1"
  fi
fi

# OCaml
if [ -z "$LINTER" ] && [ -f "$PROJECT_ROOT/.ocamlformat" ]; then
  LINTER="dune fmt"
  LINT_CMD="dune fmt 2>&1"
fi

# Rust — fast format check only (clippy runs at QA, see roster-qa)
if [ -z "$LINTER" ] && ([ -f "$PROJECT_ROOT/rustfmt.toml" ] || [ -f "$PROJECT_ROOT/.rustfmt.toml" ] || [ -f "$PROJECT_ROOT/Cargo.toml" ]); then
  # Fast per-edit format check only. Clippy compiles the whole crate, so it runs at QA
  # time (see roster-qa's lint gate), not synchronously on every keystroke.
  LINTER="cargo fmt"
  LINT_CMD="cargo fmt -- --check 2>&1"
fi

# Go
if [ -z "$LINTER" ] && [ -f "$PROJECT_ROOT/.golangci.yml" ]; then
  LINTER="golangci-lint"
  LINT_CMD="golangci-lint run \"$FILE\" 2>&1"
fi

if [ -z "$LINTER" ]; then
  exit 0
fi

echo "--- post-edit-lint: running $LINTER ---"
OUTPUT=$(eval "$LINT_CMD" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ] && [ -n "$OUTPUT" ]; then
  echo "$OUTPUT" | head -30
  echo "--- $LINTER found issues (informational, not blocking) ---"
else
  echo "--- $LINTER: clean ---"
fi

# Always exit 0 — this hook is informational, never blocks edits
exit 0
```

## Installed As

The installed `settings.json` hook is **generated from the `## Command` block above** by
`sync-harness.sh` (`build_hooks_json` → `extract_command_block`) — there is no second
hand-maintained copy. The live result is written to `.claude/settings.local.json` under
`hooks.PostToolUse` with `matcher: "Edit|Write"`.
