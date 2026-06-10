---
version: 1.2.0
---

# Hook Definition Schema

Hooks are markdown files that define automated behaviors triggered by assistant runtime events. Each hook lives in `hooks/<category>/<name>.md` and is installed into the shared harness before being projected into runtime-specific configuration.

## Required Frontmatter

```yaml
---
name: <string>               # Unique identifier (kebab-case)
description: <string>        # One-line summary of what this hook does
event: <string>              # Trigger event (see Events below)
---
```

## Optional Frontmatter

```yaml
matcher: <string>            # Tool name regex, only for PreToolUse/PostToolUse (e.g., "Bash", "Edit|Write")
timeout: <int>               # Timeout in milliseconds (default: 10000)
async: <bool>                # If true, hook runs without blocking (default: false)
requires: [<string>]         # External dependencies (CLI tools, etc.)
version: <semver>            # Version for tracking updates (e.g., 1.0.0)
```

## Events

| Event                | Fires when                                    |
|----------------------|-----------------------------------------------|
| `PreToolUse`         | Before a tool call executes (can block it)     |
| `PostToolUse`        | After a tool call completes                    |
| `SessionStart`       | When an assistant session begins               |
| `Stop`               | When the runtime finishes its turn             |
| `SessionEnd`         | When a session is terminated                   |

## Body

The markdown body has two sections:

1. **Documentation** — What the hook does, why it exists, any caveats.
2. **Command** — The actual shell command in a fenced code block tagged `command`.

## Claude Code `hooks` Format

When installed, hooks become entries in `settings.json`:

```json
{
  "hooks": {
    "<event>": [
      {
        "matcher": "<tool-pattern|omit-if-not-applicable>",
        "hooks": [
          {
            "type": "command",
            "command": "<shell command from the command block>"
          }
        ]
      }
    ]
  }
}
```

For `PreToolUse` hooks, a non-zero exit code blocks the tool call. Stdout from the hook is shown to the model as feedback.

## Example

```markdown
---
name: block-dangerous
description: Block destructive git commands (push --force, reset --hard, clean -f).
event: PreToolUse
matcher: Bash
timeout: 5000
---

# Block Dangerous Git Commands

Intercepts Bash tool calls and rejects any that contain destructive git operations. This prevents accidental data loss from force pushes, hard resets, and clean operations.

Blocked patterns:
- `git push --force` / `git push -f` (except to feature branches)
- `git reset --hard`
- `git clean -f`
- `git checkout .` / `git restore .`

## Command

```command
#!/bin/bash
INPUT=$(cat -)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
if echo "$COMMAND" | grep -qE 'git\s+(push\s+(-f|--force)|reset\s+--hard|clean\s+-f|checkout\s+\.|restore\s+\.)'; then
  echo "BLOCKED: Destructive git command detected. Ask the user for explicit confirmation."
  exit 1
fi
exit 0
```

## Installed As

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "#!/bin/bash\nINPUT=$(cat -)\nCOMMAND=$(echo \"$INPUT\" | jq -r '.tool_input.command // empty')\nif echo \"$COMMAND\" | grep -qE 'git\\s+(push\\s+(-f|--force)|reset\\s+--hard|clean\\s+-f|checkout\\s+\\.|restore\\s+\\.)'; then\n  echo \"BLOCKED: Destructive git command detected.\"\n  exit 1\nfi\nexit 0"
          }
        ]
      }
    ]
  }
}
```

## Naming Convention

- File: `hooks/<category>/<name>.md`
- Category groups hooks by function (e.g., `safety`, `lint`, `workflow`)
- The `name` field must match the filename (without extension)

## Install Behavior

The canonical installer should place the hook in `.harness/hooks/<name>.md`, then render runtime-specific hook configuration:

- Claude Code: serialize the `command` block and merge it into `.claude/settings.json` or `.claude/settings.local.json`
- Other runtimes: project the same hook intent into the nearest equivalent mechanism, or mark it unsupported if no equivalent exists

---

## Skill Hook Format

Skill hooks are markdown files with a fenced YAML `steps:` block. They are executed by the LLM agent (not a separate process) before (`pre`) or after (`post`) a skill is dispatched by `roster-run`.

### Frontmatter Fields

**Required:**

```yaml
name: <kebab-case>       # Unique identifier
version: <semver>        # e.g., 1.0.0
event: pre | post        # Hook phase
skill: <skill-name>      # Target skill name (matches name: frontmatter field of the skill file)
on_error: stop | warn | skip | ignore  # Hook-level default behavior (retry is a dedicated step type, not an on_error value)
```

**Optional:**

```yaml
description: <string>   # One-line summary
```

**Default `on_error` by phase:**
- `pre` hooks: `stop` (abort skill dispatch on failure)
- `post` hooks: `warn` (log failure, do not affect skill outcome retroactively)

### Body Format

````markdown
---
(frontmatter)
---

(optional prose documentation)

```yaml
steps:
  - run: "bash command"
    on_error: stop       # step-level override (optional)
  - prompt: "text to send"
    agent: roster-implement
    on_error: warn
  - test: "bash returning 0=true"
    on_true:
      - run: "cmd if true"
    on_false:
      - goto: my-label
  - label: my-label
  - loop:
      steps:
        - run: "cmd"
      until: "bash returning 0=done"
  - goto: roster-implement    # pipeline jump (post-hooks only) OR intra-hook label
  - timeout: 5000             # advisory ms — LLM best-effort, not enforced
  - log: "message to user"
  - retry: 3
    backoff: 1000
  - include: shared/validate-brief.md   # build-time inlined by sync-harness.sh
  - output: key-name
  - parallel:                 # prose-parallelism hint — executed sequentially in v1
      agents:
        - roster-implement
        - roster-review
      on_error: collect-all   # no-op in v1; first-wins is also a no-op
```
````

### Step-Type Catalog

| Operator | Required co-fields | Notes |
|---|---|---|
| `run:` | — | Bash execution; exit code semantics |
| `prompt:` | `agent:` (required) | Invoke named agent; see ABORT sentinel |
| `test:` | `on_true:` and/or `on_false:` | Bash branching; exit 0 = true |
| `label:` | — | Named jump target (no-op execution) |
| `loop:` | `steps:` (required), `until:` (optional) | Infinite loops allowed; linter warns when `until:` absent |
| `goto:` | — | Intra-hook label or pipeline step (post-hooks only) |
| `timeout:` | — | Advisory ms; LLM best-effort only |
| `log:` | — | Print message to user |
| `retry:` | `backoff:` (optional ms) | Retry the PREVIOUS step up to N times |
| `include:` | — | Path relative to `.harness/hooks/shared/`; inlined at build time |
| `output:` | — | Structured output key |
| `parallel:` | `agents:` (required) | Prose-parallelism hint; sequential in v1; `first-wins`/`collect-all` are no-ops |

Each step object must have **exactly one** operator key from the table above.

### `ABORT:` Sentinel

For `prompt:` + `agent:` steps, a step failure is triggered when the **entire** first non-empty line of agent output equals (after stripping leading whitespace):

```
ABORT: <reason>
```

Any other occurrence of the word "ABORT" in the response is ignored.

### Discovery Path

Auto-discovered by `roster-run` using the `name:` frontmatter field of the target skill file:

```
.harness/hooks/skills/<skill-name>/pre.md    # pre hook
.harness/hooks/skills/<skill-name>/post.md   # post hook
```

### Non-Reentrance

Hooks do not fire for skill invocations initiated from within a hook (depth > 1). This is enforced by prose instruction in `roster-run.md` — not by a process mechanism. See the reliability caveats in `docs/hooks.md`.

### Friction Log Fields

Hook-enabled runs emit additional fields in `friction.jsonl` alongside standard fields:

```jsonl
{"hook": "pre | post", "outcome": "pass | warn | abort | loop-N", "duration_hint_ms": 1200, "loop_iterations": 0}
```

> `duration_hint_ms` is LLM-approximate — no wall-clock timer is available.
