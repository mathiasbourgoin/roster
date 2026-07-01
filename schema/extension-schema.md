# Extension Schema

Roster extensions are local repositories that add reusable harness capability outside the core roster tree. They are installed from an explicit path and recorded in `.harness/extensions.json`.

An extension can expose a `roster-extension.json` manifest. If absent, roster falls back to `.claude-plugin/plugin.json` plus repository layout inference, which covers existing plugin-style extension repositories.

## `roster-extension.json`

```json
{
  "schema_version": "1.0",
  "name": "security-workflows",
  "version": "1.57.0",
  "type": "skill-pack",
  "description": "Invariant-first security research workflow skills.",
  "runtime_targets": ["codex"]
}
```

## Fields

| Field | Required | Description |
|---|---:|---|
| `schema_version` | yes | Must be `"1.0"` when present. |
| `name` | yes | Lowercase safe name: letters, digits, dots, underscores, and hyphens. |
| `version` | yes | Extension version. Semver is recommended. |
| `type` | no | Descriptive classification: `skill-pack`, `apparatus`, `profile-pack`, or `workflow-pack`. Inferred when absent; it does not change v1 installation behavior. |
| `description` | no | Human-readable summary. |
| `runtime_targets` | no | Supported projection targets. Current managed targets are `codex` and `opencode`; default is `codex`. |

## Inferred Components

`roster-extension info <path>` discovers these repository surfaces:

| Surface | Layout | Installed today |
|---|---|---:|
| Skills | `skills/<name>/SKILL.md` | yes |
| Profiles | `profiles/*.md` | recorded |
| Project templates | `project-template/**/*.template` | recorded |
| Workflows | `workflows/**/*.json` | recorded |
| Tools | `tools/**` | recorded |
| Agents/hooks | `agents/**/*.md`, `hooks/**/*.md` | recorded |

Only skill directories are projected into runtime skill directories in this version. Other component types are still listed in the manifest so review, converge, and future installers can reason about the full extension surface.

### Source-tree walk semantics

Component discovery and skill projection walk the extension source tree fail-closed:

- `dist/`, `node_modules/`, and `.git/` directories are **skipped** at any depth. They are build/VCS artifacts and are never part of an extension's installable surface.
- An **unreadable directory** anywhere in the walked tree is a hard error (`unreadable extension source directory: …`) — a partial install is impossible, not silently incomplete.
- A **symlinked entry** (file or directory) in the source tree is a hard error (`refusing symlinked extension source file: …`); extensions must ship regular files.

An extension that declares no skill components (for example a profiles-only pack) still installs: it is registered as a recorded-only entry with an empty `installed_files` list and nothing is projected. Skill components that are declared but resolve to no installable files remain a hard error (`declared skills resolved to no installable files`).

## Installed Registry

`roster-extension install <path>` writes `.harness/extensions.json`:

```json
{
  "schema_version": "1.0",
  "extensions": [
    {
      "name": "verification-apparatus",
      "version": "1.2.1",
      "type": "apparatus",
      "source": {
        "path": "/home/user/dev/verification-apparatus",
        "git_commit": "..."
      },
      "runtime_targets": ["codex"],
      "runtime_roots": [".agents/skills"],
      "installed_files": [
        {
          "source": "skills/verification-apparatus/SKILL.md",
          "target": ".agents/skills/verification-apparatus/SKILL.md",
          "sha256": "..."
        }
      ]
    },
    {
      "name": "host-profiles",
      "version": "2.0.0",
      "type": "apparatus",
      "source": {
        "path": "/home/user/dev/host-profiles",
        "git_commit": "..."
      },
      "runtime_targets": ["codex"],
      "runtime_roots": [".agents/skills"],
      "installed_files": []
    }
  ]
}
```

A recorded-only entry (no skill components declared) keeps `installed_files` empty: the pack is version- and commit-tracked but owns no files on disk.

`runtime_roots` records the resolved project-local ownership roots used at install time, so removal remains safe if the harness runtime entrypoint changes later.

`remove` deletes only files listed under `installed_files`, after validating the complete removal set. It refuses locally modified files and targets outside the recorded runtime roots. `converge` checks that installed files still exist, target and source content hashes match, and the source version/revision still matches the registry; it exits non-zero on drift. Recorded-only entries are always listed by `converge` with a `recorded_only` advisory (no on-disk files are verifiable); the advisory alone does not cause a non-zero exit — a version change, commit change, or missing source path still does. Content edits to recorded-but-not-installed components (e.g. `profiles/*.md`) are not hashed in v1 and are only detected indirectly via the version or commit.

## Commands

Build first with `npm run build:ts`, then:

```bash
npm run extension -- info ~/dev/security-workflows
npm run extension -- install ~/dev/security-workflows
npm run extension -- list
npm run extension -- converge
npm run extension -- remove security-workflows
```

Use `--target <project-root>` to operate on another installed roster project, and `--dry-run` with `install` or `remove` to inspect the file plan without changing the target.
